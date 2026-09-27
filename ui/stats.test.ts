import { describe, expect, it } from "vitest";

import { countWords, formatStats } from "./stats";

describe("countWords", () => {
  it("counts whitespace separated words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("one two\nthree\t four  ")).toBe(4);
  });

  it("ignores Markdown markers and punctuation on their own", () => {
    expect(countWords("# Title\n\n- item one\n- [ ] task\n\n---\n\n> quote — end")).toBe(6);
    expect(countWords("**bold** _it_ `code` [link](https://x.y)")).toBe(4);
  });

  it("counts contractions, hyphenated words, numbers and non-Latin words once", () => {
    expect(countWords("don't well-known 42 zażółć Привет")).toBe(5);
  });

  it("gives the same count when called repeatedly", () => {
    expect(countWords("a b c")).toBe(3);
    expect(countWords("a b c")).toBe(3);
  });
});

describe("formatStats", () => {
  it("is empty without words", () => {
    expect(formatStats(0)).toBe("");
  });

  it("shows words and at least one minute of reading", () => {
    expect(formatStats(1)).toBe("1 word · 1 min read");
    expect(formatStats(99)).toBe("99 words · 1 min read");
    expect(formatStats(1234)).toBe("1,234 words · 6 min read");
  });
});
