# CLAUDE.md

kayet is a minimalistic macOS text editor built with Rust + Tauri 2 and a CodeMirror 6 frontend.
`SPEC.md` is the source of truth for product behavior and design — read it before changing features.

## Layout

- `core/` — Rust backend (Tauri app crate; the only Cargo workspace member)
  - `commands.rs` Tauri commands, `fs_ops.rs` file I/O, `workspace.rs` file tree,
    `markdown.rs` Markdown rendering (pulldown-cmark), `recovery.rs` crash recovery backup, `menu.rs`, `chrome.rs`, `config.rs`,
    `cli.rs` installs the `kayet` shell command (launcher script in `core/cli/kayet`)
- `ui/` — TypeScript frontend (vanilla TS, no framework), built by Vite into `dist/`
  - `bench.ts` self-measurement for `scripts/bench.mjs` (only active with `KAYET_BENCH` set),
    `editor.ts` CodeMirror setup, `markdown.ts` smart Markdown editing (lists, bold / italic, pasting), `languages.ts` code highlighting by file extension, `preview.ts` Markdown preview, `tree.ts` file tree, `palette.ts` command palette (⌘K) and file finder (⌘P),
    `chrome.ts` auto-hiding window chrome, `api.ts` Tauri command bindings, `theme.css`

## Commands

```sh
npm ci                 # install frontend deps
npm run build          # type-check + build frontend into dist/ (required before cargo build)
cargo build --locked
cargo test --locked
npm test               # frontend tests (Vitest + happy-dom, ui/*.test.ts)
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings -W clippy::pedantic
npx tauri dev          # run the app in dev mode
npx tauri build --target aarch64-apple-darwin --bundles app
npx tauri build --no-bundle && npm run bench   # SPEC §13 performance checks (scripts/bench.mjs)
```

The Rust crate embeds `dist/` at compile time, so always build the frontend first.
Target platform is Apple Silicon macOS only.

## Conventions

- Keep dependencies minimal; favor small binary size and instant startup.
- Follow the design language in `SPEC.md` (quiet, native, no unnecessary UI).
- Before marking a task as done, run `cargo fmt --check` and the `cargo clippy` command above
  (CI enforces both). If they report any warnings, fix them (don't silence them with `allow`
  unless there is no reasonable fix) and re-run until clean.

## Git

- Commit messages must NOT contain `Co-Authored-By` trailers or any other attribution to AI tools.
- Never run `git push` (or push in any other way); pushing is always left to the user.
