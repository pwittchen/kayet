---
name: security-deps-fix
description: Fix security vulnerabilities and warnings (unmaintained / unsound / yanked crates) reported by npm audit and cargo audit, the same checks the CI audit job runs. Use when the user asks to fix audit findings, vulnerable dependencies, RUSTSEC / GHSA advisories, or a failing CI audit job.
argument-hint: "[npm|cargo] [advisory-id...]"
---

# Fix npm and Cargo audit findings

Makes `npm audit` and `cargo audit --deny warnings` pass, the same commands as the `audit` job
in `.github/workflows/rust.yml` (which gates the CI build). Fix by upgrading dependencies first.
Ignore an advisory only when no fix is reachable and it doesn't affect the shipped macOS app.

Arguments: `$ARGUMENTS`
- `npm` or `cargo`: limit the work to that ecosystem (default: both)
- advisory IDs (`RUSTSEC-…`, `GHSA-…`): fix only these

## Steps

1. **Audit.** Run both and keep the full output:
   ```sh
   npm audit
   cargo audit --deny warnings
   ```
   If `cargo audit` is missing, install it with `cargo install cargo-audit --locked`.
   If both pass, say so and stop. Otherwise list each finding: advisory ID, crate / package,
   installed version, patched versions, severity or kind (vulnerability, unmaintained, unsound,
   yanked), and the dependency path (`cargo tree -i <crate> --target all`, `npm ls <pkg>`).

2. **Fix npm findings**, from least to most invasive:
   - `npm audit fix` (never `--force` without asking: it can make semver-major jumps).
   - Transitive package still vulnerable: bump the direct dependency that pulls it in to a
     version that requires a patched release (`npm install <direct>@<version>`).
   - No such version yet: add an `overrides` entry in `package.json` pinning the patched
     version, as long as it stays semver-compatible with what the parent expects.
   - Dev-only tooling (Vite, Vitest, …) is still worth fixing, since it gates CI, but it doesn't
     ship in the app: say so in the summary.
   Keep `package-lock.json` in sync (`npm install`), and make sure `npm ci` works.

3. **Fix Cargo findings**, from least to most invasive:
   - Semver-compatible bump of the affected crate: `cargo update -p <crate> --precise <version>`
     (or just `cargo update -p <crate>`).
   - The crate is pinned by a parent: `cargo update` the parent, or raise its version in
     `core/Cargo.toml` if a newer compatible release drops or fixes the crate.
   - Semver-major bumps of direct dependencies (e.g. Tauri): ask the user before doing them.
   - Check whether the crate is compiled at all for macOS:
     `cargo tree -i <crate> --target aarch64-apple-darwin` and `--target x86_64-apple-darwin`.
     An empty tree means it only sits in `Cargo.lock` (an unused optional dependency, or a
     Linux-only dependency of Tauri).
   - **Ignore only as the last resort**: no patched version is reachable without a major
     upgrade the user didn't approve, *and* the crate isn't compiled into the macOS app (or the
     affected API is provably unused). Add the ID to `.cargo/audit.toml` under
     `[advisories] ignore` with a comment naming the crate, the reason and the path it comes
     through, following the existing entries. Never ignore a vulnerability that ships in the app.
   - Remove ignore entries in `.cargo/audit.toml` that no longer match anything (cargo audit
     reports nothing for them once the crate is gone): run the audit without the entry to check.

4. **Verify.** Re-run both audits until they pass, then the regular checks, since upgrades can
   break the build:
   ```sh
   npm run build
   cargo build --locked
   scripts/test.sh
   ```
   Fix any breakage the upgrades caused. Code changes for API changes are fine, but keep them
   minimal. If a fix can't be made to work, revert that upgrade and report the advisory as open.

5. **Report.** A short table: advisory, package, old → new version (or "ignored" + reason, or
   "open" + why), and whether it ships in the app. Mention the changed files (`Cargo.lock`,
   `core/Cargo.toml`, `package.json`, `package-lock.json`, `.cargo/audit.toml`). Don't commit
   unless the user asks. A good commit message lists each advisory ID with its fix, like
   `5f3f78f` ("Fix cargo audit vulnerabilities and warning").
