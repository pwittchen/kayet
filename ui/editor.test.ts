import { describe, expect, it } from "vitest";

import { Editor } from "./editor";

const settings = { fontFamily: "mono" as const, fontSize: 15, lineHeight: 1.6, softWrap: true, maxLineWidth: 72 };
const callbacks = { onChange: () => {}, onScroll: () => {}, onType: () => {}, onPasteImage: async () => null };

describe("spell check", () => {
  const spellcheck = (editor: Editor) => editor.view.contentDOM.getAttribute("spellcheck");

  it("is off by default and toggles", () => {
    const editor = new Editor(document.createElement("div"), settings, callbacks);
    expect(spellcheck(editor)).toBe("false");
    editor.setSpellCheck(true);
    expect(spellcheck(editor)).toBe("true");
    editor.setSpellCheck(false);
    expect(spellcheck(editor)).toBe("false");
  });

  it("stays on when another document is loaded", () => {
    const editor = new Editor(document.createElement("div"), settings, callbacks);
    editor.setSpellCheck(true);
    editor.load("# notes", "markdown");
    expect(spellcheck(editor)).toBe("true");
  });

  it("never autocorrects", () => {
    const editor = new Editor(document.createElement("div"), settings, callbacks);
    editor.setSpellCheck(true);
    expect(editor.view.contentDOM.getAttribute("autocorrect")).toBe("off");
  });
});

describe("spell check sweep", () => {
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r));
  };
  const setup = () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new Editor(parent, settings, callbacks);
    editor.load("first line\n\nsecond line\nthird line", null);
    editor.view.dispatch({ selection: { anchor: 3 } });
    editor.focus();
    return editor;
  };

  it("puts the caret back where it was", async () => {
    const editor = setup();
    editor.setSpellCheck(true);
    await ticks(10);
    expect(editor.view.state.selection.main.head).toBe(3);
    expect(editor.text()).toBe("first line\n\nsecond line\nthird line");
  });

  it("puts the caret back as soon as a key is pressed", async () => {
    const editor = setup();
    editor.setSpellCheck(true);
    await ticks(2);
    expect(editor.view.state.selection.main.head).not.toBe(3); // mid-sweep
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(editor.view.state.selection.main.head).toBe(3);
  });
});
