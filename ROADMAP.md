# kayet — Roadmap

Ideas for what comes after v1. `SPEC.md` remains the source of truth for product behavior;
items here move into the spec once they are picked up.

## Distribution

- [ ] **Code signing & notarization** — tag-triggered release workflow: sign with a Developer ID,
      notarize via `notarytool`, publish a `.dmg` to GitHub Releases. Unsigned builds are
      blocked by Gatekeeper on other Macs.
- [ ] Release the project website and connect download buttons with released, signed, notarized app
- [x] **`kayet` CLI + file associations** — open files from the terminal (`kayet notes.md`) and
      register `.md` / `.txt` so Finder "Open With" and double-click work.

## Robustness

- [x] **Lint gates in CI** — add `cargo fmt --check` and
      `cargo clippy --all-targets -- -D warnings` to `rust.yml`.
- [x] **Crash recovery** — keep a backup of dirty and untitled buffers in `~/.kayet/recovery/`
      and offer to restore them on next launch.
- [x] **Performance checks** — a small benchmark script for the targets in SPEC §13
      (cold start < 300ms, opening a 5MB file without freezing, preview render < 16ms):
      `npm run bench`.
- [x] **Frontend tests** — cover hover-reveal / fade timing in `chrome.ts` and keyboard
      navigation in `tree.ts`: `npm test`.

## Features

- [ ] **Smart Markdown editing** (no new UI):
  - Enter continues lists and task-list checkboxes.
  - `⌘B` / `⌘I` for bold / italic.
  - Pasting a URL over selected text creates a link.
  - Pasting an image saves it next to the file and inserts `![](…)`.
- [ ] **Fuzzy file finder** (`⌘P`).
- [ ] **Workspace-wide search.**
- [x] **Command palette** (`⌘K`), Linear-style.
- [ ] **Word count / reading time** in the hover title bar.
- [ ] **Open Recent** menu.
- [ ] **Spell check** for prose files (built into the web view; just needs enabling).
- [ ] **Export** Markdown to HTML / PDF.
- [ ] **Tabs / multiple windows.**
