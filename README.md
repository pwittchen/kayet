<div align="center">

<img src="core/icons/icon-source.png" alt="kayet logo" width="160" height="160">

# kayet

the minimalistic text editor for macOS

[![Rust](https://github.com/pwittchen/kayet/actions/workflows/rust.yml/badge.svg)](https://github.com/pwittchen/kayet/actions/workflows/rust.yml)

</div>

<p align="center">
  <img src="screenshot.png" alt="kayet screenshot">
</p>

See [SPEC.md](SPEC.md) for the full specification and [ROADMAP.md](ROADMAP.md) for planned work.

## Development

Requirements: Rust (edition 2024), Node.js 22+, macOS on Apple Silicon.

```sh
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # build kayet.app / .dmg
cargo test             # backend tests
```

### Running in dev mode

```sh
npm install            # once, or after dependencies change
npm run tauri dev
```

This starts the Vite dev server on `http://localhost:1420` (port must be free), compiles the
Rust backend in debug mode and opens the kayet window pointing at the dev server.

- Changes in `ui/` (TypeScript, CSS) are hot-reloaded in the open window.
- Changes in `core/` (Rust, `tauri.conf.json`, capabilities) trigger a rebuild and an
  automatic restart of the app.
- Web inspector: right-click inside the editor → **Inspect Element**, or press `⌥⌘I`
  (debug builds only).
- Stop with `Ctrl+C` in the terminal.

Dev mode uses your real `~/.kayet` config and workspace. To experiment with a clean first
launch without touching them, point `HOME` somewhere else (keeping the Rust toolchain paths):

```sh
CARGO_HOME=~/.cargo RUSTUP_HOME=~/.rustup HOME=$(mktemp -d) npm run tauri dev
```

Layout: `core/` is the Rust backend (Tauri commands, config, workspace watcher,
Markdown rendering), `ui/` is the TypeScript frontend (CodeMirror 6 editor, file tree,
preview, hover chrome).

Configuration lives in `~/.kayet/config.toml`; the default workspace is `~/.kayet/workspace/`.
