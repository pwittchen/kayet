//! Making kayet the default app for Markdown and plain text files
//! (`kayet → Make Default Editor for .md and .txt`).

/// File name extensions kayet takes over; the same ones it registers for in `tauri.conf.json`.
pub const EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

/// Makes the app with `bundle_id` the default for every role (open on double-click, Open With
/// default) of the content types of [`EXTENSIONS`]. The types are looked up by extension, so a
/// Markdown file whose type no installed app declares (a dynamic type) is covered too.
#[cfg(target_os = "macos")]
pub fn make_default(bundle_id: &str) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2_foundation::NSString;
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: *const c_void,
            tag: *const c_void,
            conforming_to: *const c_void,
        ) -> *mut c_void;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: *const c_void,
            role: u32,
            handler: *const c_void,
        ) -> i32;
    }
    /// `kLSRolesAll`.
    const ALL_ROLES: u32 = 0xFFFF_FFFF;
    // NSString is toll-free bridged with CFString.
    let cf = |s: &NSString| ptr::from_ref(s).cast::<c_void>();

    // The value of `kUTTagClassFilenameExtension`.
    let tag_class = NSString::from_str("public.filename-extension");
    let handler = NSString::from_str(bundle_id);
    for ext in EXTENSIONS {
        let tag = NSString::from_str(ext);
        // SAFETY: the arguments are valid CFStrings (or null); the returned type identifier
        // follows the Create rule, so `Retained` takes ownership and releases it.
        let uti = unsafe {
            let uti = UTTypeCreatePreferredIdentifierForTag(cf(&tag_class), cf(&tag), ptr::null());
            Retained::from_raw(uti.cast::<NSString>())
        };
        let Some(uti) = uti else {
            return Err(format!("cannot find the file type of .{ext} files"));
        };
        // SAFETY: both arguments are valid CFStrings.
        let status =
            unsafe { LSSetDefaultRoleHandlerForContentType(cf(&uti), ALL_ROLES, cf(&handler)) };
        if status != 0 {
            return Err(format!(
                "cannot make kayet the default app for .{ext} files (error {status})"
            ));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn make_default(_bundle_id: &str) -> Result<(), String> {
    Err("making kayet the default editor is only available on macOS".into())
}
