import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { LanguageSupport } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";

import { ImageSaver, linkTarget, markdownEditing } from "./markdown";

let view: EditorView;

/** Creates a Markdown editor; `|` marks the cursor, `«` … `»` a selection. */
function setup(text: string, save: ImageSaver = async () => null): EditorView {
  const anchor = text.search(/[|«]/);
  const clean = text.replace(/[|«»]/g, "");
  const head = text.includes("»") ? text.indexOf("»") - 1 : anchor;
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: clean,
      selection: EditorSelection.single(anchor, head),
      extensions: [new LanguageSupport(markdownLanguage), markdownEditing(save)],
    }),
  });
  return view;
}

/** The document with the selection marked the same way `setup` reads it. */
function show(): string {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc();
  if (from === to) return text.slice(0, from) + "|" + text.slice(from);
  return text.slice(0, from) + "«" + text.slice(from, to) + "»" + text.slice(to);
}

const mac = /Mac/.test(navigator.platform);

function press(key: string, mod = false): void {
  const event = new KeyboardEvent("keydown", { key, metaKey: mod && mac, ctrlKey: mod && !mac });
  runScopeHandlers(view, event, "editor");
}

function paste(data: { text?: string; files?: File[] }): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? (data.text ?? "") : ""), files: data.files ?? [] },
  });
  view.contentDOM.dispatchEvent(event);
}

afterEach(() => view?.destroy());

describe("list continuation", () => {
  it("continues bullet lists", () => {
    setup("- one|");
    press("Enter");
    expect(show()).toBe("- one\n- |");
  });

  it("continues task lists with an unchecked box", () => {
    setup("- [x] done|");
    press("Enter");
    expect(show()).toBe("- [x] done\n- [ ] |");
  });

  it("increments ordered lists", () => {
    setup("1. one|");
    press("Enter");
    expect(show()).toBe("1. one\n2. |");
  });

  it("ends the list on an empty item", () => {
    setup("- one\n- |");
    press("Enter");
    expect(show()).toBe("- one\n|");
  });
});

describe("bold / italic", () => {
  it("wraps the selection", () => {
    setup("say «hello» now");
    press("b", true);
    expect(show()).toBe("say **«hello»** now");
    press("i", true);
    expect(show()).toBe("say ***«hello»*** now");
  });

  it("unwraps markers around or inside the selection", () => {
    setup("say **«hello»** now");
    press("b", true);
    expect(show()).toBe("say «hello» now");
    view.destroy();
    setup("say «_hello_» now");
    press("i", true);
    expect(show()).toBe("say «hello» now");
  });

  it("removes only the emphasis asked for", () => {
    setup("say ***«hello»*** now");
    press("b", true);
    expect(show()).toBe("say *«hello»* now");
  });

  it("inserts a marker pair at the cursor and removes an empty one", () => {
    setup("say |");
    press("b", true);
    expect(show()).toBe("say **|**");
    press("b", true);
    expect(show()).toBe("say |");
  });
});

describe("pasting", () => {
  it("turns selected text into a link when pasting a URL", () => {
    setup("see «the docs» here");
    paste({ text: "https://example.com" });
    expect(view.state.sliceDoc()).toBe("see [the docs](https://example.com) here");
  });

  it("leaves plain pastes alone", () => {
    setup("see «the docs» here");
    paste({ text: "not a url" });
    expect(view.state.sliceDoc()).toBe("see not a url here");
    view.destroy();
    setup("see |");
    paste({ text: "https://example.com" });
    expect(view.state.sliceDoc()).toBe("see https://example.com");
  });

  it("saves pasted images and inserts them", async () => {
    const save = vi.fn<ImageSaver>(async () => "my notes-1.png");
    setup("look: |", save);
    const image = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    paste({ files: [image] });
    await vi.waitFor(() => expect(show()).toBe("look: ![](<my notes-1.png>)|"));
    expect(save).toHaveBeenCalledWith(image);
  });

  it("ignores pasted files that are not images", () => {
    const save = vi.fn<ImageSaver>();
    setup("|", save);
    paste({ text: "a.txt", files: [new File(["x"], "a.txt", { type: "text/plain" })] });
    expect(view.state.sliceDoc()).toBe("a.txt");
    expect(save).not.toHaveBeenCalled();
  });
});

it("wraps link targets that need it", () => {
  expect(linkTarget("a-1.png")).toBe("a-1.png");
  expect(linkTarget("a b.png")).toBe("<a b.png>");
});
