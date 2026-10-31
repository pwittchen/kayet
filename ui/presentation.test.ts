import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => p,
}));

import { Presentation, revealSteps, splitSlides } from "./presentation";

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

describe("revealSteps", () => {
  const steps = (html: string) => {
    const body = document.createElement("article");
    body.innerHTML = html;
    return revealSteps(body).map((group) => group.map((el) => el.firstChild?.textContent ?? el.tagName));
  };

  it("makes every block a step, skipping the source-line anchors", () => {
    const anchor = '<span data-line="0"></span>';
    expect(steps(`${anchor}<p>a</p>${anchor}<pre>b</pre>${anchor}<blockquote>c</blockquote>`)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("makes every list item a step, nested ones too", () => {
    const html = "<p>a</p><ul><li>b<ul><li>c</li></ul></li><li>d</li></ul><ol><li>e</li></ol>";
    expect(steps(html)).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]]);
  });

  it("keeps consecutive headings together", () => {
    expect(steps("<h1>a</h1><h2>b</h2><p>c</p><h2>d</h2><p>e</p>")).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
  });

  it("finds nothing in an empty slide", () => {
    expect(steps("")).toEqual([]);
  });
});

describe("Presentation", () => {
  let root: HTMLElement;
  let prev: HTMLButtonElement;
  let next: HTMLButtonElement;
  let first: HTMLButtonElement;
  let counter: HTMLElement;
  let exit: ReturnType<typeof vi.fn<() => void>>;
  let body: HTMLElement;
  let stepByStep: boolean;
  let presentation: Presentation;

  const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  const rendered = () => invoke.mock.calls.at(-1)?.[1].text;
  /** Lets the slide being rendered arrive. */
  const settled = () => new Promise((resolve) => setTimeout(resolve));
  const visible = () => [...body.querySelectorAll("p, li")]
    .filter((el) => !el.classList.contains("slide-pending"))
    .map((el) => el.textContent);

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue("");
    root = document.createElement("section");
    root.hidden = true;
    const scroller = document.createElement("div");
    body = document.createElement("article");
    prev = document.createElement("button");
    next = document.createElement("button");
    first = document.createElement("button");
    counter = document.createElement("div");
    document.body.replaceChildren(root);
    exit = vi.fn();
    stepByStep = true;
    presentation = new Presentation(root, scroller, body, prev, next, first, counter, {
      openFile: vi.fn(),
      exit,
      stepByStep: () => stepByStep,
    });
  });

  it("starts on the first slide and moves with the buttons and keys", async () => {
    const move = async (act: () => void) => {
      act();
      await settled();
    };
    presentation.start("a\n---\nb\n---\nc", "/w/deck.md");
    await settled();
    expect(presentation.active).toBe(true);
    expect(counter.textContent).toBe("1 / 3");
    expect(prev.disabled).toBe(true);
    expect(rendered()).toBe("a");
    expect(invoke).toHaveBeenLastCalledWith("render_markdown", { text: "a", base: "/w" });

    await move(() => next.click());
    expect(counter.textContent).toBe("2 / 3");
    expect(rendered()).toBe("b");
    await move(() => key("ArrowRight"));
    expect(counter.textContent).toBe("3 / 3");
    expect(next.disabled).toBe(true);
    expect(first.hidden).toBe(false);
    await move(() => key("ArrowRight"));
    expect(counter.textContent).toBe("3 / 3");
    await move(() => prev.click());
    await move(() => key("ArrowLeft"));
    expect(counter.textContent).toBe("1 / 3");
    expect(first.hidden).toBe(true);
    await move(() => key("End"));
    expect(counter.textContent).toBe("3 / 3");
    await move(() => key("Home"));
    expect(counter.textContent).toBe("1 / 3");
    await move(() => key("End"));
    await move(() => first.click());
    expect(counter.textContent).toBe("1 / 3");
    expect(first.hidden).toBe(true);
  });

  it("reveals a slide step by step before moving on, and hides the steps moving back", async () => {
    invoke.mockImplementation(async (_, { text }: { text: string }) =>
      text === "one" ? "<p>a</p><ul><li>b</li><li>c</li></ul>" : "<p>d</p><p>e</p>",
    );
    presentation.start("one\n---\ntwo", null);
    await settled();
    expect(visible()).toEqual(["a"]);
    expect(prev.disabled).toBe(true);

    next.click();
    expect(visible()).toEqual(["a", "b"]);
    expect(prev.disabled).toBe(false);
    key(" ");
    expect(visible()).toEqual(["a", "b", "c"]);
    expect(counter.textContent).toBe("1 / 2");

    key("ArrowRight");
    await settled();
    expect(counter.textContent).toBe("2 / 2");
    expect(visible()).toEqual(["d"]);
    expect(next.disabled).toBe(false);
    key("ArrowRight");
    expect(visible()).toEqual(["d", "e"]);
    expect(next.disabled).toBe(true);

    key("ArrowLeft");
    expect(visible()).toEqual(["d"]);
    prev.click();
    await settled();
    expect(counter.textContent).toBe("1 / 2");
    expect(visible()).toEqual(["a", "b", "c"]);
    key("Home");
    await settled();
    expect(visible()).toEqual(["a"]);
    key("End");
    await settled();
    expect(visible()).toEqual(["d", "e"]);
  });

  it("shows whole slides when step by step reveal is off", async () => {
    stepByStep = false;
    invoke.mockResolvedValue("<p>a</p><p>b</p>");
    presentation.start("one\n---\ntwo", null);
    await settled();
    expect(visible()).toEqual(["a", "b"]);
    next.click();
    await settled();
    expect(counter.textContent).toBe("2 / 2");
    expect(next.disabled).toBe(true);
    prev.click();
    await settled();
    expect(counter.textContent).toBe("1 / 2");
    expect(visible()).toEqual(["a", "b"]);
  });

  it("doesn't skip steps while the next slide is rendering", async () => {
    invoke.mockResolvedValue("<p>a</p><p>b</p>");
    presentation.start("one\n---\ntwo", null);
    key("ArrowRight");
    key("ArrowRight");
    await settled();
    expect(counter.textContent).toBe("1 / 2");
    expect(visible()).toEqual(["a"]);
  });

  it("asks to exit on Esc and stops", async () => {
    presentation.start("a", null);
    await settled();
    expect(first.hidden).toBe(true);
    key("Escape");
    expect(exit).toHaveBeenCalledOnce();
    presentation.stop();
    expect(presentation.active).toBe(false);
    key("Escape");
    expect(exit).toHaveBeenCalledOnce();
  });

  it("follows document changes, staying on the slide and step if they still exist", async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue("<p>a</p><p>b</p><p>c</p>");
    presentation.start("a\n---\nb\n---\nc", null);
    presentation.go(2, 1);
    await vi.runAllTimersAsync();
    expect(visible()).toEqual(["a", "b"]);
    presentation.update(() => "a\n---\nB");
    await vi.runAllTimersAsync();
    expect(counter.textContent).toBe("2 / 2");
    expect(rendered()).toBe("B");
    expect(visible()).toEqual(["a", "b"]);
    vi.useRealTimers();
  });
});
