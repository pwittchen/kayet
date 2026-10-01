// Presentation mode: a Markdown document shown slide by slide, slides divided by `---` lines.

import { Preview } from "./preview";

const UPDATE_DELAY_MS = 150;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SEPARATOR = /^ {0,3}-{3,}[ \t]*$/;

/**
 * Splits Markdown into slides at lines of `---` (three or more dashes), except inside fenced
 * code blocks. Slides with nothing but whitespace are dropped; there is always at least one.
 */
export function splitSlides(text: string): string[] {
  const slides: string[] = [];
  let lines: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const slide = lines.join("\n");
    if (slide.trim()) slides.push(slide);
    lines = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const open = FENCE.exec(line)?.[1];
    if (fence) {
      // A fence closes with at least as many of the same characters and nothing after them.
      if (open && open[0] === fence[0] && open.length >= fence.length && !line.trim().slice(open.length).trim()) {
        fence = null;
      }
    } else if (open) {
      fence = open;
    } else if (SEPARATOR.test(line)) {
      flush();
      continue;
    }
    lines.push(line);
  }
  flush();
  return slides.length ? slides : [""];
}

export interface PresentationCallbacks {
  openFile: (path: string) => void;
  /** Esc was pressed: leave presentation mode. */
  exit: () => void;
}

/**
 * The full-window slide show: one slide at a time, previous / next buttons and a slide counter,
 * with a button back to the first slide on the last one.
 */
export class Presentation {
  private slides: string[] = [];
  private index = 0;
  private path: string | null = null;
  private timer: number | undefined;
  private readonly slide: Preview;

  constructor(
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement,
    body: HTMLElement,
    private readonly prev: HTMLButtonElement,
    private readonly next: HTMLButtonElement,
    private readonly first: HTMLButtonElement,
    private readonly counter: HTMLElement,
    private readonly cb: PresentationCallbacks,
  ) {
    this.slide = new Preview(scroller, body, { openFile: cb.openFile });
    prev.addEventListener("click", () => this.go(this.index - 1));
    next.addEventListener("click", () => this.go(this.index + 1));
    first.addEventListener("click", () => this.go(0));
    // Keep focus on the slide so the keys below keep working after a click on a button.
    for (const button of [prev, next, first]) button.addEventListener("mousedown", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  get active(): boolean {
    return !this.root.hidden;
  }

  get position(): { index: number; count: number } {
    return { index: this.index, count: this.slides.length };
  }

  /** Shows the document `text` (of the file at `path`, for relative images) from its first slide. */
  start(text: string, path: string | null): void {
    this.slides = splitSlides(text);
    this.path = path;
    this.root.hidden = false;
    this.root.focus();
    this.go(0);
  }

  stop(): void {
    window.clearTimeout(this.timer);
    this.root.hidden = true;
    this.slide.clear();
    this.slides = [];
  }

  /** Follows changes to the document (e.g. reloaded from disk), staying on the same slide if it still exists. */
  update(getText: () => string): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.active) return;
      this.slides = splitSlides(getText());
      this.go(this.index);
    }, UPDATE_DELAY_MS);
  }

  /** Shows slide `index` (clamped to the slides there are). */
  go(index: number): void {
    const count = this.slides.length;
    this.index = Math.max(0, Math.min(count - 1, index));
    this.prev.disabled = this.index === 0;
    this.next.disabled = this.index === count - 1;
    this.first.hidden = count < 2 || this.index < count - 1;
    this.counter.textContent = `${this.index + 1} / ${count}`;
    this.scroller.scrollTop = 0;
    void this.slide.render(this.slides[this.index], this.path);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const last = this.slides.length - 1;
    switch (e.key) {
      case "Escape":
        this.cb.exit();
        break;
      case "ArrowRight":
      case "PageDown":
      case " ":
        this.go(e.shiftKey && e.key === " " ? this.index - 1 : this.index + 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        this.go(this.index - 1);
        break;
      case "Home":
        this.go(0);
        break;
      case "End":
        this.go(last);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
