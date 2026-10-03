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
- Multiple windows (one window; several documents are open in tabs, see 4.2).
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
- One active document at a time, several can be open in **tabs** (see 4.4).
- Files are opened from the file tree, the file finder (`⌘P`, see 5.5), workspace search (`⌘⇧F`, see 5.6), via `⌘O`, by drag-and-drop onto the window, from
  Finder or from the terminal (see 4.3).
- Encoding: UTF-8. Line endings are preserved as found in the file.
- `File → Open Recent` lists the last 10 opened files, most recent first, by name (files sharing a
  name get their folder appended); files that no longer exist are dropped, `Clear Menu` empties the
  list. Picking one opens it (asking to save unsaved changes first). The command palette offers the
  same list as `Open Recent…` (without the open document). The settings file is not recorded.
- New untitled document: `⌘N` (in place of the open document, or in a new tab — see 4.4). On first
  save, the default location is the current workspace.
- `File → Close File` (`⌘W`) closes the open document (asking to save unsaved changes first): its
  tab is closed, or, when it is the only one, an empty untitled document is left; the closed file is
  no longer restored on next launch.

### 4.4 Tabs
- `File → New Tab` (`⌘T`), the title bar + icon or the command palette open a new tab with an empty untitled document next to the current one.
- Opening a file that is open in a tab already shows that tab.
- Otherwise an opened file (file tree, finder, workspace search, `⌘O`, Open Recent, drag-and-drop,
  Finder, the `kayet` command, preview links, settings) and `⌘N` **replace the open document**
  (asking to save unsaved changes first) — the default. With `[ui] open_in_new_tab = true` they
  open in a new tab next to the current one instead; an untouched empty untitled document is
  replaced either way.
- With more than one tab open, the title bar shows a tab strip in place of the document name
  (see 5.3). A click shows a tab; its × (or a middle click) closes it. `⇧⌘]` / `⇧⌘[`
  (`Window → Show Next / Previous Tab`) and `⌃⇥` / `⌃⇧⇥` switch tabs, wrapping around.
- Each tab keeps its own undo history, selection and scroll position; the file tree, preview and
  settings are shared. Autosave saves a document before switching away from it.
- Closing the window asks about the unsaved changes of every tab, one by one.
- The files open in tabs (in order) and the active one are restored on next launch.

### 4.3 Finder & terminal
- kayet registers as an editor for `.md` / `.markdown` and `.txt` files, so they appear in
  Finder's "Open With" and open on double-click once kayet is the default app for them.
- `kayet` shell command: `kayet [file | folder]` opens a file (created empty if missing) or
  makes a folder the workspace, in the running instance or by launching kayet.
  - Installed via `kayet → Install ‘kayet’ Command` (or the command palette), which
    symlinks the launcher script bundled in `kayet.app/Contents/Resources/kayet` to
    `/usr/local/bin/kayet`, asking for an administrator password if needed.
- A file opened this way is opened like any other (in place of the current document or in a new
  tab, see 4.4) and, at launch, is shown instead of the restored active document. When several
  files are given only the first one is opened.

### 4.5 App updates
- kayet looks for a newer release on GitHub (the latest non-draft, non-prerelease release of
  `pwittchen/kayet`) ~10s after launch and once a day while running, unless
  `[updates] check_automatically = false`. Development builds never check on their own.
- `kayet → Check for Updates…` (or the command palette) checks right away and also reports when
  kayet is up to date or the check failed.
- When a newer version is found, a native dialog offers **Update**, **Skip This Version** (automatic
  checks don't offer that version again; a manual check still does) or **Later**.
- **Update** downloads the release's `.dmg`, verifies that the app inside has a valid signature
  from the same Developer ID team as the running app and replaces the running `kayet.app` with it
  (asking for an administrator password if its folder isn't writable; the old app is restored if
  that fails). kayet then restarts, asking about unsaved changes first; if that is cancelled, the
  new version starts next time.
- When kayet can't update itself (unsigned build, run from a disk image or a translocated copy,
  no `.dmg` in the release) or the install fails, the release page is opened in the browser instead.
- No HTTP client is bundled: the system's `curl`, `hdiutil`, `codesign` and `ditto` do the work.

### 4.6 About
- `kayet → About kayet` shows the standard macOS About panel (icon, name, version) with clickable
  links to the website ([getkayet.app](https://getkayet.app)), the source code on GitHub
  (`pwittchen/kayet`) and the author, Piotr Wittchen ([wittchen.io](https://wittchen.io)).

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
3. **Preview pane** (optional, hidden by default, only for `.md` / `.markdown` files and untitled
   documents written in Markdown).

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
- **Left:** native traffic lights, followed directly by the Sidebar icon (toggle file tree, `⌘\`).
- **Center:** document name, muted "— edited" suffix when unsaved; workspace-relative path on hover tooltip.
  With more than one tab open, a tab strip takes its place: each tab by name (the active one on a
  subtle pill), a dot while it has unsaved changes that turns into a close × on hover; the strip
  scrolls sideways when the tabs don't fit.
  For prose (Markdown, plain text, untitled — not code files, not in code editor mode) a muted `· 1,234 words · 6 min read`
  follows (200 words per minute, at least 1 min; past 60 min shown as hours and minutes, e.g.
  `1 h 12 min read` or `2 h read`; hidden for an empty document). Words are runs of
  non-whitespace containing a letter or digit, so Markdown markers (`#`, `-`, `>`) don't count.
  The count is refreshed only while the title bar is visible.
- **Right:** icon-only controls (monochrome, 16px, SF Symbols–like line icons):
  | Icon | Action | Shortcut |
  |------|--------|----------|
  | ● / ✓ (edit status) | ● appears once the document is edited and disappears when undone back to its original state; clicking it asks to save the changes, after which it turns into ✓ until the next edit — **hidden for an untouched document** | — |
  | × (close) | Close the open file — **only shown when a file or more than one tab is open** | — |
  | + (new tab) | Open a new tab with an empty untitled document (see 4.4) | `⌘T` |
  | ⌘ (command) | Open the command palette (see 5.4) | `⌘K` |
  | Clock (recent) | Open a recently opened file (the palette's Open Recent list) | — |
  | Zen | Zen mode: cursor line kept vertically centered, extra top/bottom padding, all but the current paragraph dimmed — **hidden in code editor mode** | `⌘⇧J` |
  | Numbered lines | Toggle code editor mode (off by default, see 7) | — |
  | Cursor (I-beam) | Toggle text cursor blinking (on by default); when off the cursor stays still | — |
  | Folder | Change workspace | `⌘⇧O` |
  | Code | Toggle syntax highlighting — **only shown for code and data/config files, or for any file in code editor mode** | — |
  | "A" with a wavy underline | Toggle spell check (off by default) — **only shown for prose files** (Markdown, plain text, untitled), hidden in code editor mode | — |
  | Sliders (settings) | Open `~/.kayet/config.toml` in the editor; saving it applies the changes | `⌘,` |
  | Theme | Cycle appearance: System → Light → Dark | `⌘⇧L` |
  | Presentation (screen) | Start presentation mode; turns into an exit icon while presenting (see 8.2) — **only shown for `.md` files and untitled documents** | — |
  | Eye (preview) | Toggle Markdown preview — **only shown for `.md` files and untitled documents written in Markdown** (see 8) | `⌘⇧P` |

### 5.4 Command palette
- Spotlight-like floating panel, centered near the top of the window, opened with `⌘K`,
  `View → Command Palette…` or the title bar command icon.
- Lists every command with its shortcut; context-only commands (Close File, next / previous tab,
  preview, presentation, export, syntax highlighting, spell check, Zen mode) appear only when they apply.
- Typing filters the list (substring and in-order fuzzy match); `↑` / `↓` move the selection,
  `Enter` or a click runs the command, `Esc`, `⌘K` again or a click outside closes it.

### 5.5 File finder
- `⌘P` (`File → Go to File…` or the command palette) opens the same floating panel listing every
  file in the workspace (recursively), each shown by name with its folder muted beside it.
- Hidden files follow the `show_hidden_files` setting; symlinked folders and `node_modules` /
  `target` folders are skipped, and at most 20,000 files are listed.
- Typing filters fuzzily: matches in the file name rank above matches elsewhere in the path, a
  query containing `/` matches against the whole relative path, spaces are ignored.
- `↑` / `↓` move the selection, `Enter` or a click opens the file (asking to save unsaved changes
  first), `Esc`, `⌘P` again or a click outside closes it.

### 5.6 Workspace search
- `⌘⇧F` (`Edit → Find in Workspace…` or the command palette) opens the same floating panel to
  search the text of every file the file finder lists (see 5.5).
- The query is matched literally, ignoring case unless it contains an upper-case letter; the search
  runs ~150ms after typing pauses. Binary, non-UTF-8 and files over 5MB are skipped; files are
  searched as saved on disk.
- Each matching line is one result (at most 200, in path order): the line with the match highlighted
  (long lines are cut around it), and its workspace-relative path and line number muted on the right.
- `↑` / `↓` move the selection, `Enter` or a click opens the file (asking to save unsaved changes
  first), selects the match with the line centered and makes the query the find query, so `⌘G`
  continues to the next occurrence. `Esc`, `⌘⇧F` again or a click outside closes it.

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
- Code editor mode, **off by default**: `View → Code Editor Mode`, the title bar numbered-lines
  icon or the command palette toggle
  it; the setting is global and persisted. It lays the text out like a typical code editor: line
  numbers in a gutter, the cursor line and matching brackets highlighted, monospace font with
  line height 1.5, no soft wrap, and no readable column or side / bottom paddings (the text starts
  at the left edge; the top keeps the first line clear of the title bar). While it is on, Zen mode
  and spell check cannot be enabled: their View menu items are disabled, their title bar icons and
  palette commands are hidden, and both are off (their settings are kept and apply again once
  code editor mode is turned off). Turning code editor mode on also turns syntax highlighting on,
  and turning it off turns syntax highlighting off; in between, highlighting can still be toggled
  as usual.
  The title bar word count and reading time are hidden in this mode.
- Soft wrap on by default; max readable line width (~72ch) centered in the pane.
- Font: monospace by default (`SF Mono` via `ui-monospace`), optional system UI font (`-apple-system`) setting.
  Default size 15px, line height 1.6.
- Markdown syntax highlighting is subtle (weight/opacity changes, muted accent for links/code).
- Smart Markdown editing (Markdown files only, no UI of its own):
  - `Enter` continues bullet, numbered (renumbered as needed) and task lists (a new item gets an
    unchecked `[ ]` box) and block quotes; `Enter` on an empty item ends the list, `Backspace`
    right after a list marker removes it.
  - `⌘B` / `⌘I` wrap the selection in `**` / `*` (or insert an empty pair at the cursor) and
    unwrap it again when it is already bold / italic.
  - Pasting a URL over selected text turns it into a link: `[text](url)`.
  - Pasting an image saves it next to the file as `<file name>-<n>.<ext>` (never overwriting) and
    inserts `![](…)` pointing to it; an untitled document has to be saved first.
- Source code and data/config files (e.g. `.rs`, `.ts`, `.py`, `.json`, `.toml`, `.yaml`, `.xml`,
  `.csv`, `Dockerfile`) get syntax highlighting picked by file extension or well-known file name,
  using the same muted palette as preview code blocks. Grammars are loaded lazily per language.
- `View → Syntax Highlighting` (or the title bar code icon) toggles highlighting for code files; the setting is global and
  persisted. The item is disabled for plain text and Markdown files, except in code editor mode.
- Spell check for prose (Markdown, plain text, untitled — not code files), **off by default**:
  `View → Check Spelling`, the title bar spell check icon or the command palette toggle it; the
  setting is global and persisted. It uses the web view's built-in (macOS) spell checker:
  misspelled words are underlined, and right-clicking one offers suggestions. Nothing is
  corrected automatically. Existing text is checked right away — when spell check is turned on,
  a file is opened and scrolling stops — not only once it is edited. The item is disabled for code files.
- Standard shortcuts: `⌘S` save, `⌘⇧S` save as, `⌘Z/⌘⇧Z` undo/redo, `⌘F` find, `⌘R` replace,
  `⌘+/⌘-/⌘0` zoom.
- Find / replace (Firefox-style): `⌘F` docks a slim bar across the bottom of the editor with the
  find field, previous / next (`⇧↩` / `↩`, `⇧⌘G` / `⌘G`), toggles for match case (`Aa`), regular
  expression (`.*`) and whole words (`W`), the match count ("3 of 12", "No matches") and a close
  button (`Esc`). Typing jumps to the first match from the cursor; the field turns red when nothing
  matches. `⌘R` shows the same bar with a replace field after the options (`↩` replace, `⌘↩` / All
  replace all); `⌘F` hides it again. A selected single-line text becomes the query.
- Autosave: off by default; optional setting to autosave after 1s of inactivity.
- Unsaved changes prompt on close / switching file (native dialog).
- Crash recovery: while any document (a file or untitled, in any tab) has unsaved changes, a backup
  of those documents is kept in `~/.kayet/recovery/` (written at most ~1s after an edit; when
  they add up to over ~10MB, once typing pauses for 2s, but at most 30s after an edit). It is
  removed once all changes are saved or discarded and when the window closes normally, so a backup
  found at launch means kayet did not exit cleanly: a native dialog offers to **Restore** the changes
  (each reopens in a tab as unsaved edits to its file, or as an untitled document, in place of the
  start documents) or **Discard** them.
- Large files (over ~10MB of text) open in **large file mode**: no Markdown preview (its icon and
  palette command are hidden), no syntax highlighting (the toggle is disabled), no smart Markdown
  editing and no word count, since each of those goes over the whole text on every edit. Opening
  one shows a toast: "Large file: preview, highlighting and word count are off". The mode follows
  the document's length, so it also turns on / off when an edit crosses the limit.
- External file change detection: if the file changed on disk and the buffer is clean,
  reload silently; if dirty, show a small inline banner: "File changed on disk — Reload / Keep mine".
  A document in a tab that is not shown is checked when its tab is shown.

## 8. Markdown Preview

- A **preview icon** (eye) appears in the title bar controls **only when the active file is
  `.md` or `.markdown`**, or when it is an **untitled document written in Markdown**: once its
  text (checked ~300ms after typing pauses) holds Markdown syntax — a heading, list item, quote,
  code fence or table line, or bold text, a link, an image or inline code — the icon appears and
  stays until the document is saved. Saved under another extension, it loses the preview.
- The preview is **hidden by default**, including when a Markdown file is opened.
- Clicking it opens the **right pane** with a rendered preview of the current document;
  clicking it again (or `⌘⇧P`) hides the pane.
- Split is 50/50 by default, resizable via 1px divider, persisted.
- Preview updates live while typing (debounced ~150ms).
- Rendering pipeline: frontend sends text → Rust command `render_markdown(text) -> html`
  (`pulldown-cmark` → `ammonia`) → injected into preview container.
- Supported: CommonMark, GFM tables, task lists, strikethrough, footnotes, fenced code blocks
  (with lightweight syntax highlighting), relative images resolved against the file's directory
  (also in raw HTML `<img>` tags).
- Web images (`http(s)`) are downloaded once into `~/.kayet/cache/images/` (up to 20MB each,
  named by a hash of the URL) and shown from there; an image that can't be downloaded is
  tried again after a minute.
- Links open in the default browser; relative links to other `.md` files open them in the editor.
- Scroll sync between editor and preview (approximate, by source line mapping).
- Preview typography mirrors the app theme (light/dark), GitHub-like but more restrained.
- Preview state (open/closed) is remembered per session; it closes automatically when a
  non-Markdown file is opened (or an untitled document is saved as one).

### 8.1 Export
- `File → Export as HTML…` / `Export as PDF…` (or the command palette) export the open Markdown
  file as currently edited (unsaved changes included); the items are disabled for other files.
  A native save dialog proposes `<file name>.html` / `.pdf` next to the document.
- Both are rendered like the preview (same Markdown features and code highlighting), without
  any app chrome. Relative links are kept as written.
- **HTML:** a single self-contained page — the preview typography is inlined, local images and
  the downloaded copies of web images are embedded as `data:` URIs (images that can't be read link to the file instead), no scripts.
  It follows the reader's light / dark appearance; its title is the first `#` heading, else the
  file name.
- **PDF:** written directly (no print dialog) through the web view's native print operation:
  paginated with the system's default paper size, 0.75in margins, always light, code wrapped.

### 8.2 Presentation mode
- Markdown files (`.md` / `.markdown`) and untitled documents can be presented as slides; code and
  other files can't (no icon, no palette command, the menu item does nothing). Large files (see 7) can't either.
- Slides are the parts of the document between lines of `---` (three or more dashes, up to three
  spaces of indent, nothing else on the line); such lines inside fenced code blocks don't count.
  Slides with only whitespace are skipped; a document without separators is one slide.
- The presentation icon in the title bar (next to the preview eye), `View → Toggle Presentation`
  or the command palette (`Start Presentation`) start it from the first slide, showing the
  document as currently edited (unsaved changes included).
- One slide fills the window (over the editor, file tree and preview), vertically centered when
  it fits and scrollable when it doesn't, rendered like the preview in larger type that scales
  with the window. Previous / next buttons sit on the left and right edges (disabled on the first /
  last slide), the slide number and count (`2 / 10`) in the lower right corner. On the last slide
  a button to the left of the count goes back to the first slide.
- `←` / `→`, `Page Up` / `Page Down`, `Space` / `⇧Space` move between slides, `Home` / `End` go to
  the first / last one.
- The title bar stays hover-revealed; its presentation icon turns into an exit icon. Clicking it,
  `Esc` or `Exit Presentation` in the palette returns to the editor. Opening another document or
  switching tabs ends the presentation too. Changes to the document meanwhile (e.g. reloaded from
  disk) are followed.

## 9. Theming

- The palette (`theme`) and the appearance mode (`mode`) are separate: `theme` picks
  *which* colors, `mode` picks *when* light or dark is used. Both are persisted in config.
- `theme = "kayet"` (default) is the built-in palette; any other value is the name of a
  theme file, `~/.kayet/themes/<name>.toml` (letters, digits, `_` and `-` only; `kayet`,
  `system`, `light` and `dark` are reserved). A file holds the base token colors per
  variant (hex: `#rgb`, `#rrggbb` or `#rrggbbaa`):

```toml
[dark]
bg = "#282828"
text = "#ebdbb2"
# bg-sidebar, text-muted, border, accent, selection, caret,
# hl-keyword, hl-string, hl-number, hl-title, hl-comment

[light]  # optional
bg = "#fbf1c7"
# ...
```

  A theme is the matching built-in (light or dark) with the file's colors on top; unknown
  keys and non-hex values are ignored. Either section may be missing: a single-variant
  theme then looks the same in both modes. A missing or invalid file falls back to the
  built-in palette with a subtle, non-blocking notice, as do ignored colors. Activating a
  theme is config-only (applied on save, like other settings), or picked from `Switch
  Theme…` in the command palette, which lists every palette and applies the pick
  immediately. Themes in `themes/` (currently `gruvbox`) are bundled with the app and
  always listed; a file of the same name in `~/.kayet/themes/` overrides a bundled one.
  Theme files should cite their palette's source in a comment.
- `mode = "system"` (default) follows macOS appearance and reacts live to changes
  (`prefers-color-scheme` + Tauri theme events); `light` / `dark` pin one variant.
- The pre-palette `theme` values `system` / `light` / `dark` keep working as shorthand
  for the built-in palette with that mode; an explicitly set `mode` wins over the
  shorthand, and cycling the mode or saving settings normalizes them to `theme` + `mode`.
- `⌘⇧L` (View → Cycle Appearance) cycles the mode System → Light → Dark, for any palette.
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
theme = "kayet"           # palette: "kayet" (built-in) or a file from ~/.kayet/themes/ (see 9)
mode = "system"           # "system" | "light" | "dark"
sidebar_visible = false
zen_mode = false
code_mode = false         # code editor mode: line numbers, no paddings / wrapping (see 7)
sidebar_width = 240
preview_split = 0.5
open_in_new_tab = false   # open files (and ⌘N) in a new tab instead of in place of the open one

[editor]
font_family = "mono"      # "mono" | "system"
font_size = 15
line_height = 1.6
soft_wrap = true
max_line_width = 72
autosave = false
syntax_highlighting = true  # code and data/config files
cursor = "blink"            # "blink" | "steady" (no blinking)
spell_check = false         # prose files (Markdown, plain text, untitled)

[window]
width = 1000
height = 700
x = 0
y = 0

[updates]
check_automatically = true  # look for a new kayet release at launch and once a day (see 4.5)
```

- Missing file or keys → defaults are used and written back.
- The file can be edited in kayet itself (`kayet → Settings…`, `⌘,`, or the title bar sliders icon);
  saving it applies the changes immediately. Window geometry, the workspace path and the session
  are owned by the running app and are not reloaded.
- The files open in tabs and the active one are restored on launch (those that still exist). They
  and the recent files are kept in a `[session]` table (`open_files`, `last_file`, `recent_files`),
  together with a release the user chose to skip (`skipped_version`).

## 11. Architecture

```
kayet/
├── core/
│   ├── src/
│   │   ├── main.rs          # Tauri bootstrap, window setup, Finder "open" events
│   │   ├── cli.rs           # installs the `kayet` shell command
│   │   ├── commands.rs      # #[tauri::command] handlers
│   │   ├── workspace.rs     # workspace resolution, tree listing, watcher
│   │   ├── fs_ops.rs        # read/write/rename/create/trash
│   │   ├── search.rs        # workspace-wide text search
│   │   ├── markdown.rs      # pulldown-cmark + ammonia rendering
│   │   ├── export.rs        # PDF export (web view print operation)
│   │   ├── image_cache.rs   # web images downloaded into ~/.kayet/cache/images/
│   │   ├── recovery.rs      # crash recovery backup in ~/.kayet/recovery/
│   │   ├── update.rs        # app update check and install (GitHub Releases)
│   │   ├── config.rs        # load/save ~/.kayet/config.toml
│   │   └── themes.rs        # bundled themes + themes from ~/.kayet/themes/
│   ├── cli/kayet            # `kayet` launcher script (bundled as a resource)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── ui/
│   ├── index.html
│   ├── main.ts
│   ├── editor.ts            # CodeMirror setup
│   ├── markdown.ts          # smart Markdown editing (lists, ⌘B / ⌘I, pasting)
│   ├── languages.ts         # code languages by file extension (lazy-loaded)
│   ├── tree.ts              # file tree component
│   ├── palette.ts           # command palette (⌘K), file finder (⌘P), workspace search (⌘⇧F)
│   ├── preview.ts           # preview pane
│   ├── presentation.ts      # presentation mode (slides divided by ---)
│   ├── export.ts            # HTML / PDF export
│   ├── images.ts            # web images shown from their downloaded copies
│   ├── markdown-body.css    # rendered Markdown typography (preview and exports)
│   ├── chrome.ts            # hover reveal logic, title bar
│   ├── theme.ts             # theme colors (see 9)
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
| `list_files() -> Vec<String>`  | Every workspace file, for the file finder     |
| `search_workspace(query) -> Vec<Match>` | Lines containing the query, for workspace search |
| `read_file(path) -> bytes`     | Read file contents (UTF-8, as raw bytes)      |
| `write_file(path, bytes)`      | Atomic write (temp file + rename); the text as raw bytes |
| `save_image(document, bytes)`  | Save a pasted image next to the document      |
| `write_recovery(backups, bytes) / clear_recovery` | Keep / remove the crash recovery backup of the unsaved tabs |
| `load_recovery() -> Vec<Backup>` | Buffers backed up before an unclean exit (empty if none) |
| `create_file / create_dir`     | Create entries                                |
| `rename(from, to)`             | Rename / move                                 |
| `trash(path)`                  | Move to Trash (`trash` crate)                 |
| `render_markdown(text, base)`  | Render sanitized HTML                         |
| `render_export(text, base)`    | Render sanitized HTML for export (no line anchors, links as written) |
| `read_image(path) -> bytes`    | An image the preview may show, to embed into an HTML export |
| `cache_image(url) -> path`     | Download a web image (once) into `~/.kayet/cache/images/` |
| `export_pdf(path)`             | Print the document prepared for printing into a PDF |
| `set_export_enabled(bool)`     | Enable / disable File → Export as HTML… / PDF… |
| `set_chrome_visible(bool)`     | Show/hide traffic lights (macOS)              |
| `get_theme(name) -> Theme`   | Load a theme from `~/.kayet/themes/` or a bundled one |
| `list_themes() -> Vec<String>` | Names of the bundled themes and those in `~/.kayet/themes/` |
| `take_opened() -> Opened`      | File / folder kayet was launched to open      |
| `add_recent(path)`             | Record an opened file for File → Open Recent  |
| `recent_files() -> Vec<String>` / `allow_recent(path)` | Recent files for the command palette / allow opening one |
| `install_cli()`                | Install the `kayet` shell command             |
| `check_for_updates()`          | Look for a new release and offer to install it |
| `restart_app()`                | Restart into the update just installed        |

### Events (Rust → frontend)
- `fs://changed` — file tree / open file changed on disk.
- `theme://changed` — system appearance changed.
- `open://requested` — a file / folder was opened from Finder, the `kayet` command or File → Open Recent.
- `notice` — a non-blocking message to show (e.g. a recent file no longer exists).
- `update://installed` — a new kayet version was installed; the frontend restarts into it.

### Security
- Tauri capabilities restrict FS access to the workspace and files explicitly opened by the user.
- Preview HTML is always sanitized; no scripts executed in preview.
- Strict CSP in `tauri.conf.json`.

## 12. Keyboard Shortcuts (summary)

| Action                 | Shortcut  |
|------------------------|-----------|
| New file               | `⌘N`      |
| New tab                | `⌘T`      |
| Next / previous tab    | `⇧⌘]` / `⇧⌘[`, `⌃⇥` / `⌃⇧⇥` |
| Open file              | `⌘O`      |
| Go to file (finder)    | `⌘P`      |
| Open workspace         | `⌘⇧O`     |
| Save / Save as         | `⌘S` / `⌘⇧S` |
| Close file / window    | `⌘W` / `⌘⇧W` |
| Toggle file tree       | `⌘\`      |
| Toggle preview (.md)   | `⌘⇧P`     |
| Settings (config file) | `⌘,`      |
| Command palette        | `⌘K`      |
| Cycle appearance       | `⌘⇧L`     |
| Find / Replace         | `⌘F` / `⌘R`  |
| Find in workspace      | `⌘⇧F`     |
| Bold / italic (.md)    | `⌘B` / `⌘I` |
| Zoom in / out / reset  | `⌘+` / `⌘-` / `⌘0` |
| Show chrome (keyboard) | `⌘.` (hold/toggle) |

## 13. Performance Targets
- Cold start < 300ms to first paint on Apple Silicon.
- Idle memory < 80MB.
- Opening a 5MB text file without UI freeze.
- Typing in it (title bar shown) without UI freeze, including the work each edit schedules.
- Preview render for a typical document (< 50KB) < 16ms.

## 14. Acceptance Criteria (v1)
1. On first launch, `~/.kayet/workspace/` is created and set as the workspace.
2. Launching the app shows only the editor text area — no title bar, no traffic lights, no file tree, no preview.
   The file tree and preview are hidden by default and can each be shown and hidden again.
3. Hovering the top edge reveals the title bar with traffic lights and controls; they fade out after the mouse leaves.
4. The file tree can be toggled and shows the workspace contents; changing the workspace updates the tree and is remembered across restarts.
5. Appearance mode defaults to System and follows macOS appearance live; Light/Dark can be forced and are persisted.
6. Opening a `.md` file shows the preview icon; clicking it shows a live-updating rendered preview in the right pane. Non-Markdown files show no preview icon; an untitled document shows it once Markdown is typed into it.
7. Files can be created, opened, edited, saved, renamed and trashed from within the app.
8. The UI uses a consistent, minimal macOS/Linear-style visual language in both variants.

## 15. Future Ideas (post-v1)
- Multiple windows.
