#!/bin/sh
# Runs the checks CI enforces: Rust formatting and lints, then the Rust and frontend tests,
# and prints a summary table with each step's result and time. Every step runs even if an
# earlier one fails; the script exits non-zero if any did.
# The frontend is built first, since the Rust crate embeds dist/ at compile time.
# Usage: scripts/test.sh
set -u

cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
summary="$work/summary.tsv"
: >"$summary"

# Milliseconds since the epoch (macOS `date` has no sub-second format).
now_ms() {
  perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'
}

# The pass / fail counts in a step's output, for the Result column.
result_of() {
  kind=$1
  out=$2
  # Drop color codes, in case a tool colors its output anyway.
  clean=$(sed 's/\x1b\[[0-9;]*m//g' "$out")
  case $kind in
    cargo-test)
      printf '%s\n' "$clean" | awk '
        /^test result:/ {
          for (i = 1; i <= NF; i++) {
            if ($(i + 1) ~ /^passed/) passed += $i
            if ($(i + 1) ~ /^failed/) failed += $i
          }
          found = 1
        }
        END {
          if (!found) exit
          printf "%d passed", passed
          if (failed) printf ", %d failed", failed
        }'
      ;;
    vitest)
      printf '%s\n' "$clean" | awk '
        /^ *Tests  / {
          sub(/^ *Tests +/, "")
          sub(/ *\([0-9]+\)$/, "")
          gsub(/ \| /, ", ")
          print
          exit
        }'
      ;;
  esac
}

# step <name> <kind> <command…>: runs the command, showing its output, and records the result.
step() {
  name=$1
  kind=$2
  shift 2
  printf '\n==> %s\n' "$*"
  out="$work/out"
  start=$(now_ms)
  { "$@"; echo $? >"$work/status"; } 2>&1 | tee "$out"
  elapsed=$(($(now_ms) - start))
  if [ "$(cat "$work/status")" -eq 0 ]; then status=ok; else status=FAILED; fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$elapsed" "$(result_of "$kind" "$out")" >>"$summary"
}

total_start=$(now_ms)
step "Frontend build" - npm run build
step "Rust format" - cargo fmt --check
step "Rust lint (clippy)" - cargo clippy --locked --all-targets -- -D warnings -W clippy::pedantic
step "Rust tests" cargo-test cargo test --locked
step "Frontend tests" vitest npm test
total_ms=$(($(now_ms) - total_start))

printf '\n'
awk -F '\t' -v total="$total_ms" '
  function duration(ms) {
    if (ms < 60000) return sprintf("%.1fs", ms / 1000)
    return sprintf("%dm %02ds", int(ms / 60000), int(ms % 60000 / 1000))
  }
  function grow(col, text) { if (length(text) > w[col]) w[col] = length(text) }
  function line(   i, s) {
    s = "+"
    for (i = 1; i <= 4; i++) s = s sprintf("%s+", dashes(w[i] + 2))
    print s
  }
  function dashes(n,   s) { s = ""; while (n-- > 0) s = s "-"; return s }
  function row(a, b, c, d) {
    printf "| %-*s | %-*s | %*s | %-*s |\n", w[1], a, w[2], b, w[3], c, w[4], d
  }
  {
    n++
    name[n] = $1; status[n] = $2; time[n] = duration($3); result[n] = $4
    if ($2 != "ok") failed++
    # Adds up the "N passed" / "N failed" counts of the test steps.
    if (match($4, /[0-9]+ passed/)) tests_passed += substr($4, RSTART, RLENGTH) + 0
    if (match($4, /[0-9]+ failed/)) tests_failed += substr($4, RSTART, RLENGTH) + 0
  }
  END {
    split("Step Status Time Result", head, " ")
    for (i = 1; i <= 4; i++) w[i] = length(head[i])
    overall = failed ? sprintf("FAILED (%d)", failed) : "ok"
    tests = tests_passed + tests_failed ? sprintf("%d passed", tests_passed) : ""
    if (tests_failed) tests = tests sprintf(", %d failed", tests_failed)
    for (i = 1; i <= n; i++) { grow(1, name[i]); grow(2, status[i]); grow(3, time[i]); grow(4, result[i]) }
    grow(1, "Total"); grow(2, overall); grow(3, duration(total)); grow(4, tests)
    line(); row(head[1], head[2], head[3], head[4]); line()
    for (i = 1; i <= n; i++) row(name[i], status[i], time[i], result[i])
    line(); row("Total", overall, duration(total), tests); line()
  }' "$summary"

if grep -q "	FAILED	" "$summary"; then
  printf '\nSome checks failed.\n'
  exit 1
fi
printf '\nAll checks passed.\n'
