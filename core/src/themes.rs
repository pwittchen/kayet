//! Themes from `~/.kayet/themes/<name>.toml` (see SPEC.md §9).

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};

use crate::config;

/// A section's colors, keeping only string values; anything else is ignored per key
/// (see SPEC.md §9: non-hex values are ignored).
fn string_map<'de, D>(deserializer: D) -> Result<HashMap<String, String>, D::Error>
where
    D: Deserializer<'de>,
{
    let map = HashMap::<String, toml::Value>::deserialize(deserializer)?;
    Ok(map
        .into_iter()
        .filter_map(|(key, value)| value.as_str().map(|s| (key, s.to_owned())))
        .collect())
}

/// A theme: CSS token values per variant. Either section may be missing; a
/// single-variant theme then looks the same in both modes (see SPEC.md §9).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeFile {
    #[serde(deserialize_with = "string_map")]
    pub light: HashMap<String, String>,
    #[serde(deserialize_with = "string_map")]
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

/// Names a theme file cannot use: the built-in palette and the legacy shorthand values.
fn reserved(name: &str) -> bool {
    matches!(name, "kayet" | "system" | "light" | "dark")
}

/// Lists the loadable theme names in `dir`: `.toml` files with valid, unreserved names.
fn list_from(dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(names),
        Err(e) => return Err(format!("cannot list {}: {e}", dir.display())),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot list {}: {e}", dir.display()))?;
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(stem) = name.strip_suffix(".toml")
            && valid_name(stem)
            && !reserved(stem)
        {
            names.push(stem.to_owned());
        }
    }
    names.sort();
    Ok(names)
}

/// Lists the themes in `~/.kayet/themes/`.
pub fn list() -> Result<Vec<String>, String> {
    list_from(&themes_dir())
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
    fn non_string_values_are_ignored_per_key() {
        let theme = parse("[dark]\nbg = \"#282828\"\ntext = 123\nnested = { a = 1 }\n").unwrap();
        assert_eq!(theme.dark.get("bg").map(String::as_str), Some("#282828"));
        assert!(!theme.dark.contains_key("text"));
        assert!(!theme.dark.contains_key("nested"));
    }

    #[test]
    fn load_rejects_bad_names_and_missing_files() {
        let err = load("../x").unwrap_err();
        assert!(err.contains("invalid theme name"), "{err}");
        let err = load("no-such-theme-kayet-test").unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }

    #[test]
    fn lists_loadable_theme_names() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "b.toml",
            "a.toml",
            "notes.txt",
            "dark.toml",
            "kayet.toml",
            ".hidden.toml",
        ] {
            fs::write(dir.path().join(name), "[dark]\n").unwrap();
        }
        fs::create_dir(dir.path().join("dir.toml")).unwrap();
        assert_eq!(list_from(dir.path()).unwrap(), ["a", "b"]);
    }

    #[test]
    fn missing_themes_dir_lists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(list_from(&dir.path().join("nope")), Ok(Vec::new()));
        assert!(list().is_ok());
    }
}
