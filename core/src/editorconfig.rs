//! `.editorconfig` support: the indentation and save rules that apply to a file, read from the
//! `.editorconfig` files in its folder and the folders above it (see <https://editorconfig.org>).

use std::fs;
use std::path::Path;

use serde::Serialize;

/// The properties kayet uses; `None` where no `.editorconfig` sets them (or sets them to `unset`).
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct EditorConfig {
    /// `"tab"` or `"space"`.
    pub indent_style: Option<String>,
    pub indent_size: Option<u32>,
    pub tab_width: Option<u32>,
    pub trim_trailing_whitespace: Option<bool>,
    pub insert_final_newline: Option<bool>,
}

/// Larger `.editorconfig` files are skipped.
const MAX_FILE_SIZE: u64 = 256 * 1024;

/// The rules for `file`: closer `.editorconfig` files win over those further up, and within a
/// file later sections win over earlier ones. The search stops at one declaring `root = true`.
pub fn for_file(file: &Path) -> EditorConfig {
    let mut found = Vec::new();
    let mut dir = file.parent();
    while let Some(d) = dir {
        let path = d.join(".editorconfig");
        let small = fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= MAX_FILE_SIZE);
        if let Some(text) = small.then(|| fs::read_to_string(&path).ok()).flatten() {
            let root = is_root(&text);
            found.push((d.to_path_buf(), text));
            if root {
                break;
            }
        }
        dir = d.parent();
    }
    let mut props: Vec<(String, String)> = Vec::new();
    for (dir, text) in found.iter().rev() {
        let Ok(rel) = file.strip_prefix(dir) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        props.extend(matching_properties(text, &rel));
    }
    resolve(&props)
}

/// Whether the preamble (before the first section) says `root = true`.
fn is_root(text: &str) -> bool {
    lines(text)
        .take_while(|l| !l.starts_with('['))
        .filter_map(|l| l.split_once(['=', ':']))
        .any(|(k, v)| {
            k.trim().eq_ignore_ascii_case("root") && v.trim().eq_ignore_ascii_case("true")
        })
}

/// Non-empty lines without comments.
fn lines(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with(';'))
}

/// The properties of every section whose glob matches `rel` (the file's path relative to the
/// `.editorconfig` folder), in file order; keys are lower-cased.
fn matching_properties(text: &str, rel: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut active = false;
    for line in lines(text) {
        if let Some(section) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            active = section_matches(section, rel);
        } else if active && let Some((k, v)) = line.split_once(['=', ':']) {
            out.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    out
}

/// Whether a section glob matches `rel`: a glob without `/` matches the file name in any folder,
/// one with `/` the path relative to the `.editorconfig` folder.
fn section_matches(section: &str, rel: &str) -> bool {
    expand_braces(section).iter().any(|glob| {
        let chars: Vec<char>;
        let target: Vec<char>;
        if glob.contains('/') {
            chars = glob.strip_prefix('/').unwrap_or(glob).chars().collect();
            target = rel.chars().collect();
        } else {
            chars = glob.chars().collect();
            target = rel.rsplit('/').next().unwrap_or(rel).chars().collect();
        }
        glob_match(&chars, &target)
    })
}

/// Expands `{a,b}` alternatives and `{1..3}` number ranges into plain globs.
fn expand_braces(glob: &str) -> Vec<String> {
    let chars: Vec<char> = glob.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '\\' => i += 2,
            '{' => {
                if let Some(end) = closing_brace(&chars, i)
                    && let Some(options) = brace_options(&chars[i + 1..end])
                {
                    let head: String = chars[..i].iter().collect();
                    let tail: String = chars[end + 1..].iter().collect();
                    return options
                        .iter()
                        .flat_map(|o| expand_braces(&format!("{head}{o}{tail}")))
                        .collect();
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    vec![glob.to_string()]
}

/// Index of the `}` closing the `{` at `open`, respecting nesting and escapes.
fn closing_brace(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 0;
    let mut i = open;
    while i < chars.len() {
        match chars[i] {
            '\\' => i += 1,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// The alternatives inside braces (split at top-level commas), or the numbers of a range;
/// `None` for a single word, which stays literal.
fn brace_options(inner: &[char]) -> Option<Vec<String>> {
    let text: String = inner.iter().collect();
    if let Some((a, b)) = text.split_once("..")
        && let (Ok(a), Ok(b)) = (a.parse::<i64>(), b.parse::<i64>())
    {
        let (lo, hi) = (a.min(b), a.max(b));
        return (hi - lo <= 10_000).then(|| (lo..=hi).map(|n| n.to_string()).collect());
    }
    let mut options = vec![String::new()];
    let mut depth = 0;
    let mut escaped = false;
    for &c in inner {
        if escaped {
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
        } else if c == ',' && depth == 0 {
            options.push(String::new());
            continue;
        }
        options.last_mut().expect("never empty").push(c);
    }
    (options.len() > 1).then_some(options)
}

/// Matches a glob (braces already expanded): `*` any run without `/`, `**` any run, `?` one
/// character but `/`, `[abc]` / `[!a-z]` a character class, `\` escapes.
fn glob_match(p: &[char], s: &[char]) -> bool {
    let Some(&c) = p.first() else {
        return s.is_empty();
    };
    match c {
        '*' if p.get(1) == Some(&'*') => {
            let rest = &p[2..];
            // `**/` also matches no folder at all.
            if rest.first() == Some(&'/') && glob_match(&rest[1..], s) {
                return true;
            }
            (0..=s.len()).any(|i| glob_match(rest, &s[i..]))
        }
        '*' => {
            let rest = &p[1..];
            for i in 0..=s.len() {
                if glob_match(rest, &s[i..]) {
                    return true;
                }
                if s.get(i) == Some(&'/') {
                    break;
                }
            }
            false
        }
        '?' => s.first().is_some_and(|&ch| ch != '/') && glob_match(&p[1..], &s[1..]),
        '[' => match class(p) {
            Some((matches, len)) => {
                s.first().is_some_and(|&ch| ch != '/' && matches(ch))
                    && glob_match(&p[len..], &s[1..])
            }
            None => s.first() == Some(&'[') && glob_match(&p[1..], &s[1..]),
        },
        '\\' if p.len() > 1 => s.first() == Some(&p[1]) && glob_match(&p[2..], &s[1..]),
        _ => s.first() == Some(&c) && glob_match(&p[1..], &s[1..]),
    }
}

/// A `[...]` class at the start of `p`: a matcher and the class's length, or `None` if unclosed.
fn class(p: &[char]) -> Option<(impl Fn(char) -> bool, usize)> {
    let negated = matches!(p.get(1), Some('!' | '^'));
    let start = if negated { 2 } else { 1 };
    let end = start + 1 + p.get(start + 1..)?.iter().position(|&c| c == ']')?;
    let body: Vec<char> = p[start..end].to_vec();
    let matches = move |ch: char| {
        let mut hit = false;
        let mut i = 0;
        while i < body.len() {
            if i + 2 < body.len() && body[i + 1] == '-' {
                hit |= (body[i]..=body[i + 2]).contains(&ch);
                i += 3;
            } else {
                hit |= body[i] == ch;
                i += 1;
            }
        }
        hit != negated
    };
    Some((matches, end + 1))
}

/// Turns the matching properties (later ones winning) into the rules kayet uses.
fn resolve(props: &[(String, String)]) -> EditorConfig {
    let mut cfg = EditorConfig::default();
    let mut size_is_tab = false;
    for (key, value) in props {
        let v = value.to_ascii_lowercase();
        let bool_value = match v.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        };
        match key.as_str() {
            "indent_style" => cfg.indent_style = matches!(v.as_str(), "tab" | "space").then_some(v),
            "indent_size" => {
                size_is_tab = v == "tab";
                cfg.indent_size = v.parse().ok().filter(|&n| n > 0);
            }
            "tab_width" => cfg.tab_width = v.parse().ok().filter(|&n| n > 0),
            "trim_trailing_whitespace" => cfg.trim_trailing_whitespace = bool_value,
            "insert_final_newline" => cfg.insert_final_newline = bool_value,
            _ => {}
        }
    }
    if size_is_tab {
        cfg.indent_size = cfg.tab_width;
    }
    if cfg.tab_width.is_none() {
        cfg.tab_width = cfg.indent_size;
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glob(p: &str, s: &str) -> bool {
        section_matches(p, s)
    }

    #[test]
    fn globs() {
        assert!(glob("*", "src/main.rs"));
        assert!(glob("*.rs", "src/main.rs"));
        assert!(!glob("*.rs", "src/main.ts"));
        assert!(glob("*.{js,ts}", "a/b.ts"));
        assert!(glob("{*.json,.babelrc}", ".babelrc"));
        assert!(glob("Makefile", "sub/Makefile"));
        assert!(glob("lib/**.js", "lib/a/b.js"));
        assert!(!glob("lib/**.js", "src/lib/a.js"));
        assert!(glob("/src/*.rs", "src/main.rs"));
        assert!(!glob("src/*.rs", "src/a/main.rs"));
        assert!(glob("src/**/*.rs", "src/main.rs"));
        assert!(glob("file?.txt", "file1.txt"));
        assert!(glob("[abc].md", "b.md"));
        assert!(!glob("[!abc].md", "b.md"));
        assert!(glob("[a-c].md", "c.md"));
        assert!(glob("v{1..3}.txt", "v2.txt"));
        assert!(!glob("v{1..3}.txt", "v4.txt"));
        assert!(glob("{single}.txt", "{single}.txt"));
        assert!(glob("a\\*b", "a*b"));
        assert!(!glob("a\\*b", "axb"));
    }

    #[test]
    fn resolves_properties() {
        let text = "root = true\n\n[*]\nindent_style = space\nindent_size = 4\n\
                    trim_trailing_whitespace = true\n\n# comment\n[*.go]\nindent_style = tab\n\
                    [*.md]\ntrim_trailing_whitespace = false\n";
        assert!(is_root(text));
        let go = resolve(&matching_properties(text, "cmd/main.go"));
        assert_eq!(go.indent_style.as_deref(), Some("tab"));
        assert_eq!(go.indent_size, Some(4));
        assert_eq!(go.tab_width, Some(4));
        assert_eq!(go.trim_trailing_whitespace, Some(true));
        let md = resolve(&matching_properties(text, "README.md"));
        assert_eq!(md.trim_trailing_whitespace, Some(false));
        assert_eq!(md.insert_final_newline, None);
    }

    #[test]
    fn indent_size_tab_uses_tab_width() {
        let props = [
            ("indent_size".into(), "tab".into()),
            ("tab_width".into(), "8".into()),
        ];
        let cfg = resolve(&props);
        assert_eq!(cfg.indent_size, Some(8));
        let unset = resolve(&[("indent_style".into(), "unset".into())]);
        assert_eq!(unset, EditorConfig::default());
    }

    #[test]
    fn closer_files_win_and_root_stops() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(
            root.join(".editorconfig"),
            "[*]\nindent_size = 8\ninsert_final_newline = true\n",
        )
        .unwrap();
        fs::write(
            root.join("a/.editorconfig"),
            "root = true\n[*]\nindent_size = 2\n",
        )
        .unwrap();
        fs::write(
            root.join("a/b/.editorconfig"),
            "[*.rs]\nindent_style = space\nindent_size = 4\n",
        )
        .unwrap();
        let rs = for_file(&root.join("a/b/x.rs"));
        assert_eq!(rs.indent_size, Some(4));
        assert_eq!(rs.indent_style.as_deref(), Some("space"));
        // `a` is the root, so the top `.editorconfig` is not read.
        assert_eq!(rs.insert_final_newline, None);
        let txt = for_file(&root.join("a/b/x.txt"));
        assert_eq!(txt.indent_size, Some(2));
        let top = for_file(&root.join("y.txt"));
        assert_eq!(top.indent_size, Some(8));
        assert_eq!(top.insert_final_newline, Some(true));
    }
}
