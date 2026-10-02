//! Custom themes from `~/.kayet/themes/<name>.toml` (see SPEC.md §9).

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config;

/// A custom theme: CSS token values per variant. Either section may be missing; a
/// single-variant theme then looks the same in both modes (see SPEC.md §9).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeFile {
    pub light: HashMap<String, String>,
    pub dark: HashMap<String, String>,
}

/// `~/.kayet/themes/`
fn themes_dir() -> PathBuf {
    config::kayet_dir().join("themes")
}

/// Theme names are file names without the extension, so `/`, `.` and friends are rejected.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Parses theme text; missing keys fall back to defaults.
fn parse(text: &str) -> Result<ThemeFile, toml::de::Error> {
    toml::from_str(text)
}

/// Loads `~/.kayet/themes/<name>.toml`.
pub fn load(name: &str) -> Result<ThemeFile, String> {
    if !valid_name(name) {
        return Err(format!("invalid theme name: {name}"));
    }
    let path = themes_dir().join(format!("{name}.toml"));
    let text = fs::read_to_string(&path).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            format!("theme '{name}' not found (looked in ~/.kayet/themes/)")
        } else {
            format!("cannot read theme '{name}': {e}")
        }
    })?;
    parse(&text).map_err(|e| format!("invalid theme '{name}': {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_plain_file_names() {
        assert!(valid_name("gruvbox-dark"));
        assert!(valid_name("a1_-B"));
        for bad in ["", "..", "a/b", "a.toml", ".hidden", "a b", "gruvbox™"] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert!(!valid_name(&"a".repeat(65)));
    }

    #[test]
    fn parses_theme() {
        let theme = parse("[dark]\nbg = \"#282828\"\n[light]\nbg = \"#fbf1c7\"\n").unwrap();
        assert_eq!(theme.dark.get("bg").map(String::as_str), Some("#282828"));
        assert_eq!(theme.light.get("bg").map(String::as_str), Some("#fbf1c7"));
    }

    #[test]
    fn missing_sections_use_defaults() {
        let theme = parse("[dark]\nbg = \"#282828\"\n").unwrap();
        assert!(theme.light.is_empty());
        assert_eq!(parse("").unwrap(), ThemeFile::default());
    }

    #[test]
    fn invalid_toml_is_rejected() {
        assert!(parse("[dark]\nbg = [\n").is_err());
    }

    #[test]
    fn load_rejects_bad_names_and_missing_files() {
        let err = load("../x").unwrap_err();
        assert!(err.contains("invalid theme name"), "{err}");
        let err = load("no-such-theme-kayet-test").unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }
}
