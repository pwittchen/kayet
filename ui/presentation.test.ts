import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => p,
}));

import { Presentation, splitSlides } from "./presentation";

describe("splitSlides", () => {
  it("splits at --- lines", () => {
    expect(splitSlides("# One\n\n---\n\n# Two\n---\n# Three")).toEqual(["# One\n", "\n# Two", "# Three"]);
  });

  it("accepts longer rules, up to three spaces of indent and trailing spaces, and CRLF", () => {
    expect(splitSlides("a\r\n -----  \r\nb")).toEqual(["a", "b"]);
    expect(splitSlides("a\n    ---\nb")).toEqual(["a\n    ---\nb"]);
  });

  it("ignores --- inside fenced code blocks", () => {
    const text = "```yaml\n---\nkey: 1\n```\n---\n~~~~\n---\n~~~\n---\n~~~~\nb";
    expect(splitSlides(text)).toEqual(["```yaml\n---\nkey: 1\n```", "~~~~\n---\n~~~\n---\n~~~~\nb"]);
  });

  it("drops empty slides but always keeps one", () => {
    expect(splitSlides("---\na\n---\n\n---\nb\n---\n")).toEqual(["a", "b"]);
    expect(splitSlides("")).toEqual([""]);
    expect(splitSlides("---\n  \n---")).toEqual([""]);
  });

  it("keeps a document without separators as a single slide", () => {
    expect(splitSlides("# Title\n\ntext")).toEqual(["# Title\n\ntext"]);
  });
});

describe("Presentation", () => {
  let root: HTMLElement;
  let prev: HTMLButtonElement;
  let next: HTMLButtonElement;
  let first: HTMLButtonElement;
  let counter: HTMLElement;
  let exit: ReturnType<typeof vi.fn<() => void>>;
  let presentation: Presentation;

  const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  const rendered = () => invoke.mock.calls.at(-1)?.[1].text;

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue("");
    root = document.createElement("section");
    root.hidden = true;
    const scroller = document.createElement("div");
    const body = document.createElement("article");
    prev = document.createElement("button");
    next = document.createElement("button");
    first = document.createElement("button");
    counter = document.createElement("div");
    document.body.replaceChildren(root);
    exit = vi.fn();
    presentation = new Presentation(root, scroller, body, prev, next, first, counter, { openFile: vi.fn(), exit });
  });

  it("starts on the first slide and moves with the buttons and keys", () => {
    presentation.start("a\n---\nb\n---\nc", "/w/deck.md");
    expect(presentation.active).toBe(true);
    expect(counter.textContent).toBe("1 / 3");
    expect(prev.disabled).toBe(true);
    expect(rendered()).toBe("a");
    expect(invoke).toHaveBeenLastCalledWith("render_markdown", { text: "a", base: "/w" });

    next.click();
    expect(counter.textContent).toBe("2 / 3");
    expect(rendered()).toBe("b");
    key("ArrowRight");
    expect(counter.textContent).toBe("3 / 3");
    expect(next.disabled).toBe(true);
    expect(first.hidden).toBe(false);
    key("ArrowRight");
    expect(counter.textContent).toBe("3 / 3");
    prev.click();
    key("ArrowLeft");
    expect(counter.textContent).toBe("1 / 3");
    expect(first.hidden).toBe(true);
    key("End");
    expect(counter.textContent).toBe("3 / 3");
    key("Home");
    expect(counter.textContent).toBe("1 / 3");
    key("End");
    first.click();
    expect(counter.textContent).toBe("1 / 3");
    expect(first.hidden).toBe(true);
  });

  it("asks to exit on Esc and stops", () => {
    presentation.start("a", null);
    expect(first.hidden).toBe(true);
    key("Escape");
    expect(exit).toHaveBeenCalledOnce();
    presentation.stop();
    expect(presentation.active).toBe(false);
    key("Escape");
    expect(exit).toHaveBeenCalledOnce();
  });

  it("follows document changes, staying on the slide if it still exists", () => {
    vi.useFakeTimers();
    presentation.start("a\n---\nb\n---\nc", null);
    presentation.go(2);
    presentation.update(() => "a\n---\nB");
    vi.runAllTimers();
    expect(counter.textContent).toBe("2 / 2");
    expect(rendered()).toBe("B");
    vi.useRealTimers();
  });
});
