import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { hangingIndent, hangingPrefix } from "./wrapindent";

describe("hangingPrefix", () => {
  it("covers list markers and their indentation", () => {
    expect(hangingPrefix("- item", 4)).toBe("- ");
    expect(hangingPrefix("    * nested item", 4)).toBe("    * ");
    expect(hangingPrefix("  + item", 4)).toBe("  + ");
    expect(hangingPrefix("12. item", 4)).toBe("12. ");
    expect(hangingPrefix("1) item", 4)).toBe("1) ");
  });

  it("covers task boxes and block quotes", () => {
    expect(hangingPrefix("- [ ] task", 4)).toBe("- [ ] ");
    expect(hangingPrefix("  - [x] done", 4)).toBe("  - [x] ");
    expect(hangingPrefix("> quote", 4)).toBe("> ");
    expect(hangingPrefix("> > - quoted item", 4)).toBe("> > - ");
  });

  it("covers plain indentation, with tabs expanded", () => {
    expect(hangingPrefix("    text", 4)).toBe("    ");
    expect(hangingPrefix("\t- item", 4)).toBe("    - ");
    expect(hangingPrefix("  \titem", 4)).toBe("    ");
  });

  it("is empty for unindented text, markers without a space and blank lines", () => {
    expect(hangingPrefix("text", 4)).toBe("");
    expect(hangingPrefix("-item", 4)).toBe("");
    expect(hangingPrefix("**bold**", 4)).toBe("");
    expect(hangingPrefix("    ", 4)).toBe("");
    expect(hangingPrefix("- ", 4)).toBe("");
    expect(hangingPrefix("", 4)).toBe("");
  });
});

describe("hangingIndent", () => {
  it("indents the wrapped part of list lines only", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "text\n- item\n    - nested", extensions: [EditorView.lineWrapping, hangingIndent] }),
    });
    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")];
    expect(lines[0].style.paddingLeft).toBe("");
    expect(lines[1].style.paddingLeft).not.toBe("");
    expect(lines[1].style.textIndent).toBe(`-${lines[1].style.paddingLeft}`);
    expect(parseFloat(lines[2].style.paddingLeft)).toBeGreaterThan(parseFloat(lines[1].style.paddingLeft));
    view.destroy();
    parent.remove();
  });
});
