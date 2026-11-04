---
name: bench
description: Run kayet's SPEC §13 performance benchmarks (scripts/bench.mjs) and show the results as a table, optionally compared against a baseline commit to spot regressions. Use when the user asks to run benchmarks, check performance, or check whether something got slower.
argument-hint: "[baseline-commit] [--runs N]"
---

# kayet benchmarks

Runs `scripts/bench.mjs` (cold start, opening a 5MB file, typing in it, Markdown preview render)
against a fresh release build and summarizes the result in a table.

Arguments: `$ARGUMENTS`
- an optional git ref: the baseline to compare against. With no ref, run HEAD only, unless the
  user asks whether anything got worse. Then pick the last commit before the most recent change to app
  code (`core/`, `ui/`, `index.html`, `package*.json`) as the baseline, e.g. with
  `git log --format=%h -n 1 <last-code-commit>~1`, and name it in the summary
- `--runs N`: launches per benchmark (default 7)

## Steps

1. **Build HEAD.** The binary embeds `dist/`, so build the frontend first:
   ```sh
   npm run build && npx tauri build --no-bundle
   ```
   If the working tree has uncommitted changes, they are part of "HEAD": say so in the summary.

2. **Build the baseline** (only when comparing) in a detached worktree in the scratchpad,
   with its own target dir. Never create a branch, never touch the main checkout:
   ```sh
   WT=<scratchpad>/bench-base
   git worktree add --detach "$WT" <ref>
   (cd "$WT" && npm ci && npm run build && CARGO_TARGET_DIR="$WT/target" npx tauri build --no-bundle)
   ```

3. **Run the benchmarks.** Always use the bench script from the main checkout (`scripts/bench.mjs`)
   so both builds are measured the same way. Don't run builds or other heavy work at the same time.
   When comparing, interleave runs to even out thermal / background noise:
   ```sh
   for i in 1 2; do
     node scripts/bench.mjs --runs 7 --app "$WT/target/release/kayet"   # baseline
     node scripts/bench.mjs --runs 7                                    # HEAD
   done
   ```
   Without a baseline, run HEAD twice. Each run prints PASS/FAIL lines with a detail line below.
   The script exits non-zero when a target is missed. That is a result, not an error, so keep the
   output. If a run prints no results (e.g. timeout), rerun that one and mention it.

4. **Clean up:** `git worktree remove --force "$WT"`, then check `git worktree list` and
   `git status --short` to confirm the repo is as it was.

## Summary

Reply in the user's language with a table: one row per metric, one column per build
(all run values, e.g. `385 / 368 ms`), and the target with ✅/❌:

| Metric | Baseline (`<ref>`) | HEAD | Target |
|---|---|---|---|
| Cold start → first paint (median) | | | < 350 ms |
| Open 5MB file: longest frame | | | < 100 ms |
| Type in 5MB file: longest frame | | | < 100 ms |
| Preview render 48KB (median) | | | < 16 ms |

Then the verdict: is there a regression (a consistent difference larger than the
run-to-run spread) or is the change within noise? Mark failed targets as either
**new** (baseline passes) or **pre-existing**. Also mention notable details from the detail lines,
e.g. a preview p95 above 16 ms or a slow first launch. Note that SPEC §13 says cold start
< 300 ms while the script checks < 350 ms.
