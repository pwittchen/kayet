import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { indentFoldRange } from "./folding";

const state = (text: string) => EditorState.create({ doc: text });
const folded = (text: string, line: number) => {
  const s = state(text);
  const range = indentFoldRange(s, s.doc.line(line).from);
  return range && s.sliceDoc(range.from, range.to);
};

describe("indentFoldRange", () => {
  it("folds the lines indented deeper, keeping the closing line", () => {
    expect(folded("fn a() {\n    b();\n\n    c();\n}\n", 1)).toBe("\n    b();\n\n    c();");
  });

  it("leaves trailing blank lines out", () => {
    expect(folded("def a():\n    b()\n\n\nx = 1", 1)).toBe("\n    b()");
  });

  it("does not fold lines without a deeper block", () => {
    expect(folded("a\nb\n", 1)).toBeNull();
    expect(folded("a\n\n", 2)).toBeNull();
  });

  it("counts tabs by the tab size", () => {
    expect(folded("a {\n\tb\n}", 1)).toBe("\n\tb");
  });
});
