# Issue 8 — Show changelog in the app, especially after an update

Source: [issue #8](https://github.com/pwittchen/kayet/issues/8) (OPEN, no labels
or comments). The issue states no explicit acceptance criteria; the criteria
below are derived as the smallest reading that satisfies it, consistent with
SPEC.md (quiet, native, no extra UI, system `curl` only — no HTTP client).

> Currently the changelog is only available on the website and in GitHub
> Releases. There is no way to see it from inside the app. It would be good to
> view the changelog directly in kayet — especially after an update, so it's
> clear what changed in the new version. Since kayet is primarily a Markdown
> viewer, showing the changelog as Markdown would be a natural fit, but
> that's an idea, not a strict requirement.

## Goal

Give the user a changelog without leaving kayet: the GitHub Release notes,
rendered as Markdown through the existing pipeline, viewable on demand at
any time and surfaced once automatically after an update to a new version.

## User-visible behavior

- `kayet → What's New…` shows the changelog: one section per release,
  newest first, each headed by its version (e.g. `## 0.8.0`) followed by that
  release's notes rendered as Markdown. The same command is in the `⌘K`
  command palette (SPEC.md §5.4 lists every command), as `What's New…`.
- The view is an in-app pane/overlay in the current window (one window only,
  SPEC.md §2). It reuses the preview typography (`markdown-body.css`), closes
  on `Esc`, and links open in the default browser like preview links; it never
  opens or replaces a document, a tab, or the file tree.
- **After an update:** on the first launch where the running version differs
  from the last version kayet has shown the changelog for, the changelog
  opens once, scrolled to (or filtered to) the new version's section. It
  never opens on later launches of the same version. Updating the seen
  version happens whether or not the fetch succeeds, so a failed fetch never
  nags on the next launch — the user can still open `What's New…` manually.
- **First run / fresh install:** nothing opens. The seen version is seeded
  to the running version, so only a real later upgrade triggers the
  automatic show.
- While loading, the view shows a quiet loading state. On failure (offline,
  no `curl`, GitHub unreachable, empty response) it shows a short
  non-blocking notice in the view with an action to open the releases page
  (`https://github.com/pwittchen/kayet/releases`) in the browser. No modal
  dialog, no retry loop.
- No new settings, toggles, or config file edits are exposed to the user;
  the only persisted trace is the seen-version marker (see below).

## Functional requirements

Each requirement maps to a derived acceptance criterion from the issue.

| # | Derived criterion | Requirement |
|---|---|---|
| R1 | Changelog openable from inside the app on demand | `kayet → What's New…` menu item + `What's New…` palette command both open the changelog view. |
| R2 | Changelog surfaced once after an update | At startup, if `session.last_seen_version` is set and differs from the running version, open the changelog once for the new version, then persist `last_seen_version` = running version. If unset (first run), seed it without opening. |
| R3 | Content is the release notes, as Markdown | Fetch GitHub Releases via the existing `curl` path only; render each release `body` with `render_markdown` (`pulldown-cmark` → `ammonia`), never as raw HTML. |
| R4 | Graceful offline/error behavior, no new HTTP client | Any fetch/parse failure leaves the app fully usable, shows the in-view notice + release-page link, and still marks the version seen (R2). No bundled HTTP client is added. |

Supporting requirements:

- **R5 — History, newest first.** The on-demand view lists published
  releases (non-draft; prereleases excluded, matching §4.5's "latest
  non-draft, non-prerelease" rule), newest first, at most 20
  (`per_page=20`). A release with an empty/missing `body` shows its version
  heading and a link to its release page instead of a blank section.
- **R6 — No document impact.** Opening/closing the changelog never prompts
  to save, never changes the active document, tab, selection, scroll, or
  preview/presentation state, and works with no document open.
- **R7 — Seen-marker durability.** `session.last_seen_version` survives
  `set_config` / `reload_config` (both preservations in `commands.rs`) and
  older `config.toml` files without the key load unchanged (serde default).
- **R8 — Debug/dev builds.** The automatic post-update show follows the
  same version-comparison rule in all builds; only the *background update
  check* stays disabled in development builds (§4.5, `update.rs`). Manual
  `What's New…` always fetches on demand.

## Edge / error cases

- **Up to date / downgrade:** running version equal to or older than
  `last_seen_version` → no automatic show; the marker is only ever moved
  forward to the running version when it differs after an upgrade. A
  downgrade updates the marker to the running version without showing
  (otherwise the next upgrade would re-show stale notes).
- **Skipped version (`skipped_version`):** independent. Skipping an update
  offer does not mark anything seen; if that version is later installed,
  R2 shows its notes once.
- **Update installed but restart declined:** §4.5 already defers the new
  version to the next launch; R2 fires on that next launch (the first one
  actually running the new version), not at install time.
- **Multiple missed versions:** if the user upgrades across several
  releases, the automatic show opens the changelog at the newest installed
  version's section; older sections remain scrollable below/above per the
  newest-first order. No per-version popups.
- **Offline / rate-limited / malformed JSON:** in-view notice + release-page
  link (R4); the raw error never reaches a modal. Unauthenticated GitHub
  API limits apply as they do to §4.5 checks today.
- **Empty changelog:** zero published releases or all bodies empty → the
  view shows the version headings with release-page links (R5), or the
  notice if even the list is empty.
- **Long notes:** the view scrolls; rendering reuses the preview's
  sanitized pipeline, so scripts/unsafe HTML in a release body are stripped
  exactly as in the preview. Stale-response races follow the preview's
  sequence-guard pattern (a slower earlier fetch never overwrites a newer
  view state).
- **Reopening while open:** `What's New…` while the view is already open
  refocuses/refreshes it; it never stacks a second view.
- **Unsaved changes:** unaffected — the changelog is not a document (R6).

## Non-goals

- No `CHANGELOG.md` in the repo and no website changes; GitHub Releases
  remain the single source of truth.
- No native-dialog changelog, no separate window, no badge/dot on menus or
  the title bar, no "check on every launch" beyond the existing §4.5
  update check.
- No settings UI or config key for disabling the post-update show (the
  once-only marker is the whole mechanism); no telemetry.
- No change to the update offer/install flow itself (§4.5 dialogs,
  `Skip This Version`, signature verification, restart behavior).
- No Intel/universal builds, no new dependencies (Rust or npm); Apple
  Silicon macOS only, as everywhere.

## Affected modules / files

Backend (`core/src/`):

- `update.rs` — add `body: Option<String>` to `GitHubRelease` (+ parse it
  in `parse_release`); add a `releases()` fetch of
  `https://api.github.com/repos/pwittchen/kayet/releases?per_page=20` via
  the same `/usr/bin/curl` helper as `latest_release()`, filtering drafts
  and prereleases, newest first. The single-latest path (§4.5) is unchanged
  except for carrying `body` through `Release` if convenient.
- `config.rs` — `SessionConfig.last_seen_version: Option<String>`
  (`#[serde(default)]`), alongside `skipped_version`.
- `commands.rs` — new `get_changelog() -> Vec<ChangelogEntry>` command
  (`spawn_blocking`, mirroring `check_for_updates`) returning
  `{ version, body, page, published_at }` entries, and
  `mark_changelog_seen(version)` persisting the marker; preserve the field
  in `set_config` (`reload_config` keeps the whole session as it is).
- `main.rs` — register both commands in the invoke handler.
- `menu.rs` — `What's New…` item in the app menu next to
  `Check for Updates…`, forwarded as the `menu` event id `changelog`
  (About stays Rust-handled; this one is frontend-handled like the rest).

Frontend (`ui/`):

- `changelog.ts` (new) — the changelog view: fetch via `api`, render each
  body through the existing `render_markdown` command, apply
  `markdown-body` typography, handle loading/error/empty states, external
  links → browser, `Esc` to close.
- `index.html` — one `#changelog` container, sibling to `#preview-pane` /
  `#presentation`.
- `api.ts` — `getChangelog()` / `markChangelogSeen(version)` bindings;
  `SessionConfig.last_seen_version` in the config type.
- `main.ts` — `run("changelog")` dispatch + `What's New…` palette item;
  startup check implementing R2 (compare `last_seen_version` with the
  running version from `@tauri-apps/api/app`, mark seen first, then open
  once when upgraded). It runs at startup only, so the first launch actually
  running the new version — including after an `update://installed` restart —
  is the one that shows it.

Docs (with the change, per CLAUDE.md):

- `SPEC.md` — new §4.7 (below), two rows in the §11 command table
  (`get_changelog`, `mark_changelog_seen`), and `last_seen_version` named
  in the §10 session description.
- `ARCH.md` — changelog fetch/show flow alongside the update flow.
- No `CHANGELOG.md`, no `website/` change.

## Data / IPC changes

- **New Tauri commands:** `get_changelog() -> Vec<ChangelogEntry>` and
  `mark_changelog_seen(version: String)`. `ChangelogEntry` is
  `{ version: String, body: String, page: String, published_at: String }`
  (serde, snake_case on the wire; the TypeScript type keeps `published_at`). Errors are returned as
  the existing `String` error shape; the frontend turns them into the
  in-view notice (R4).
- **Config:** one additive optional key, `[session] last_seen_version`.
  Absent = first run (seed silently). No migration; older/newer kayet
  versions ignore it safely.
- **Network:** one additional unauthenticated `curl` GET to the GitHub
  Releases list endpoint, only on `What's New…` or on the once-per-upgrade
  startup show. Optional follow-up (not required): cache the last fetched
  list under `~/.kayet/cache/` like `image_cache.rs` so a repeat open
  works offline; if cached data is shown, it is still per R4.
- **Events:** none new; the existing `menu` event carries `changelog`, and
  `update://installed` is reused as-is.

## Verification

Automated (all existing gates stay green):

- Rust unit tests, extending `update.rs` `#[cfg(test)]`: `parse_release`
  carries `body` (present, missing, null); the list parser keeps order,
  drops drafts/prereleases, caps at the fetched page, and tolerates
  malformed entries. `config.rs`: `last_seen_version` round-trips and an
  old config without the key parses to `None`.
- Frontend Vitest (`ui/changelog.test.ts` or via extracted pure helpers —
  `main.ts` has no harness, so keep the once-only decision in a testable
  pure function): show iff marker set ∧ marker ≠ current; seed on first
  run without showing; mark seen after show and after failed fetch;
  downgrade re-seeds silently; empty-body entry renders its release link.
- Gates: `npm run build` before `cargo test --locked`, plus `npm test`,
  `cargo fmt --check`, and
  `cargo clippy --locked --all-targets -- -D warnings -W clippy::pedantic`.

Manual / interactive (dev build, `npx tauri dev`):

1. `kayet → What's New…` and `⌘K` → `What's New…` both open the view with
   real release notes rendered as Markdown; links open in the browser;
   `Esc` closes; the open document/tab is untouched throughout.
2. Simulate an upgrade (set `last_seen_version` to an older version in
   `~/.kayet/config.toml`, relaunch): the changelog opens once at the new
   version; relaunching again does not reopen it.
3. Fresh config (no marker): first launch shows nothing; the marker is
   seeded to the running version.
4. Offline (network off): `What's New…` shows the notice + working
   release-page link; the simulated-upgrade launch still marks seen and
   does not re-nag on the next launch.
5. SPEC §13 sanity: opening the changelog adds no measurable startup cost
   when no upgrade occurred (no fetch on ordinary launches).

## Decisions & assumptions (flagged)

- **[Decision] Both triggers, one view.** The issue asks for on-demand
  viewing *and* stresses "especially after an update"; doing only one
  would half-satisfy it. Rejected: on-demand only (misses the emphasized
  case), auto-show only (undiscoverable).
- **[Decision] In-app Markdown view, not a native dialog.** The issue
  calls Markdown "an idea, not a strict requirement", but kayet already
  has a sanitized Markdown pipeline and native dialogs cannot render it;
  the dialog route would also cap notes at plain text. This is the
  smallest reuse, not gold-plating.
- **[Decision] Full recent history (≤20), not latest only.** "View the
  changelog" reads as the changelog, not one version's notes; the list
  endpoint costs one request either way. If the maintainer wants
  latest-only, R5 collapses to the existing `/releases/latest` + `body`
  with no other change. *Ambiguous in the issue — flagged.*
- **[Decision] `What's New…` naming**, mirroring `Check for Updates…` in
  the same menu. "Changelog…" is an equally valid label; one word to
  change in `menu.rs` + `main.ts` if preferred. *Cosmetic — flagged.*
- **[Assumption] Release bodies stay Markdown** as they are today
  (verified for v0.7.1 in the research packet); rendering goes through
  `render_markdown` regardless, so plain-text bodies still display fine.
- **[Assumption] No draft/prerelease notes are shown**, consistent with
  §4.5; a user on a prerelease build sees the latest stable notes plus
  their own version heading only if published.
