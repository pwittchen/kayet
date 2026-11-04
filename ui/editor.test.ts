import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { Editor, cssFontFamily } from "./editor";

// happy-dom fires `selectionchange` synchronously inside `Selection.collapse`, so CodeMirror sees
// it while still writing its own selection and re-enters `EditorView.update`. Browsers queue the
// event as a task; do the same here.
const dispatch = document.dispatchEvent.bind(document);
document.dispatchEvent = (event: Event) => {
  if (event.type !== "selectionchange") return dispatch(event);
  setTimeout(() => dispatch(event));
  return true;
};

const settings = { fontFamily: "mono", fontSize: 15, lineHeight: 1.6, softWrap: true, maxLineWidth: 72 };
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

describe("code editor mode", () => {
  const gutter = (editor: Editor) => editor.view.dom.querySelector(".cm-lineNumbers");
  const wraps = (editor: Editor) => editor.view.contentDOM.classList.contains("cm-lineWrapping");

  it("is off by default and toggles line numbers, wrapping and its class", () => {
    const editor = new Editor(document.createElement("div"), settings, callbacks);
    expect(gutter(editor)).toBeNull();
    expect(wraps(editor)).toBe(true);
    editor.setCodeMode(true);
    expect(gutter(editor)).not.toBeNull();
    expect(wraps(editor)).toBe(false);
    expect(editor.view.dom.classList.contains("cm-code-mode")).toBe(true);
    editor.setCodeMode(false);
    expect(gutter(editor)).toBeNull();
    expect(wraps(editor)).toBe(true);
    expect(editor.view.dom.classList.contains("cm-code-mode")).toBe(false);
  });

  it("stays on when another document is loaded or restored", () => {
    const editor = new Editor(document.createElement("div"), settings, callbacks);
    const snapshot = editor.snapshot();
    editor.setCodeMode(true);
    editor.load("fn main() {}", null);
    expect(gutter(editor)).not.toBeNull();
    editor.restore(snapshot);
    expect(gutter(editor)).not.toBeNull();
    expect(wraps(editor)).toBe(false);
  });

  it("keeps wrapping off when the settings change", () => {
    const editor = new Editor(document.createElement("div"), settings, callbacks);
    editor.setCodeMode(true);
    editor.applySettings({ ...settings, softWrap: true });
    expect(wraps(editor)).toBe(false);
  });
});

describe("font family", () => {
  it("maps the keywords to the built-in stacks", () => {
    expect(cssFontFamily("mono")).toBe("var(--font-mono)");
    expect(cssFontFamily(" System ")).toBe("var(--font-ui)");
    expect(cssFontFamily("")).toBe("var(--font-mono)");
  });

  it("quotes custom families and falls back to the monospace stack", () => {
    expect(cssFontFamily("Iosevka, Sarasa Mono J")).toBe('"Iosevka", "Sarasa Mono J", var(--font-mono)');
    expect(cssFontFamily("'Berkeley Mono', monospace")).toBe('"Berkeley Mono", monospace, var(--font-mono)');
  });

  it("cannot break out of the declaration", () => {
    expect(cssFontFamily('a"; color: red')).toBe('"a\\"; color: red", var(--font-mono)');
  });
});

describe("code editing", () => {
  const editor = () => new Editor(document.createElement("div"), settings, callbacks);
  const addCursor = (e: Editor) =>
    e.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]) });

  it("allows multiple cursors only in code editor mode", () => {
    const e = editor();
    e.load("abc", null);
    addCursor(e);
    expect(e.view.state.selection.ranges).toHaveLength(1);
    e.setCodeMode(true);
    addCursor(e);
    expect(e.view.state.selection.ranges).toHaveLength(2);
    e.setCodeMode(false);
    expect(e.view.state.selection.ranges).toHaveLength(1);
  });

  it("detects the indentation and takes it from .editorconfig", () => {
    const e = editor();
    e.load("a\n\tb\n\tc", null);
    expect(e.indentation).toEqual({ unit: "\t", tabSize: 4 });
    e.setEditorConfig({ indent_style: "space", indent_size: 2, tab_width: null, trim_trailing_whitespace: null, insert_final_newline: null });
    expect(e.indentation).toEqual({ unit: "  ", tabSize: 4 });
  });

  it("applies the save rules as an edit, keeping the cursor line during autosave", () => {
    const e = editor();
    e.load("a  \nb  ", null);
    e.view.dispatch({ selection: { anchor: e.doc.length } });
    const rules = { indent_style: null, indent_size: null, tab_width: null, trim_trailing_whitespace: true, insert_final_newline: true };
    e.applySaveRules(rules, true);
    expect(e.text()).toBe("a\nb  \n");
    e.applySaveRules(rules, false);
    expect(e.text()).toBe("a\nb\n");
  });

  it("goes to a line and column, clamped to the document", () => {
    const e = editor();
    e.load("one\ntwo\nthree", null);
    e.goToLine(2, 3);
    expect(e.view.state.selection.main.head).toBe(6);
    expect(e.cursorLine()).toBe(2);
    e.goToLine(99, 99);
    expect(e.view.state.selection.main.head).toBe(e.doc.length);
  });

  it("closes brackets in code files only", () => {
    const e = editor();
    e.load("", null);
    const type = (text: string) => {
      const { from, to } = e.view.state.selection.main;
      // What CodeMirror's input handlers see for typed text.
      if (!e.view.state.facet(EditorView.inputHandler).some((h) => h(e.view, from, to, text, () => e.view.state.update({ changes: { from, to, insert: text } })))) {
        e.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      }
    };
    type("(");
    expect(e.text()).toBe("(");
    e.load("", null);
    e.setCodeFile(true);
    type("(");
    expect(e.text()).toBe("()");
  });
});
