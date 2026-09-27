//! PDF export: prints the web view straight into a PDF file, paginated like "Save as PDF" in
//! the macOS print dialog but without showing it. The page's print stylesheet shows only the
//! rendered document the frontend put into `#print` (see `export.ts` / `theme.css`).
//!
//! HTML export needs no native code: the frontend writes the document with `write_file`.

use std::path::Path;
use std::sync::mpsc;

use tauri::WebviewWindow;

type Done = mpsc::Sender<Result<(), String>>;

/// Writes the web view's printout to `path` as PDF; returns once the file is written.
/// Blocks the calling thread, so it must not run on the main thread.
pub fn pdf(window: &WebviewWindow, path: &Path) -> Result<(), String> {
    let (done, finished) = mpsc::channel();
    let path = path.to_path_buf();
    window
        .with_webview(move |webview| start(&webview, &path, &done))
        .map_err(|e| e.to_string())?;
    finished
        .recv()
        .map_err(|_| "PDF export was interrupted".to_string())?
}

#[cfg(target_os = "macos")]
fn start(webview: &tauri::webview::PlatformWebview, path: &Path, done: &Done) {
    if let Err(e) = mac::print_to_pdf(webview, path, done.clone()) {
        let _ = done.send(Err(e));
    }
}

#[cfg(not(target_os = "macos"))]
fn start(_webview: &tauri::webview::PlatformWebview, _path: &Path, done: &Done) {
    let _ = done.send(Err("PDF export is only supported on macOS".into()));
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::Path;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol};
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSWindow,
    };
    use objc2_foundation::{NSCopying, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    use super::Done;

    /// Page margins in points (0.75in).
    const MARGIN: f64 = 54.0;

    pub struct Ivars {
        done: RefCell<Option<Done>>,
    }

    define_class!(
        /// Receives the end of the print operation and reports it back to `pdf`.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = Ivars]
        struct PrintDelegate;

        unsafe impl NSObjectProtocol for PrintDelegate {}

        impl PrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _operation: *mut NSPrintOperation, success: Bool, _info: *mut c_void) {
                if let Some(done) = self.ivars().done.borrow_mut().take() {
                    let result = if success.as_bool() {
                        Ok(())
                    } else {
                        Err("Could not write the PDF".to_string())
                    };
                    let _ = done.send(result);
                }
            }
        }
    );

    impl PrintDelegate {
        fn new(mtm: MainThreadMarker, done: Done) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars {
                done: RefCell::new(Some(done)),
            });
            // SAFETY: `NSObject`'s designated initializer.
            unsafe { msg_send![super(this), init] }
        }

        fn running(&self) -> bool {
            self.ivars().done.borrow().is_some()
        }
    }

    thread_local! {
        /// The delegate of the running (or last) export: AppKit does not retain it.
        static DELEGATE: RefCell<Option<Retained<PrintDelegate>>> = const { RefCell::new(None) };
    }

    pub fn print_to_pdf(
        webview: &tauri::webview::PlatformWebview,
        path: &Path,
        done: Done,
    ) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("PDF export must run on the main thread")?;
        if DELEGATE.with_borrow(|d| d.as_ref().is_some_and(|d| d.running())) {
            return Err("An export is already running".into());
        }
        // SAFETY: Tauri hands out the window's live WKWebView and NSWindow, and `with_webview`
        // runs this on the main thread.
        let (webview, window) = unsafe {
            (
                &*webview.inner().cast::<WKWebView>(),
                &*webview.ns_window().cast::<NSWindow>(),
            )
        };

        let info = NSPrintInfo::sharedPrintInfo().copy();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let url: &AnyObject = &url;
        // SAFETY: the print info dictionary maps attribute keys to objects; the saving URL is
        // an NSURL, as `NSPrintJobSavingURL` requires. The keys are AppKit constants.
        unsafe {
            info.dictionary().insert(NSPrintJobSavingURL, url);
            info.setJobDisposition(NSPrintSaveJob);
        }
        info.setTopMargin(MARGIN);
        info.setBottomMargin(MARGIN);
        info.setLeftMargin(MARGIN);
        info.setRightMargin(MARGIN);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);

        // SAFETY: called on the main thread with a valid print info.
        let operation = unsafe { webview.printOperationWithPrintInfo(&info) };
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        // WKWebView's printing view starts out zero-sized, which prints blank pages.
        if let Some(view) = operation.view() {
            view.setFrame(webview.bounds());
        }

        let delegate = PrintDelegate::new(mtm, done);
        // SAFETY: the delegate implements the did-run selector with the signature AppKit
        // expects, and is kept alive in `DELEGATE` until the next export.
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                Some(&delegate),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
        }
        DELEGATE.set(Some(delegate));
        Ok(())
    }
}
