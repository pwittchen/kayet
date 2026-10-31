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

/**
 * The steps a rendered slide is revealed in, each a group of elements shown together: every
 * top-level block and every list item (nested ones too), with consecutive headings as one step.
 */
export function revealSteps(body: HTMLElement): HTMLElement[][] {
  const steps: HTMLElement[][] = [];
  const addItems = (list: Element) => {
    for (const item of list.children as HTMLCollectionOf<HTMLElement>) {
      steps.push([item]);
      for (const nested of item.children) if (nested.matches("ul, ol")) addItems(nested);
    }
  };
  let afterHeading = false;
  for (const block of body.children as HTMLCollectionOf<HTMLElement>) {
    if (block.matches("span[data-line]")) continue; // the renderer's empty source-line anchors
    const heading = block.matches("h1, h2, h3, h4, h5, h6");
    if (heading && afterHeading) steps[steps.length - 1].push(block);
    else if (block.matches("ul, ol")) addItems(block);
    else steps.push([block]);
    afterHeading = heading;
  }
  return steps;
}

export interface PresentationCallbacks {
  openFile: (path: string) => void;
  /** Esc was pressed: leave presentation mode. */
  exit: () => void;
  /** Whether slides are revealed step by step rather than shown whole. */
  stepByStep: () => boolean;
}

/**
 * The full-window slide show: one slide at a time, optionally revealed step by step, previous / next buttons
 * and a slide counter, with a button back to the first slide on the last one.
 */
export class Presentation {
  private slides: string[] = [];
  private index = 0;
  /** The steps of the slide shown, `null` while it renders (moving then waits for it). */
  private steps: HTMLElement[][] | null = null;
  /** The last step of the slide shown that is revealed. */
  private step = 0;
  private renders = 0;
  private path: string | null = null;
  private timer: number | undefined;
  private readonly slide: Preview;

  constructor(
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly body: HTMLElement,
    private readonly prev: HTMLButtonElement,
    private readonly next: HTMLButtonElement,
    private readonly first: HTMLButtonElement,
    private readonly counter: HTMLElement,
    private readonly cb: PresentationCallbacks,
  ) {
    this.slide = new Preview(scroller, body, { openFile: cb.openFile });
    prev.addEventListener("click", () => this.back());
    next.addEventListener("click", () => this.forward());
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
    this.renders++;
    this.slide.clear();
    this.slides = [];
    this.steps = null;
  }

  /** Follows changes to the document (e.g. reloaded from disk), staying on the same slide and step if they still exist. */
  update(getText: () => string): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.active) return;
      this.slides = splitSlides(getText());
      this.go(this.index, this.step);
    }, UPDATE_DELAY_MS);
  }

  /** Shows slide `index` with its steps up to `step` revealed (both clamped to what there is). */
  go(index: number, step = 0): void {
    this.index = Math.max(0, Math.min(this.slides.length - 1, index));
    this.step = step;
    this.steps = null;
    this.scroller.scrollTop = 0;
    const render = ++this.renders;
    void this.slide.render(this.slides[this.index], this.path).finally(() => {
      if (render !== this.renders) return; // left this slide meanwhile
      this.steps = this.cb.stepByStep() ? revealSteps(this.body) : [];
      this.reveal(this.step);
    });
  }

  /** Reveals the next step of the slide, or moves on to the next slide after its last step. */
  private forward(): void {
    if (!this.steps) return;
    if (this.step < this.steps.length - 1) this.reveal(this.step + 1);
    else if (this.index < this.slides.length - 1) this.go(this.index + 1);
  }

  /** Hides the last revealed step, or moves back to the previous slide, revealed in full. */
  private back(): void {
    if (!this.steps) return;
    if (this.step > 0) this.reveal(this.step - 1);
    else if (this.index > 0) this.go(this.index - 1, Infinity);
  }

  /** Reveals the slide's steps up to `step`; the hidden ones keep their place, so nothing shifts. */
  private reveal(step: number): void {
    const steps = this.steps ?? [];
    this.step = Math.max(0, Math.min(steps.length - 1, step));
    steps.forEach((group, i) => {
      for (const el of group) el.classList.toggle("slide-pending", i > this.step);
    });
    steps[this.step]?.at(-1)?.scrollIntoView({ block: "nearest" });
    const count = this.slides.length;
    const lastSlide = this.index === count - 1;
    this.prev.disabled = this.index === 0 && this.step === 0;
    this.next.disabled = lastSlide && this.step >= steps.length - 1;
    this.first.hidden = count < 2 || !lastSlide;
    this.counter.textContent = `${this.index + 1} / ${count}`;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    switch (e.key) {
      case "Escape":
        this.cb.exit();
        break;
      case "ArrowRight":
      case "PageDown":
      case " ":
        if (e.shiftKey && e.key === " ") this.back();
        else this.forward();
        break;
      case "ArrowLeft":
      case "PageUp":
        this.back();
        break;
      case "Home":
        this.go(0);
        break;
      case "End":
        this.go(this.slides.length - 1, Infinity);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
