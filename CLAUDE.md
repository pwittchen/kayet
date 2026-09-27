# CLAUDE.md

kayet is a minimalistic macOS text editor built with Rust + Tauri 2 and a CodeMirror 6 frontend.
`SPEC.md` is the source of truth for product behavior and design — read it before changing features.

## Layout

- `core/` — Rust backend (Tauri app crate; the only Cargo workspace member)
  - `commands.rs` Tauri commands, `fs_ops.rs` file I/O, `workspace.rs` file tree,
    `markdown.rs` Markdown rendering (pulldown-cmark), `menu.rs`, `chrome.rs`, `config.rs`,
    `cli.rs` installs the `kayet` shell command (launcher script in `core/cli/kayet`)
- `ui/` — TypeScript frontend (vanilla TS, no framework), built by Vite into `dist/`
  - `editor.ts` CodeMirror setup, `languages.ts` code highlighting by file extension, `preview.ts` Markdown preview, `tree.ts` file tree,
    `chrome.ts` auto-hiding window chrome, `api.ts` Tauri command bindings, `theme.css`

## Commands

```sh
npm ci                 # install frontend deps
npm run build          # type-check + build frontend into dist/ (required before cargo build)
cargo build --locked
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings -W clippy::pedantic
npx tauri dev          # run the app in dev mode
npx tauri build --target aarch64-apple-darwin --bundles app
```

The Rust crate embeds `dist/` at compile time, so always build the frontend first.
Target platform is Apple Silicon macOS only.

## Conventions

- Keep dependencies minimal; favor small binary size and instant startup.
- Follow the design language in `SPEC.md` (quiet, native, no unnecessary UI).

## Git

- Commit messages must NOT contain `Co-Authored-By` trailers or any other attribution to AI tools.
