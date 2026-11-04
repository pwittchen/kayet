import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { EditorConfig } from "./api";
import { detectIndent, indentation, saveChanges } from "./indent";

const doc = (text: string) => Text.of(text.split("\n"));
const config = (c: Partial<EditorConfig>): EditorConfig => ({
  indent_style: null,
  indent_size: null,
  tab_width: null,
  trim_trailing_whitespace: null,
  insert_final_newline: null,
  ...c,
});

describe("detectIndent", () => {
  it("finds tabs", () => {
    expect(detectIndent(doc("func main() {\n\tx := 1\n\tif x {\n\t\treturn\n\t}\n}"))).toEqual({ tabs: true, size: 4 });
  });

  it("finds the most common space step", () => {
    expect(detectIndent(doc("fn a() {\n  let x = 1;\n  if x {\n    y();\n  }\n}"))?.size).toBe(2);
    expect(detectIndent(doc("def a():\n    x = 1\n    if x:\n        y()\n    return x"))?.size).toBe(4);
  });

  it("skips block comment continuations", () => {
    const text = "/**\n * Docs\n * more\n */\nfunction a() {\n    b();\n    c();\n}";
    expect(detectIndent(doc(text))).toEqual({ tabs: false, size: 4 });
  });

  it("gives up on text without indentation", () => {
    expect(detectIndent(doc("plain\ntext\n"))).toBeNull();
    expect(detectIndent(doc(""))).toBeNull();
  });
});

describe("indentation", () => {
  it("defaults to 4 spaces", () => {
    expect(indentation(doc("plain"), null)).toEqual({ unit: "    ", tabSize: 4 });
  });

  it("follows the text", () => {
    expect(indentation(doc("a\n\tb\n\tc"), null)).toEqual({ unit: "\t", tabSize: 4 });
    expect(indentation(doc("a\n  b\n  c"), null).unit).toBe("  ");
  });

  it("lets .editorconfig win", () => {
    const text = doc("a\n  b\n  c");
    expect(indentation(text, config({ indent_style: "tab", tab_width: 8 }))).toEqual({ unit: "\t", tabSize: 8 });
    expect(indentation(text, config({ indent_size: 4 })).unit).toBe("    ");
    // Only the style set: the size still comes from the text.
    expect(indentation(text, config({ indent_style: "space" })).unit).toBe("  ");
  });
});

describe("saveChanges", () => {
  const apply = (text: string, c: EditorConfig | null, keep?: Set<number>) =>
    applyChanges(text, saveChanges(doc(text), c, "\n", keep));

  function applyChanges(text: string, changes: ReturnType<typeof saveChanges>): string {
    let out = text;
    // Applied back to front so earlier offsets stay valid.
    for (const c of [...changes].reverse() as { from: number; to?: number; insert?: string }[]) {
      out = out.slice(0, c.from) + (c.insert ?? "") + out.slice(c.to ?? c.from);
    }
    return out;
  }

  it("does nothing without .editorconfig rules", () => {
    expect(saveChanges(doc("a  \nb"), null, "\n")).toEqual([]);
    expect(saveChanges(doc("a  \nb"), config({}), "\n")).toEqual([]);
  });

  it("trims trailing whitespace, but not on kept lines", () => {
    const trim = config({ trim_trailing_whitespace: true });
    expect(apply("a  \nb\t\n  \nc", trim)).toBe("a\nb\n\nc");
    expect(apply("a  \nb  ", trim, new Set([2]))).toBe("a\nb  ");
  });

  it("adds a final newline", () => {
    const final = config({ insert_final_newline: true });
    expect(apply("a\nb", final)).toBe("a\nb\n");
    expect(apply("a\nb\n", final)).toBe("a\nb\n");
    expect(apply("", final)).toBe("");
  });
});
