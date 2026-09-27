// Performance checks for the targets in SPEC §13.
//
// Launches the release binary several times with KAYET_BENCH set; the app then measures
// itself (ui/bench.ts) and prints one JSON report line before quitting:
//   - cold start: process spawn → first paint of the UI              (< 350ms)
//   - opening a 5MB text file: the longest frame while it loads     (no UI freeze)
//   - typing in it (title bar shown): the longest frame, including the work each edit
//     schedules (word count, crash recovery backup)                (no UI freeze)
//   - preview render of a typical ~50KB Markdown document            (< 16ms)
//
// Each launch uses a throwaway HOME, so ~/.kayet (config, session, recovery) is untouched.
//
// Usage: node scripts/bench.mjs [--runs N] [--large MB] [--app path/to/kayet] [--build]
//   --large  size of the large file in MB (default 5, the SPEC §13 target)
//   --build  runs `npx tauri build --no-bundle` first (the binary embeds dist/)
// Exits non-zero if a target is missed.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));

const TARGETS = {
  coldStartMs: 350,
  // No UI freeze: nothing may block the UI longer than a user perceives as instant.
  freezeMs: 100,
  previewMs: 16,
};
const TYPICAL_BYTES = 48 * 1024;
const RUN_TIMEOUT_MS = 60_000;

const { values: opts } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    large: { type: "string", default: "5" },
    app: { type: "string", default: join(root, "target/release/kayet") },
    build: { type: "boolean", default: false },
  },
});
const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 1);
const largeMb = Math.max(1, Number.parseFloat(opts.large) || 5);
const LARGE_BYTES = largeMb * 1024 * 1024;

if (opts.build) {
  execFileSync("npx", ["tauri", "build", "--no-bundle"], { cwd: root, stdio: "inherit" });
}
if (!existsSync(opts.app)) {
  console.error(`kayet binary not found at ${opts.app}`);
  console.error("build it with `npx tauri build --no-bundle` or pass --build / --app <path>");
  process.exit(2);
}

// ---- fixtures ----

const WORDS = (
  "the quick brown fox jumps over lazy dog while kayet keeps writing quiet native " +
  "minimal editor text file markdown preview workspace render frame paint start"
).split(" ");

function sentence(i) {
  const n = 8 + (i % 9);
  const words = Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 13) % WORDS.length]);
  return words.join(" ").replace(/^./, (c) => c.toUpperCase()) + ".";
}

function largeText() {
  const lines = [];
  let size = 0;
  for (let i = 0; size < LARGE_BYTES; i++) {
    const line = i % 12 === 11 ? "" : `${sentence(i)} ${sentence(i + 1)}`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}

function typicalMarkdown() {
  const sections = [];
  let size = 0;
  for (let i = 0; size < TYPICAL_BYTES; i++) {
    const s = [
      `## Section ${i + 1}: ${sentence(i).slice(0, -1)}`,
      `${sentence(i)} Some **bold**, some *emphasis*, \`inline code\` and a [link](https://example.com/${i}). ${sentence(i + 1)} ${sentence(i + 2)}`,
      `${sentence(i + 3)} ${sentence(i + 4)} See [the notes](notes-${i}.md) for details.`,
      [`- ${sentence(i + 5)}`, `- ${sentence(i + 6)}`, `  - ${sentence(i + 7)}`, `- [x] done`, `- [ ] todo`].join("\n"),
      `> ${sentence(i + 8)} ${sentence(i + 9)}`,
      i % 2 === 0
        ? "```ts\nexport function add(a: number, b: number): number {\n  // sum two numbers\n  return a + b;\n}\n```"
        : "```rust\nfn main() {\n    let v: Vec<u32> = (1..=10).collect();\n    println!(\"{}\", v.iter().sum::<u32>());\n}\n```",
      "| Name | Size | Notes |\n|:-----|-----:|-------|\n" +
        [0, 1, 2].map((k) => `| item ${k} | ${(i + 1) * (k + 3)} | ${sentence(i + k).slice(0, 30)} |`).join("\n"),
      `1. ${sentence(i + 10)}\n2. ${sentence(i + 11)}\n3. ${sentence(i + 12)}`,
    ].join("\n\n");
    sections.push(s);
    size += s.length + 2;
  }
  return `# Typical document\n\n${sections.join("\n\n")}\n`;
}

const base = mkdtempSync(join(tmpdir(), "kayet-bench-"));
const home = join(base, "home");
const workspace = join(base, "workspace");
mkdirSync(workspace, { recursive: true });
const large = largeText();
writeFileSync(join(workspace, "large.txt"), large);
writeFileSync(join(workspace, "typical.md"), typicalMarkdown());

/** Fresh ~/.kayet for every launch so each one starts the same way. */
function resetHome() {
  rmSync(join(home, ".kayet"), { recursive: true, force: true });
  mkdirSync(join(home, ".kayet"), { recursive: true });
  writeFileSync(
    join(home, ".kayet", "config.toml"),
    `[workspace]\npath = ${JSON.stringify(workspace)}\n`,
  );
}

// ---- runs ----

function launch() {
  resetHome();
  return new Promise((resolve, reject) => {
    const spawned = Date.now();
    const child = spawn(opts.app, [], {
      env: { ...process.env, HOME: home, KAYET_BENCH: workspace },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    let report = null;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no report within ${RUN_TIMEOUT_MS / 1000}s`));
    }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const line = out.split("\n").find((l) => l.startsWith("kayet-bench "));
      if (line && !report) report = JSON.parse(line.slice("kayet-bench ".length));
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!report) return reject(new Error(`kayet exited (${code}) without a report`));
      if (report.error) return reject(new Error(`benchmark failed in the app: ${report.error}`));
      if (report.largeFile.chars !== large.length) {
        return reject(new Error(`large.txt did not open (${report.largeFile.chars} of ${large.length} chars)`));
      }
      resolve({ ...report, spawned });
    });
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const ms = (x) => `${x.toFixed(1)}ms`;

const results = [];
try {
  for (let i = 0; i < runs; i++) {
    if (process.stdout.isTTY) process.stdout.write(`\rrun ${i + 1}/${runs}…`);
    results.push(await launch());
  }
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
} catch (e) {
  console.error(`${process.stdout.isTTY ? "\n" : ""}${e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(base, { recursive: true, force: true });
}
if (results.length === 0) process.exit(1);

const coldStart = results.map((r) => r.firstPaint - r.spawned);
const webviewStart = results.map((r) => r.timeOrigin - r.spawned);
const openMs = results.map((r) => r.largeFile.openMs);
const longestFrame = results.map((r) => r.largeFile.longestFrameMs);
const typingFrame = results.map((r) => r.typing.longestFrameMs);
const renders = results.flatMap((r) => r.preview.renderMs);
const markdown = results.flatMap((r) => r.preview.markdownMs);
const previewKb = results[0].preview.bytes / 1024;

const checks = [
  {
    name: "Cold start → first paint",
    value: median(coldStart),
    target: TARGETS.coldStartMs,
    detail: `median of ${results.length}; first ${ms(coldStart[0])}, max ${ms(Math.max(...coldStart))}; webview up after ${ms(median(webviewStart))}`,
  },
  {
    name: `Open ${largeMb}MB file: longest frame`,
    value: Math.max(...longestFrame),
    target: TARGETS.freezeMs,
    detail: `worst of ${results.length}; open → painted median ${ms(median(openMs))}`,
  },
  {
    name: `Type in ${largeMb}MB file: longest frame`,
    value: Math.max(...typingFrame),
    target: TARGETS.freezeMs,
    detail: `worst of ${results.length}; median ${ms(median(typingFrame))}`,
  },
  {
    name: `Preview render (${previewKb.toFixed(0)}KB)`,
    value: median(renders),
    target: TARGETS.previewMs,
    detail: `median of ${renders.length}; p95 ${ms(percentile(renders, 95))}; Markdown → HTML (incl. IPC) ${ms(median(markdown))}`,
  },
];

console.log(`kayet performance (${results.length} run${results.length > 1 ? "s" : ""}, ${opts.app})\n`);
for (const c of checks) {
  const ok = c.value < c.target;
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(30)} ${ms(c.value).padStart(9)}  (target < ${c.target}ms)`);
  console.log(`      ${c.detail}`);
}
