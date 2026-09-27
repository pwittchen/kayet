import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { SearchQuery } from "@codemirror/search";

import { findBar, findMatches, matchStatus, openFind } from "./find";

describe("findMatches", () => {
  const state = EditorState.create({ doc: "one two one Two one" });

  it("lists every match", () => {
    const { matches, capped } = findMatches(state, new SearchQuery({ search: "one" }));
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
      { from: 16, to: 19 },
    ]);
    expect(capped).toBe(false);
  });

  it("stops at the limit", () => {
    const { matches, capped } = findMatches(state, new SearchQuery({ search: "o" }), 2);
    expect(matches).toHaveLength(2);
    expect(capped).toBe(true);
  });

  it("finds nothing for an empty or invalid query", () => {
    expect(findMatches(state, new SearchQuery({ search: "" })).matches).toEqual([]);
    expect(findMatches(state, new SearchQuery({ search: "(", regexp: true })).matches).toEqual([]);
  });
});

describe("matchStatus", () => {
  const q = new SearchQuery({ search: "x" });

  it("describes the count and the current match", () => {
    expect(matchStatus(new SearchQuery({ search: "" }), 0, 0, false)).toBe("");
    expect(matchStatus(new SearchQuery({ search: "(", regexp: true }), 0, 0, false)).toBe("Invalid pattern");
    expect(matchStatus(q, 0, 0, false)).toBe("No matches");
    expect(matchStatus(q, 1, 0, false)).toBe("1 match");
    expect(matchStatus(q, 1234, 0, false)).toBe("1,234 matches");
    expect(matchStatus(q, 12, 3, false)).toBe("3 of 12");
    expect(matchStatus(q, 1000, 7, true)).toBe("7 of 1,000+");
  });
});

describe("find bar", () => {
  function view(doc: string) {
    return new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: findBar() }) });
  }

  it("opens at the bottom, shows the replace field only for replace", () => {
    const v = view("alpha beta alpha");
    openFind(v, false);
    const bar = v.dom.querySelector(".cm-panels-bottom .find-bar")!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector<HTMLElement>(".find-replace")!.hidden).toBe(true);
    openFind(v, true);
    expect(bar.querySelector<HTMLElement>(".find-replace")!.hidden).toBe(false);
    openFind(v, false);
    expect(bar.querySelector<HTMLElement>(".find-replace")!.hidden).toBe(true);
    v.destroy();
  });

  it("uses the selection as the query and counts matches", () => {
    const v = view("alpha beta alpha");
    v.dispatch({ selection: { anchor: 11, head: 16 } });
    openFind(v, false);
    expect(v.dom.querySelector<HTMLInputElement>(".find-field[name=search]")!.value).toBe("alpha");
    expect(v.dom.querySelector(".find-status")!.textContent).toBe("2 of 2");
    v.destroy();
  });
});
