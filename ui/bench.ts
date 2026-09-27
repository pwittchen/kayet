// Self-measurement for the performance targets in SPEC §13, driven by scripts/bench.mjs.
// Loaded only when kayet runs with KAYET_BENCH set; reports the results and quits.

import { api, join } from "./api";

export interface BenchHooks {
  /** Wall-clock time (ms since epoch) of the first paint after startup. */
  firstPaint: Promise<number>;
  openFile: (path: string) => Promise<void>;
  /** Length of the open document, to confirm a file really got loaded. */
  docLength: () => number;
  showPreview: () => Promise<void>;
  renderPreview: (text: string, path: string) => Promise<void>;
}

const PREVIEW_WARMUP = 5;
const PREVIEW_RUNS = 50;
/** How long frames are still watched after the large file is on screen. */
const SETTLE_MS = 1000;

/** Resolves once the current frame has been painted (as a macrotask right after it). */
export function afterPaint(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(() => afterTask().then(() => resolve(Date.now()))));
}

/** Resolves on the next macrotask — after pending microtasks such as follow-up rendering. */
function afterTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

/** Records the longest gap between animation frames, i.e. the longest the UI was frozen. */
class FrameWatch {
  private last = performance.now();
  private raf = 0;
  longest = 0;

  start(): void {
    const tick = (now: number) => {
      this.longest = Math.max(this.longest, now - this.last);
      this.last = now;
      this.raf = requestAnimationFrame(tick);
    };
    this.last = performance.now();
    this.raf = requestAnimationFrame(tick);
  }

  stop(): number {
    cancelAnimationFrame(this.raf);
    // A freeze still in progress when stopping counts too.
    return Math.max(this.longest, performance.now() - this.last);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WebKit renders no frames for a window that is not on screen; fail instead of hanging. */
function framesOrFail<T>(p: Promise<T>): Promise<T> {
  const fail = sleep(5000).then(() => {
    throw new Error("no frames rendered; keep the kayet window visible while benchmarking");
  });
  return Promise.race([p, fail]);
}

async function largeFile(dir: string, hooks: BenchHooks) {
  const watch = new FrameWatch();
  watch.start();
  await sleep(200); // baseline frames before opening
  const t0 = performance.now();
  await hooks.openFile(join(dir, "large.txt"));
  await framesOrFail(afterPaint());
  const open = performance.now() - t0;
  await sleep(SETTLE_MS);
  return { openMs: open, longestFrameMs: watch.stop(), chars: hooks.docLength() };
}

async function preview(dir: string, hooks: BenchHooks) {
  const path = join(dir, "typical.md");
  await hooks.openFile(path);
  await hooks.showPreview();
  const text = await api.readFile(path);
  if (hooks.docLength() !== text.length) throw new Error(`${path} did not open`);
  const total: number[] = [];
  const markdown: number[] = [];
  for (let i = 0; i < PREVIEW_WARMUP + PREVIEW_RUNS; i++) {
    let t = performance.now();
    await api.renderMarkdown(text, dir);
    const md = performance.now() - t;
    t = performance.now();
    await hooks.renderPreview(text, path);
    await afterTask(); // include follow-up work such as code highlighting
    const all = performance.now() - t;
    if (i >= PREVIEW_WARMUP) {
      markdown.push(md);
      total.push(all);
    }
  }
  return { bytes: new TextEncoder().encode(text).length, renderMs: total, markdownMs: markdown };
}

export async function runBench(dir: string, hooks: BenchHooks): Promise<void> {
  const report: Record<string, unknown> = { timeOrigin: performance.timeOrigin };
  try {
    report.firstPaint = await framesOrFail(hooks.firstPaint);
    report.largeFile = await largeFile(dir, hooks);
    report.preview = await preview(dir, hooks);
  } catch (e) {
    report.error = String(e);
  }
  await api.benchReport(report);
}
