// Markdown preview pane: debounced rendering in Rust, link handling, scroll sync.

import { convertFileSrc } from "@tauri-apps/api/core";
import { api, dirname, isMarkdown, safeDecode } from "./api";
import { isWebImage, knownCopy, localCopy } from "./images";

const RENDER_DELAY_MS = 150;

export interface PreviewCallbacks {
  openFile: (path: string) => void;
}

export class Preview {
  private timer: number | undefined;
  private seq = 0;
  private anchors: { line: number; top: number }[] = [];

  constructor(
    private readonly scroller: HTMLElement,
    private readonly body: HTMLElement,
    private readonly cb: PreviewCallbacks,
  ) {
    body.addEventListener("click", (e) => this.onClick(e));
  }

  /** Schedules a debounced render. */
  update(getText: () => string, filePath: string | null): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.render(getText(), filePath), RENDER_DELAY_MS);
  }

  /** Renders right away (e.g. when the pane is opened). */
  async render(text: string, filePath: string | null): Promise<void> {
    window.clearTimeout(this.timer);
    const seq = ++this.seq;
    const html = await api.renderMarkdown(text, filePath ? dirname(filePath) : null);
    if (seq !== this.seq) return; // a newer render is in flight
    this.body.innerHTML = html;
    this.postProcess();
    this.measure();
  }

  clear(): void {
    window.clearTimeout(this.timer);
    this.seq++;
    this.body.innerHTML = "";
    this.anchors = [];
  }

  private postProcess(): void {
    for (const img of this.body.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (src.startsWith("/")) {
        img.src = convertFileSrc(safeDecode(src));
      } else if (isWebImage(src)) {
        const copy = knownCopy(src);
        if (copy) img.src = convertFileSrc(copy);
        else void localCopy(src).then((path) => (img.src = convertFileSrc(path)), () => {});
      }
      // Not `once`: a web image may load again from its local copy.
      img.addEventListener("load", () => this.measure());
    }
    const blocks = this.body.querySelectorAll<HTMLElement>("pre > code[class*='language-']");
    if (blocks.length > 0) {
      const seq = this.seq;
      void import("./highlight").then(({ highlightBlocks }) => {
        if (seq === this.seq) highlightBlocks(blocks);
      });
    }
  }

  /** Caches the positions of the source-line anchors emitted by the renderer. */
  measure(): void {
    const base = this.body.getBoundingClientRect().top - this.scroller.scrollTop;
    this.anchors = [...this.body.querySelectorAll<HTMLElement>("[data-line]")].map((el) => {
      // Anchors are empty; the block after them carries the real position.
      const target = (el.nextElementSibling as HTMLElement | null) ?? el;
      return { line: Number(el.dataset.line), top: target.getBoundingClientRect().top - base };
    });
  }

  /** Scrolls so that the given (fractional, 0-based) source line is at the top. */
  syncTo(line: number, atBottom: boolean): void {
    const s = this.scroller;
    if (atBottom) {
      s.scrollTop = s.scrollHeight;
      return;
    }
    const a = this.anchors;
    if (a.length === 0) return;
    let i = 0;
    while (i + 1 < a.length && a[i + 1].line <= line) i++;
    const cur = a[i];
    const next = a[i + 1];
    let top = cur.top;
    if (line < cur.line) {
      top = (cur.top * line) / Math.max(1, cur.line);
    } else if (next && next.line > cur.line) {
      top = cur.top + ((next.top - cur.top) * (line - cur.line)) / (next.line - cur.line);
    }
    s.scrollTop = Math.max(0, top - 24);
  }

  private onClick(e: MouseEvent): void {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const id = safeDecode(href.slice(1));
      this.body.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
    } else if (/^(https?:|mailto:)/i.test(href)) {
      void api.openExternal(href);
    } else if (href.startsWith("/")) {
      const path = safeDecode(href.replace(/[?#].*$/, ""));
      if (isMarkdown(path)) this.cb.openFile(path);
      else void api.reveal(path).catch(() => {});
    }
  }
}
