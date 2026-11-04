import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { codeSymbols, markdownSymbols, symbolAt } from "./symbols";

const doc = (text: string) => Text.of(text.split("\n"));
const names = (text: string, path: string) => codeSymbols(doc(text), path).map((s) => `${s.kind} ${s.name}`);

describe("markdownSymbols", () => {
  it("lists headings with their level, skipping code fences", () => {
    const text = "# Title\n\ntext\n## Part ##\n```\n# not a heading\n```\n### Sub\n#nospace";
    expect(markdownSymbols(doc(text))).toEqual([
      { name: "Title", kind: "H1", line: 1, depth: 0 },
      { name: "Part", kind: "H2", line: 4, depth: 1 },
      { name: "Sub", kind: "H3", line: 8, depth: 2 },
    ]);
  });
});

describe("codeSymbols", () => {
  it("finds Rust items", () => {
    const text = "pub struct A;\nimpl Display for A {\n    pub fn fmt(&self) {}\n}\n// fn not_this()\nasync fn run() {}";
    expect(names(text, "x.rs")).toEqual(["struct A", "impl Display for A", "fn fmt", "fn run"]);
    expect(codeSymbols(doc(text), "x.rs").map((s) => s.depth)).toEqual([0, 0, 1, 0]);
  });

  it("finds TypeScript functions, classes and types", () => {
    const text = [
      "export class Editor {",
      "  load() {",
      "  }",
      "}",
      "export interface Options {}",
      "type Id = string;",
      "export const run = async (x: number) => x;",
      "function helper() {}",
      "if (x) {",
    ].join("\n");
    expect(names(text, "a.ts")).toEqual([
      "class Editor",
      "function load",
      "interface Options",
      "type Id",
      "function run",
      "function helper",
    ]);
  });

  it("finds Python and Go definitions", () => {
    expect(names("class A:\n    def f(self):\n        pass\n# def no()", "a.py")).toEqual(["class A", "def f"]);
    expect(names("func (s *S) Run() error {\n}\ntype S struct {\n}", "a.go")).toEqual(["func Run", "type S"]);
  });

  it("finds C-family methods but not calls or control flow", () => {
    const text = [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        foo(1);",
      "        return bar(2);",
      "    }",
      "    private int count(List<String> xs) {",
      "}",
    ].join("\n");
    expect(names(text, "Main.java")).toEqual(["class Main", "fn main", "fn count"]);
  });

  it("lists config file sections", () => {
    expect(names("[package]\nname = 1\n[[bin]]\n# [no]", "Cargo.toml")).toEqual(["section package", "section bin"]);
  });
});

describe("symbolAt", () => {
  it("finds the symbol at or before a line", () => {
    const symbols = markdownSymbols(doc("intro\n# A\ntext\n# B"));
    expect(symbolAt(symbols, 1)).toBe(-1);
    expect(symbolAt(symbols, 3)).toBe(0);
    expect(symbolAt(symbols, 4)).toBe(1);
  });
});
