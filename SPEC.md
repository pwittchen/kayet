# kayet — Specification

> A minimalistic text editor for macOS, built with Rust and Tauri.

## 1. Vision

kayet is a quiet, distraction-free text editor. When you are writing, the only thing
on screen is your text. Chrome (title bar, controls, sidebar toggles) appears only when
you reach for it with the mouse, then fades away again.

Design language: **macOS-native + Linear** — generous whitespace, soft neutral palette,
thin 1px hairline borders, subtle translucency, crisp typography, restrained motion,
no unnecessary icons, labels or decorations.

## 2. Goals & Non-Goals

### Goals
- Instant startup and a tiny binary footprint.
- Plain-text and Markdown editing with zero visual noise.
- Workspace-based file browsing via an optional file tree.
- Live Markdown preview in a split pane.
- Light and dark themes, following the system theme by default.

### Non-Goals (v1)
- Plugins / extensions.
- Language servers, autocompletion, linting.
- Git integration.
- Multiple windows or tabs (one open document per window in v1).
- Rich-text / WYSIWYG editing.
- Cloud sync.

## 3. Tech Stack

| Layer            | Choice                                                                 |
|------------------|------------------------------------------------------------------------|
| Language (core)  | Rust (edition 2024)                                                    |
| App shell        | Tauri 2.x                                                              |
| Frontend         | TypeScript + lightweight UI (vanilla TS or Svelte/Solid — no heavy framework) |
| Editor component | CodeMirror 6 (plain text, Markdown, code via `@codemirror/legacy-modes`) |
| Markdown render  | Rust side: `pulldown-cmark` (CommonMark + GFM tables, task lists, strikethrough) |
| HTML sanitizing  | `ammonia` (sanitize rendered Markdown before injecting into preview)   |
| File watching    | `notify` crate                                                         |
| Config           | `serde` + TOML, stored in `~/.kayet/config.toml`                       |
| Paths            | `dirs` crate for home-directory resolution                             |
| Build / CI       | `cargo`, `tauri-cli`, GitHub Actions                                   |

Primary target: **macOS**. The code should not preclude Linux/Windows builds, but they are
not a v1 requirement.

macOS builds target **Apple Silicon (M-series, `aarch64-apple-darwin`) only**. Intel Macs
(`x86_64-apple-darwin`) and universal binaries are out of scope — no Intel builds are produced
in CI or releases.

## 4. Core Concepts

### 4.1 Workspace
- A workspace is a directory whose contents are shown in the file tree.
- **Default workspace:** `~/.kayet/workspace/`.
  - Created automatically on first launch if it does not exist.
- The user can change the workspace:
  - via the control bar (folder icon → native "Open Folder" dialog),
  - via menu `File → Open Workspace…` (`⌘⇧O`).
- The selected workspace path is persisted in `config.toml` and restored on next launch.
- If the persisted workspace no longer exists, fall back to the default workspace and
  show a subtle, non-blocking notice.
- "Reset to default workspace" action available in the menu.

### 4.2 Document
- One active document at a time.
- Files are opened from the file tree, via `⌘O`, or by drag-and-drop onto the window.
- Encoding: UTF-8. Line endings are preserved as found in the file.
- New untitled document: `⌘N`. On first save, the default location is the current workspace.
- `File → Close File` closes the open document (asking to save unsaved changes first) and
  leaves an empty untitled document; the closed file is no longer restored on next launch.

## 5. Window & Layout

```
┌───────────────────────────────────────────────────────────────────┐
│ ● ● ●            filename.md — edited            [⌂] [▤] [◐] [👁] │  ← title bar (hover only)
├──────────────┬─────────────────────────────┬──────────────────────┤
│ workspace    │                             │                      │
│  ▸ notes     │   Editor                    │   Markdown preview   │
│  ▾ drafts    │                             │   (optional)         │
│     a.md     │                             │                      │
│     b.txt    │                             │                      │
│ (optional)   │                             │                      │
└──────────────┴─────────────────────────────┴──────────────────────┘
```

Three regions, left to right:
1. **File tree** (optional, hidden by default).
2. **Editor** (always present).
3. **Preview pane** (optional, hidden by default, only for `.md` / `.markdown` files).

Both the file tree and the preview pane can be hidden at any time and are **hidden by default**,
so a fresh window shows only the editor. Each is shown on demand via its title bar control or
keyboard shortcut (`⌘\` for the file tree, `⌘⇧P` for the preview) and hidden again the same way.

### 5.1 Hidden chrome (default state)
- By default **everything except the text is hidden**, including the title bar.
- Window uses Tauri `decorations: false` with a transparent/overlay title bar
  (`titleBarStyle: "Overlay"`, `hiddenTitle: true`) so native traffic lights can be shown/hidden.
- The editor content fills the entire window, with comfortable padding.

### 5.2 Hover reveal
- Moving the mouse into the **top ~40px** of the window reveals the title bar:
  traffic lights, document title, and the control buttons.
- Moving the mouse to the **left edge (~12px)** reveals a small handle to open the file tree
  (only if the tree is currently hidden).
- Chrome fades in over **150ms** and fades out **~800ms after** the mouse leaves the hot zone.
- Chrome stays visible while:
  - the mouse is over it,
  - a menu, dialog or popover is open.
- Typing immediately hides revealed chrome (focus mode).
- The title bar area remains draggable (`data-tauri-drag-region`) when visible.
- Traffic lights are shown/hidden together with the title bar (via Tauri window API on macOS).

### 5.3 Title bar contents
- **Left:** native traffic lights.
- **Center:** document name, muted "— edited" suffix when unsaved; workspace-relative path on hover tooltip.
- **Right:** icon-only controls (monochrome, 16px, SF Symbols–like line icons):
  | Icon | Action | Shortcut |
  |------|--------|----------|
  | × (close) | Close the open file — **only shown when a file is open** | — |
  | Zen | Zen mode: cursor line kept vertically centered, extra top/bottom padding, all but the current paragraph dimmed | `⌘⇧J` |
  | Sidebar | Toggle file tree | `⌘\` |
  | Folder | Change workspace | `⌘⇧O` |
  | Code | Toggle syntax highlighting — **only shown for code and data/config files** | — |
  | Theme | Cycle theme: System → Light → Dark | `⌘⇧L` |
  | Eye (preview) | Toggle Markdown preview — **only shown for `.md` files** | `⌘⇧P` |

## 6. File Tree

- Hidden by default; can be shown and hidden at any time (`⌘\` or the sidebar control).
  Toggle state persisted in config.
- Shows the workspace root name as a muted header.
- Directories first, then files, both alphabetical (case-insensitive).
- Hidden files (dotfiles) not shown by default; toggle in config.
- Expand/collapse folders with click or `→` / `←`; open files with click or `Enter`.
- Double-clicking a file name renames it inline (`Enter` confirms, `Esc` cancels).
- Active file is highlighted with a subtle background pill.
- Context menu (right-click): New File, New Folder, Rename, Reveal in Finder, Move to Trash.
- Live updates via `notify` when files change on disk.
- Resizable width (drag the 1px divider), min 180px, max 400px, default 240px; persisted.
- Background: slightly translucent (macOS vibrancy / sidebar material where available).

## 7. Editor

- CodeMirror 6, no line numbers by default, no gutter, no minimap.
- Soft wrap on by default; max readable line width (~72ch) centered in the pane.
- Font: monospace by default (`SF Mono` via `ui-monospace`), optional system UI font (`-apple-system`) setting.
  Default size 15px, line height 1.6.
- Markdown syntax highlighting is subtle (weight/opacity changes, muted accent for links/code).
- Source code and data/config files (e.g. `.rs`, `.ts`, `.py`, `.json`, `.toml`, `.yaml`, `.xml`,
  `.csv`, `Dockerfile`) get syntax highlighting picked by file extension or well-known file name,
  using the same muted palette as preview code blocks. Grammars are loaded lazily per language.
- `View → Syntax Highlighting` (or the title bar code icon) toggles highlighting for code files; the setting is global and
  persisted. The item is disabled for plain text and Markdown files.
- Standard shortcuts: `⌘S` save, `⌘⇧S` save as, `⌘Z/⌘⇧Z` undo/redo, `⌘F` find, `⌘⌥F` replace,
  `⌘+/⌘-/⌘0` zoom.
- Autosave: off by default; optional setting to autosave after 1s of inactivity.
- Unsaved changes prompt on close / switching file (native dialog).
- External file change detection: if the file changed on disk and the buffer is clean,
  reload silently; if dirty, show a small inline banner: "File changed on disk — Reload / Keep mine".

## 8. Markdown Preview

- A **preview icon** (eye) appears in the title bar controls **only when the active file is
  `.md` or `.markdown`**.
- The preview is **hidden by default**, including when a Markdown file is opened.
- Clicking it opens the **right pane** with a rendered preview of the current document;
  clicking it again (or `⌘⇧P`) hides the pane.
- Split is 50/50 by default, resizable via 1px divider, persisted.
- Preview updates live while typing (debounced ~150ms).
- Rendering pipeline: frontend sends text → Rust command `render_markdown(text) -> html`
  (`pulldown-cmark` → `ammonia`) → injected into preview container.
- Supported: CommonMark, GFM tables, task lists, strikethrough, footnotes, fenced code blocks
  (with lightweight syntax highlighting), relative images resolved against the file's directory.
- Links open in the default browser; relative links to other `.md` files open them in the editor.
- Scroll sync between editor and preview (approximate, by source line mapping).
- Preview typography mirrors the app theme (light/dark), GitHub-like but more restrained.
- Preview state (open/closed) is remembered per session; it closes automatically when a
  non-Markdown file is opened.

## 9. Theming

- Three modes: **System** (default), **Light**, **Dark**.
- System mode follows macOS appearance and reacts live to changes (`prefers-color-scheme` +
  Tauri theme events).
- Theme choice is persisted in config.
- Implemented with CSS custom properties; no hardcoded colors in components.

### Palette (indicative)

| Token            | Light      | Dark       |
|------------------|------------|------------|
| `--bg`           | `#FFFFFF`  | `#161618`  |
| `--bg-sidebar`   | `#F7F7F8`  | `#1C1C1F`  |
| `--text`         | `#1D1D1F`  | `#EDEDEF`  |
| `--text-muted`   | `#8A8A8E`  | `#8A8A8F`  |
| `--border`       | `#E6E6E8`  | `#2A2A2E`  |
| `--accent`       | `#0891B2`  | `#22D3EE`  |
| `--selection`    | `#0891B233`| `#22D3EE33`|

- Corners: 6px radius on interactive elements.
- Motion: 150ms ease-out for fades; no bouncy animations.
- Icons: 1.5px stroke line icons, monochrome, `--text-muted`, `--text` on hover.

## 10. Configuration

Location: `~/.kayet/config.toml`

```toml
[workspace]
path = "~/.kayet/workspace"
show_hidden_files = false

[ui]
theme = "system"          # "system" | "light" | "dark"
sidebar_visible = false
zen_mode = false
sidebar_width = 240
preview_split = 0.5

[editor]
font_family = "mono"      # "mono" | "system"
font_size = 15
line_height = 1.6
soft_wrap = true
max_line_width = 72
autosave = false
syntax_highlighting = true  # code and data/config files

[window]
width = 1000
height = 700
x = 0
y = 0
```

- Missing file or keys → defaults are used and written back.
- Last opened file is restored on launch (if it still exists).

## 11. Architecture

```
kayet/
├── core/
│   ├── src/
│   │   ├── main.rs          # Tauri bootstrap, window setup
│   │   ├── commands.rs      # #[tauri::command] handlers
│   │   ├── workspace.rs     # workspace resolution, tree listing, watcher
│   │   ├── fs_ops.rs        # read/write/rename/create/trash
│   │   ├── markdown.rs      # pulldown-cmark + ammonia rendering
│   │   └── config.rs        # load/save ~/.kayet/config.toml
│   ├── Cargo.toml
│   └── tauri.conf.json
├── ui/
│   ├── index.html
│   ├── main.ts
│   ├── editor.ts            # CodeMirror setup
│   ├── languages.ts         # code languages by file extension (lazy-loaded)
│   ├── tree.ts              # file tree component
│   ├── preview.ts           # preview pane
│   ├── chrome.ts            # hover reveal logic, title bar
│   └── theme.css
└── SPEC.md
```

### Tauri commands (Rust → frontend API)

| Command                        | Description                                   |
|--------------------------------|-----------------------------------------------|
| `get_config() -> Config`       | Load current configuration                    |
| `set_config(cfg)`              | Persist configuration                         |
| `get_workspace() -> PathBuf`   | Current workspace path                        |
| `set_workspace(path)`          | Change workspace, restart watcher             |
| `list_dir(path) -> Vec<Entry>` | List directory entries (lazy tree loading)    |
| `read_file(path) -> String`    | Read file contents                            |
| `write_file(path, contents)`   | Atomic write (temp file + rename)             |
| `create_file / create_dir`     | Create entries                                |
| `rename(from, to)`             | Rename / move                                 |
| `trash(path)`                  | Move to Trash (`trash` crate)                 |
| `render_markdown(text, base)`  | Render sanitized HTML                         |
| `set_chrome_visible(bool)`     | Show/hide traffic lights (macOS)              |

### Events (Rust → frontend)
- `fs://changed` — file tree / open file changed on disk.
- `theme://changed` — system appearance changed.

### Security
- Tauri capabilities restrict FS access to the workspace and files explicitly opened by the user.
- Preview HTML is always sanitized; no scripts executed in preview.
- Strict CSP in `tauri.conf.json`.

## 12. Keyboard Shortcuts (summary)

| Action                 | Shortcut  |
|------------------------|-----------|
| New file               | `⌘N`      |
| Open file              | `⌘O`      |
| Open workspace         | `⌘⇧O`     |
| Save / Save as         | `⌘S` / `⌘⇧S` |
| Toggle file tree       | `⌘\`      |
| Toggle preview (.md)   | `⌘⇧P`     |
| Cycle theme            | `⌘⇧L`     |
| Find / Replace         | `⌘F` / `⌘⌥F` |
| Zoom in / out / reset  | `⌘+` / `⌘-` / `⌘0` |
| Show chrome (keyboard) | `⌘.` (hold/toggle) |

## 13. Performance Targets
- Cold start < 300ms to first paint on Apple Silicon.
- Idle memory < 80MB.
- Opening a 5MB text file without UI freeze.
- Preview render for a typical document (< 50KB) < 16ms.

## 14. Acceptance Criteria (v1)
1. On first launch, `~/.kayet/workspace/` is created and set as the workspace.
2. Launching the app shows only the editor text area — no title bar, no traffic lights, no file tree, no preview.
   The file tree and preview are hidden by default and can each be shown and hidden again.
3. Hovering the top edge reveals the title bar with traffic lights and controls; they fade out after the mouse leaves.
4. The file tree can be toggled and shows the workspace contents; changing the workspace updates the tree and is remembered across restarts.
5. Theme defaults to System and follows macOS appearance live; Light/Dark can be forced and are persisted.
6. Opening a `.md` file shows the preview icon; clicking it shows a live-updating rendered preview in the right pane. Non-Markdown files show no preview icon.
7. Files can be created, opened, edited, saved, renamed and trashed from within the app.
8. The UI uses a consistent, minimal macOS/Linear-style visual language in both themes.

## 15. Future Ideas (post-v1)
- Tabs / multiple windows.
- Command palette (`⌘K`), Linear-style.
- Fuzzy file finder (`⌘P`).
- Word count / reading time in the hover title bar.
- Export Markdown to PDF/HTML.
