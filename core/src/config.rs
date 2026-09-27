//! Loading and saving `~/.kayet/config.toml`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::fs_ops;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub workspace: WorkspaceConfig,
    pub ui: UiConfig,
    pub editor: EditorConfig,
    pub window: WindowConfig,
    pub session: SessionConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceConfig {
    pub path: String,
    pub show_hidden_files: bool,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            path: "~/.kayet/workspace".into(),
            show_hidden_files: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    pub theme: Theme,
    pub sidebar_visible: bool,
    /// Keep the title bar (and traffic lights) visible instead of revealing it on hover.
    pub titlebar_pinned: bool,
    /// Zen mode: cursor line kept vertically centered, extra top/bottom padding,
    /// all but the current paragraph dimmed.
    pub zen_mode: bool,
    pub sidebar_width: u32,
    pub preview_split: f64,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            sidebar_visible: false,
            titlebar_pinned: false,
            zen_mode: false,
            sidebar_width: 240,
            preview_split: 0.5,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontFamily {
    System,
    #[default]
    Mono,
}

/// Text cursor: blinking, or steady (always visible, no animation).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Cursor {
    #[default]
    Blink,
    Steady,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorConfig {
    pub font_family: FontFamily,
    pub font_size: u32,
    pub line_height: f64,
    pub soft_wrap: bool,
    pub max_line_width: u32,
    pub autosave: bool,
    /// Syntax highlighting for source code and data/config files (Markdown is always highlighted).
    pub syntax_highlighting: bool,
    pub cursor: Cursor,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_family: FontFamily::Mono,
            font_size: 15,
            line_height: 1.6,
            soft_wrap: true,
            max_line_width: 72,
            autosave: false,
            syntax_highlighting: true,
            cursor: Cursor::Blink,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowConfig {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            width: 1000,
            height: 700,
            x: 0,
            y: 0,
        }
    }
}

impl WindowConfig {
    /// `x = 0, y = 0` means "never positioned" — the window gets centered instead.
    pub fn has_position(&self) -> bool {
        self.x != 0 || self.y != 0
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionConfig {
    /// Last opened file, restored on launch if it still exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_file: Option<String>,
}

/// `~/.kayet`
pub fn kayet_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".kayet")
}

/// `~/.kayet/config.toml`
pub fn config_path() -> PathBuf {
    kayet_dir().join("config.toml")
}

/// Expands a leading `~` to the home directory.
pub fn expand_tilde(path: &str) -> PathBuf {
    let home = dirs::home_dir();
    match (path, home) {
        ("~", Some(home)) => home,
        (p, Some(home)) if p.starts_with("~/") => home.join(&p[2..]),
        (p, _) => PathBuf::from(p),
    }
}

/// Replaces the home directory prefix with `~` (inverse of [`expand_tilde`]).
pub fn contract_tilde(path: &Path) -> String {
    if let Some(home) = dirs::home_dir()
        && let Ok(rest) = path.strip_prefix(&home)
    {
        return if rest.as_os_str().is_empty() {
            "~".into()
        } else {
            format!("~/{}", rest.display())
        };
    }
    path.display().to_string()
}

/// Parses config text; missing keys fall back to defaults.
pub fn parse(text: &str) -> Result<Config, toml::de::Error> {
    toml::from_str(text)
}

/// Loads the config from `path`. Missing files or keys fall back to defaults, which are
/// written back. A file that fails to parse is left untouched and defaults are used.
pub fn load_from(path: &Path) -> Config {
    match fs::read_to_string(path) {
        Ok(text) => match parse(&text) {
            Ok(cfg) => {
                let on_disk = toml::from_str::<toml::Table>(&text).ok();
                let complete = toml::Table::try_from(&cfg).ok();
                if on_disk != complete
                    && let Err(e) = save_to(path, &cfg)
                {
                    eprintln!("kayet: failed to write config: {e}");
                }
                cfg
            }
            Err(e) => {
                eprintln!("kayet: invalid config at {}: {e}", path.display());
                Config::default()
            }
        },
        Err(e) => {
            if e.kind() != io::ErrorKind::NotFound {
                eprintln!("kayet: cannot read config: {e}");
            }
            let cfg = Config::default();
            if let Err(e) = save_to(path, &cfg) {
                eprintln!("kayet: failed to write config: {e}");
            }
            cfg
        }
    }
}

pub fn save_to(path: &Path, cfg: &Config) -> io::Result<()> {
    let text = toml::to_string_pretty(cfg).map_err(io::Error::other)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs_ops::write_atomic(path, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_writes_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let cfg = load_from(&path);
        assert_eq!(cfg, Config::default());
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("[workspace]"));
        assert!(written.contains("theme = \"system\""));
        assert_eq!(toml::from_str::<Config>(&written).unwrap(), cfg);
    }

    #[test]
    fn missing_keys_are_filled_in() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "[ui]\ntheme = \"dark\"\n").unwrap();
        let cfg = load_from(&path);
        assert_eq!(cfg.ui.theme, Theme::Dark);
        assert_eq!(cfg.ui.sidebar_width, 240);
        assert_eq!(cfg.editor.font_size, 15);
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("sidebar_width = 240"));
        assert!(written.contains("theme = \"dark\""));
    }

    #[test]
    fn complete_file_is_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let mut text = String::from("# my notes\n");
        text.push_str(&toml::to_string_pretty(&Config::default()).unwrap());
        fs::write(&path, &text).unwrap();
        load_from(&path);
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }

    #[test]
    fn invalid_file_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "[ui]\ntheme = \"purple\"\n").unwrap();
        assert_eq!(load_from(&path), Config::default());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "[ui]\ntheme = \"purple\"\n"
        );
    }

    #[test]
    fn tilde_roundtrip() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde("~"), home);
        assert_eq!(expand_tilde("~/a/b"), home.join("a/b"));
        assert_eq!(expand_tilde("/abs"), PathBuf::from("/abs"));
        assert_eq!(contract_tilde(&home.join("x/y")), "~/x/y");
        assert_eq!(contract_tilde(Path::new("/abs")), "/abs");
    }
}
