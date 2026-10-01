# kayet architecture

This document describes how kayet is put together: the processes, the modules on each side
of the IPC boundary and how data flows between them. For product behavior and design see
[SPEC.md](SPEC.md); for build commands see [README.md](README.md).

## Overview

kayet is a single-window Tauri 2 app. A Rust backend (`core/`) owns everything that touches
the system: the file system, config, native menus and dialogs, Markdown rendering, search,
PDF printing and app updates. A vanilla TypeScript frontend (`ui/`) runs inside the macOS
WKWebView and owns everything the user sees and types into: the CodeMirror 6 editor, tabs,
file tree, preview, command palette and the auto-hiding chrome.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          kayet.app  (single process)                         │
│                                                                              │
│  ┌──────────────────────────────┐          ┌──────────────────────────────┐  │
│  │  Frontend — ui/ (WKWebView)  │          │  Backend — core/ (Rust)      │  │
│  │                              │  invoke  │                              │  │
│  │  main.ts      app state,     │ ───────▶ │  commands.rs  #[command]s,   │  │
│  │               tabs, session  │          │               AppState       │  │
│  │  editor.ts    CodeMirror 6   │  events  │  main.rs      setup, window  │  │
│  │  preview.ts   Markdown pane  │ ◀─────── │               & menu events  │  │
│  │  tree.ts      file tree      │          │                              │  │
│  │  palette.ts   palette/search │          │  fs_ops · workspace · search │  │
│  │  chrome.ts    hover chrome   │          │  markdown · export · recovery│  │
│  │  export.ts    HTML / PDF     │          │  config · menu · chrome      │  │
│  │  api.ts       typed invoke() │          │  update · cli                │  │
│  └──────────────────────────────┘          └──────────────┬───────────────┘  │
│                                                           │                  │
└───────────────────────────────────────────────────────────┼──────────────────┘
                                                            │
           ┌──────────────────────┬─────────────────────────┼───────────────────┐
           ▼                      ▼                         ▼                   ▼
   ┌───────────────┐   ┌─────────────────────┐   ┌───────────────────┐  ┌──────────────┐
   │ File system   │   │ ~/.kayet/           │   │ macOS / AppKit    │  │ GitHub       │
   │ workspace +   │   │  config.toml        │   │ menus, dialogs,   │  │ Releases     │
   │ user-picked   │   │  workspace/         │   │ traffic lights,   │  │ (via curl,   │
   │ files         │   │  recovery/          │   │ Trash, print op   │  │  hdiutil …)  │
   └───────────────┘   └─────────────────────┘   └───────────────────┘  └──────────────┘
```

## Repository layout

```
kayet/
├── core/                   Rust backend — the Tauri app crate (only workspace member)
│   ├── src/
│   │   ├── main.rs         entry point: builder, setup, window / menu / open events
│   │   ├── commands.rs     every #[tauri::command] + AppState (access control, open queue)
│   │   ├── config.rs       ~/.kayet/config.toml load / save (TOML, serde defaults)
│   │   ├── workspace.rs    workspace resolution, list_dir, list_files, fs watcher
│   │   ├── fs_ops.rs       read, atomic write, create, rename, trash, save image
│   │   ├── search.rs       workspace-wide literal text search
│   │   ├── markdown.rs     pulldown-cmark → ammonia sanitizer, line anchors
│   │   ├── export.rs       PDF export through NSPrintOperation on the web view
│   │   ├── image_cache.rs  web images downloaded via curl into ~/.kayet/cache/images/
│   │   ├── recovery.rs     crash recovery backup (~/.kayet/recovery/buffer.json)
│   │   ├── update.rs       update check / install from GitHub Releases
│   │   ├── menu.rs         native menu bar, Open Recent, check items, About
│   │   ├── chrome.rs       traffic lights visibility, spell checking (objc2)
│   │   └── cli.rs          installs the `kayet` shell command
│   ├── cli/kayet           shell launcher (→ `open -b com.github.pwittchen.kayet`)
│   ├── capabilities/       Tauri permissions
│   └── tauri.conf.json     window, CSP, asset protocol, bundle
├── ui/                     TypeScript frontend (no framework), built by Vite into dist/
│   ├── index.html          static DOM skeleton (sidebar, editor, preview, presentation, title bar)
│   ├── main.ts             app controller: tabs, open / save, autosave, recovery, commands
│   ├── api.ts              typed wrappers for backend commands + path helpers
│   ├── editor.ts           CodeMirror setup, settings, snapshots per tab
│   ├── markdown.ts         smart Markdown editing (lists, bold / italic, pasting images),
│   │                       Markdown detection for untitled documents
│   ├── languages.ts        code highlighting by file extension (lazy legacy modes)
│   ├── find.ts             in-document find / replace bar
│   ├── preview.ts          debounced preview rendering, links, scroll sync
│   ├── presentation.ts     presentation mode: slides split at `---`, rendered like the preview
│   ├── highlight.ts        highlight.js for code blocks in the preview (lazy)
│   ├── export.ts           HTML / PDF export
│   ├── images.ts           web images → their downloaded copies (preview and export)
│   ├── tree.ts             file tree
│   ├── palette.ts          command palette, file finder, workspace search
│   ├── chrome.ts           auto-hiding title bar and left-edge handle
│   ├── stats.ts            word count
│   ├── bench.ts            self-measurement (only with KAYET_BENCH set)
│   └── theme.css, markdown-body.css
├── scripts/                dev.mjs (Vite launcher), bench.mjs (SPEC §13 checks)
├── website/                getkayet.app
└── .github/workflows/      rust.yml (CI), release.yml (sign + notarize + publish)
```

## Build pipeline

The frontend is compiled first and embedded into the Rust binary at compile time, so the
shipped app is one executable with no external web assets.

```
  ui/*.ts, *.css, index.html
            │
            │  npm run build   (tsc --noEmit && vite build)
            ▼
         dist/  ─────────────────────────┐
                                         │  embedded by tauri::generate_context!()
  core/src/*.rs ──── cargo build ────────┤
                                         ▼
                              target/release/kayet
                                         │
                                         │  npx tauri build --bundles app / dmg
                                         ▼
                                   kayet.app  (+ .dmg)
                                         │
                                         │  release.yml on a vX.Y.Z tag:
                                         │  codesign → notarize → staple
                                         ▼
                                  GitHub Releases
```

In dev mode (`npx tauri dev`) the web view loads from the Vite dev server on
`localhost:1420` instead of `dist/`, so frontend changes hot-reload.

## Frontend ↔ backend communication

There are exactly two channels:

- **Commands** (frontend → backend): `invoke()` calls, all wrapped in `ui/api.ts` and handled
  in `core/src/commands.rs`. Most take JSON arguments. File contents, saves, pasted images and
  recovery backups travel as **raw bytes** (with metadata in `kayet-*` request headers),
  because encoding multi-MB strings as JSON is slow.
- **Events** (backend → frontend): `app.emit(...)`, subscribed with `listen()` in `main.ts`.

```
  Frontend (ui/)                                              Backend (core/)
  ──────────────                                              ───────────────

  api.readFile(path) ──────── invoke("read_file") ─────────▶  authorize → fs_ops::read_file
                     ◀──────── ArrayBuffer (UTF-8) ─────────
  api.writeFile(p, s) ─────── invoke("write_file",           authorize → fs_ops::write_atomic
                               bytes, kayet-path header) ─▶
  api.renderMarkdown ──────── invoke("render_markdown") ───▶  markdown::render
                     ◀──────── sanitized HTML ──────────────
  api.searchWorkspace ─────── invoke("search_workspace") ──▶  search::search
  api.writeRecovery ───────── invoke("write_recovery",       recovery::write
                               bytes, kayet-backups) ─────▶
  api.confirm* / *Dialog ──── invoke(...) ─────────────────▶  tauri-plugin-dialog (native)
  api.exportPdf ───────────── invoke("export_pdf") ────────▶  export::pdf (NSPrintOperation)
            …                                                   …

  listen("menu")              ◀──── menu item id ───────────  on_menu_event (main.rs)
  listen("fs://changed")      ◀──── { paths } ──────────────  FsWatcher (workspace.rs)
  listen("theme://changed")   ◀──── "dark" | "light" ───────  WindowEvent::ThemeChanged
  listen("file://dropped")    ◀──── { path } ───────────────  WindowEvent::DragDrop
  listen("open://requested")  ◀──── { file, folder } ───────  RunEvent::Opened (Finder / CLI)
  listen("update://installed")◀──── version ────────────────  update.rs
  listen("notice")            ◀──── message ────────────────  commands.rs, update.rs
```

Native menu items are routed by id: Open Recent, Clear Recent and About are handled in Rust
(the backend owns those lists and windows); every other id is forwarded as a `menu` event and
dispatched by `run(id)` in `main.ts`, the same function the command palette uses.

## Security model

The web view can only reach the file system through backend commands, and every path-taking
command goes through `AppState::authorize`:

```
                     path from the frontend
                              │
                              ▼
                     canonical(path)  (resolve symlinks, ..)
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   inside the workspace?             in the `allowed` set?
             │                                 │
             └──────── either ───────┬─────────┘
                                     │
                     yes ◀───────────┴───────────▶ no
                      │                            │
                      ▼                            ▼
              run the operation          Err("access denied: …")
```

The `allowed` set holds files the user picked explicitly: open / save dialogs, drag and drop,
Finder / the `kayet` command, Open Recent and the files restored from the last session. When a
file is allowed, its directory is also added to the asset protocol scope, so the preview can
show images next to it; so is `~/.kayet/cache/images/` (downloaded web images). On top of that:

- Rendered Markdown is sanitized by `ammonia` before it reaches the DOM.
- The CSP (`tauri.conf.json`) allows scripts only from the app itself, no frames, no objects,
  and network access only to the IPC endpoint.
- Updates are installed only if the downloaded app is signed by the same Developer ID team as
  the running one.

## Backend

### Startup

```
  main()
    │
    ├─ chrome::enable_spell_checking()
    ├─ config::load_from(~/.kayet/config.toml)        (missing / invalid → defaults)
    ├─ workspace::resolve(config.workspace.path)      (gone → ~/.kayet/workspace + notice)
    │
    └─ tauri::Builder
         ├─ .plugin(tauri_plugin_dialog)
         ├─ .manage(AppState { config, workspace, watcher, allowed, notice, opened })
         ├─ .menu(menu::build)
         ├─ .setup(|app| {
         │      save_config · start_watcher · refresh_recent_menu
         │      update::start_background_checks        (release builds, after 10s, daily)
         │      allow asset dirs of restored files
         │      restore window geometry · hide traffic lights · show window
         │  })
         ├─ .on_window_event(…)   geometry, theme, drag & drop, save config on destroy
         ├─ .invoke_handler(…)    all commands in commands.rs
         └─ .run(…)               RunEvent::Opened → AppState::open_paths
```

Files and folders opened from Finder or the `kayet` command before the frontend is ready are
held in an `OpenQueue` and picked up by the frontend with `take_opened`; later ones are emitted
as `open://requested`.

### Shared state

`AppState` (in `commands.rs`) is the only shared state, each field behind its own `Mutex`:

| Field       | Contents                                                          |
|-------------|-------------------------------------------------------------------|
| `config`    | the loaded `Config`, written back to `config.toml` on change      |
| `workspace` | canonical workspace root                                          |
| `watcher`   | `FsWatcher` on the workspace (restarted when the workspace moves) |
| `allowed`   | files the user picked outside the workspace                       |
| `notice`    | one-time message for the frontend (e.g. workspace fallback)       |
| `opened`    | queue of Finder / CLI open requests                               |

### Module dependencies

Arrows point from a module to the modules it uses; lower layers never call upward
(`update.rs` only reaches back for `AppState`). `main.rs` also uses `config`, `workspace`,
`menu` and `chrome` directly during startup.

```
  entry        main.rs ─────────────────────────────┐
                  │                                 │
                  ▼                                 ▼
  API          commands.rs  ◀────────────────  update.rs
                  │                          (AppState, dialogs)
                  │
                  ├──────────┬───────────┬───────────┬──────────┬─────────┐
                  ▼          ▼           ▼           ▼          ▼         ▼
  features     search.rs  markdown.rs  export.rs  recovery.rs  menu.rs  cli.rs
                  │                                 │           │       chrome.rs
                  ▼                                 │           │
  storage      workspace.rs                         │           │
                  │                                 │           │
                  ▼                                 │           │
               config.rs  ◀─────────────────────────┴───────────┘
                  │                                 │
                  ▼                                 │
  base         fs_ops.rs  ◀─────────────────────────┘
```

### File watching

`workspace::FsWatcher` wraps `notify` (FSEvents) on the workspace root and coalesces bursts of
events (100ms) into one `fs://changed { paths }` event. The frontend refreshes the tree and, if
the open document is among the paths, compares it with the disk and shows the
"File changed on disk" banner when both sides changed.

## Frontend

### Structure

`main.ts` is the controller: it holds the tabs, the active document, config and session, wires
the components together through callbacks and handles every command id. The other modules are
self-contained components that know nothing about each other.

```
                                  main.ts
      (tabs, active doc, config, session, autosave, recovery, disk-change banner, run(id))
     ┌─────────┬──────────┬──────────┬─────────┬──────────┬──────────┬──────────┐
     ▼         ▼          ▼          ▼         ▼          ▼          ▼          ▼
  Editor    Preview   FileTree    Palette   Chrome     export.ts  stats.ts  bench.ts
 editor.ts preview.ts  tree.ts  palette.ts chrome.ts
     │         │
     │         ├─▶ highlight.ts  (highlight.js, loaded lazily)
     │         └── Presentation  presentation.ts (one Preview per slide shown)
     ├─▶ markdown.ts   (smart Markdown editing)
     ├─▶ languages.ts  (code grammars, loaded lazily)
     └─▶ find.ts       (find / replace bar)

                  all of them call the backend only through api.ts
```

### DOM

The page is a fixed skeleton from `ui/index.html`; components render into it:

```
┌─ #titlebar (hover-revealed; tabs, doc title, stats, buttons) ─────────────────┐
├──────────────┬─┬──────────────────────────────────┬─┬─────────────────────────┤
│ #sidebar     │ │ #editor-pane                     │ │ #preview-pane           │
│   #tree      │d│   #banner (file changed on disk) │d│   #preview              │
│              │i│   #editor (CodeMirror)           │i│   (.markdown-body)      │
│  FileTree    │v│                                  │v│                         │
│              │ │   Editor                         │ │   Preview               │
├──────────────┴─┴──────────────────────────────────┴─┴─────────────────────────┤
│ #presentation (presentation mode, over everything but the title bar)          │
│ #edge-handle · #toast · #print (PDF export only)                              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Tabs and documents

Each tab keeps its path, the text last read from / written to disk and a CodeMirror state
snapshot. Only the active tab has a live `EditorView`; switching tabs swaps states into the
single editor. A document is dirty when its text differs from the saved snapshot.

Documents over ~10MB (`LARGE_DOC`) switch to **large file mode**: no preview, highlighting,
smart Markdown editing or word count, and crash recovery backups wait for a pause in typing.

### Startup

```
  init()
    ├─ getConfig · getWorkspace · configFile       apply theme, editor settings, modes
    ├─ listen(menu, fs://changed, theme://changed, notice,
    │         file://dropped, open://requested, update://installed)
    ├─ onCloseRequested → confirm unsaved changes → clear recovery backup
    ├─ takeOpened()                                Finder / CLI folder → workspace
    ├─ tree.setRoot(workspace)
    ├─ loadRecovery()  ── backups? ──▶ offer restore (confirm_restore)
    │        └─ none / declined ──▶ openSession() (open files from config.session)
    │                               then the file from Finder / CLI, if any
    └─ takeNotice()                                one-time toast
```

## Key flows

### Editing and saving

```
  keystroke
     │
     ▼
  CodeMirror transaction ──▶ Editor onChange callback (main.ts)
                                   │
        ┌──────────────┬───────────┼──────────────────┬───────────────────┐
        ▼              ▼           ▼                  ▼                   ▼
   update title   preview.update  scheduleStats   scheduleAutosave    scheduleBackup
   "— edited"     (150ms debounce) (word count)   (1s, if enabled)    (1s; large: on pause)
                       │                               │                   │
                       ▼                               ▼                   ▼
               render_markdown                    write_file         write_recovery
               (Rust, sanitized HTML)             (atomic rename)    (~/.kayet/recovery/)
                                                       │
                                                       ▼
                                          saved → syncBackup() removes the backup
                                          once no tab has unsaved changes
```

`fs_ops::write_atomic` writes to a hidden temp file next to the target and renames it into
place, so the file on disk is never half-written; permissions of an existing file are kept.

### Markdown preview

```
  editor text ──(150ms debounce)──▶ invoke("render_markdown", { text, base })
                                              │
                                              ▼
                              pulldown-cmark (GFM tables, tasks, footnotes …)
                              + <span data-line="N"> anchor per top-level block
                              + relative links / images → absolute paths
                                              │
                                              ▼
                                      ammonia sanitizer
                              + relative raw HTML <img src> → absolute paths
                                              │
                                              ▼
                        preview.ts: innerHTML, image src → asset:// URLs,
                        web images → invoke("cache_image") → local copy,
                        lazy highlight.js for code blocks, measure anchors
                        for editor ↔ preview scroll sync
```

A sequence number drops results of renders overtaken by newer ones.

The preview is offered for `.md` / `.markdown` files and for untitled documents written in
Markdown: while an untitled tab isn't known to be Markdown yet, `onChange` schedules a check
(300ms) of its text with `looksLikeMarkdown` (`markdown.ts`); a match sets the tab's `markdown`
flag, which shows the preview icon while the tab has no path (`loadDoc` resets it).

Web images are downloaded by `image_cache.rs` through the system's `curl` (http / https only,
20MB max, 30s timeout) into `~/.kayet/cache/images/<FNV-1a hash of the URL>.<ext>`, the
extension taken from the content type (or the URL); anything that isn't an image is discarded.
`images.ts` remembers each URL's download for the session, so re-renders while typing reuse it
without a round trip, and forgets failures after a minute so they are retried.

### Export

```
  File → Export as HTML… / PDF…
     │
     ▼
  invoke("render_export")  (no line anchors, relative links kept as written)
     │
     ├─ web images → their downloaded copies (cache_image), as local images
     │
     ├─ HTML: images inlined as data: URIs (read_image) + markdown-body.css
     │        → one self-contained .html → write_file
     │
     └─ PDF:  document placed into #print (print stylesheet hides everything else)
              → invoke("export_pdf") → NSPrintOperation on the WKWebView → .pdf
```

### Crash recovery

While any tab has unsaved changes, the frontend keeps `~/.kayet/recovery/buffer.json` up to date
with all dirty buffers. It is removed when everything is saved or discarded and on a clean close.
A backup present at launch therefore means kayet did not exit cleanly, and it is offered for
restoring before the session is opened.

### Opening from the terminal / Finder

```
  $ kayet notes.md              Finder: Open With → kayet
        │                                 │
        ▼                                 │
  core/cli/kayet (sh):                    │
  absolute paths, touch missing files     │
  open -b com.github.pwittchen.kayet …    │
        │                                 │
        └──────────────┬──────────────────┘
                       ▼
          RunEvent::Opened { urls }  (main.rs)
                       │
                       ▼
          AppState::open_paths: allow paths, first file + last folder
                       │
          frontend ready? ── no ──▶ OpenQueue ──▶ take_opened() in init()
                       │
                      yes
                       ▼
          emit("open://requested") ──▶ openRequested() in main.ts
```

### App updates

```
  update::start_background_checks (release builds only; 10s after launch, then every 24h)
  or "Check for Updates…"
     │
     ▼
  curl api.github.com/…/releases/latest ── newer than running version? ── no ──▶ done
     │ yes
     ▼
  native dialog: Install / Skip This Version / Later
     │ Install
     ▼
  curl .dmg → hdiutil attach → codesign: same Developer ID team?
     → ditto into place, swap the app bundle
     │
     ▼
  emit("update://installed") → frontend asks about unsaved changes → restart_app
```

No HTTP client is compiled in; network and disk work goes through the system's `curl`,
`hdiutil`, `codesign` and `ditto`.

## Persistent data

```
~/.kayet/
├── config.toml          [workspace] [ui] [editor] [window] [updates] [session]
│                        — settings, window geometry, open / recent files, skipped version;
│                          edited as a normal document from Settings (⌘,), reloaded on save
├── workspace/           default workspace (used when none is configured or it is gone)
├── cache/
│   └── images/          web images shown in the preview / exports, downloaded once
└── recovery/
    └── buffer.json      unsaved buffers, present only while there are unsaved changes
                         (or after a crash)
```

## Performance

Performance targets come from SPEC §13 and are checked by `scripts/bench.mjs` against a release
build. The design choices that serve them:

- one binary with the frontend embedded, no framework, minimal dependencies;
- heavy frontend code loaded lazily (code grammars, highlight.js);
- Markdown rendered in Rust, debounced, with stale renders dropped;
- file text and backups sent over IPC as raw bytes rather than JSON strings;
- large file mode for documents over ~10MB.

```
  scripts/bench.mjs ── launches target/release/kayet with KAYET_BENCH=<dir>, throwaway HOME
          │
          ▼
  ui/bench.ts: measures first paint, opening / typing in a large file, preview render
          │
          ▼
  invoke("bench_report") ── Rust prints the report to stdout and quits ──▶ bench.mjs
                                                                           PASS / FAIL
```
