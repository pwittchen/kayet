import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileScore, Palette, PaletteItem, PaletteOptions } from "./palette";

const FILES = ["README.md", "notes/todo.md", "notes/ideas.md", "ui/main.ts", "ui/palette.ts", "core/src/main.rs"];

/** Ranks FILES against `query` like the file finder does and returns them best first. */
function rank(query: string): string[] {
  return FILES.map((p) => ({ p, s: fileScore(p.toLowerCase(), query) }))
    .filter((m) => m.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((m) => m.p);
}

describe("fileScore", () => {
  it("prefers file name matches over folder matches", () => {
    expect(rank("main")).toEqual(["ui/main.ts", "core/src/main.rs"]);
    expect(rank("ui")[0]).toBe("ui/main.ts");
    expect(rank("notes")).toEqual(["notes/todo.md", "notes/ideas.md"]);
  });

  it("matches in-order subsequences and ignores spaces", () => {
    expect(rank("plt")).toEqual(["ui/palette.ts"]);
    expect(rank("main rs")).toEqual(["core/src/main.rs"]);
  });

  it("matches a query with a slash against the whole path", () => {
    expect(rank("src/main")).toEqual(["core/src/main.rs"]);
    expect(rank("ui/")).toEqual(["ui/main.ts", "ui/palette.ts"]);
  });

  it("rejects paths that do not contain the query", () => {
    expect(rank("xyz")).toEqual([]);
  });
});

describe("Palette", () => {
  let palette: Palette;
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  const input = () => document.querySelector<HTMLInputElement>("#palette input")!;
  const labels = () => [...document.querySelectorAll("#palette li:not(.empty)")].map((li) => li.textContent);
  const key = (k: string) => input().dispatchEvent(new KeyboardEvent("keydown", { key: k, cancelable: true }));
  const type = (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event("input"));
  };

  const items: PaletteItem[] = [
    { id: "a", label: "alpha.md", detail: "notes" },
    { id: "b", label: "beta.md" },
  ];
  const options = (pick: (id: string) => void): PaletteOptions => ({
    kind: "files",
    placeholder: "Go to file…",
    empty: "No matching files",
    pick,
  });

  beforeEach(() => {
    document.body.replaceChildren();
    onClose = vi.fn<() => void>();
    palette = new Palette(onClose);
  });

  it("filters, picks with Enter and closes", async () => {
    const pick = vi.fn();
    const closed = palette.open(items, options(pick));
    expect(palette.showing).toBe("files");
    expect(labels()).toEqual(["alpha.mdnotes", "beta.md"]);
    type("bet");
    expect(labels()).toEqual(["beta.md"]);
    key("Enter");
    await closed;
    expect(pick).toHaveBeenCalledWith("b");
    expect(palette.showing).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the empty text when nothing matches", () => {
    palette.open(items, options(vi.fn()));
    type("zzz");
    expect(document.querySelector("#palette li.empty")?.textContent).toBe("No matching files");
  });

  it("switches to other items while open without closing", () => {
    const pickFile = vi.fn();
    const pickCommand = vi.fn();
    void palette.open(items, options(pickFile));
    void palette.open([{ id: "save", label: "Save", shortcut: "⌘S" }], {
      ...options(pickCommand),
      kind: "commands",
    });
    expect(palette.showing).toBe("commands");
    expect(onClose).not.toHaveBeenCalled();
    key("Enter");
    expect(pickCommand).toHaveBeenCalledWith("save");
    expect(pickFile).not.toHaveBeenCalled();
  });

  it("preselects the given item so Enter picks it", async () => {
    const pick = vi.fn();
    const closed = palette.open(items, { ...options(pick), selected: 1 });
    key("Enter");
    await closed;
    expect(pick).toHaveBeenCalledWith("b");
  });

  describe("search mode", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const results: Record<string, PaletteItem[]> = {
      todo: [
        { id: "a.md:3", label: "- [ ] todo item", match: [6, 10], aside: "a.md:3" },
        { id: "b.md:1", label: "TODO", match: [0, 4], aside: "b.md:1" },
      ],
    };
    const searchOptions = (search: (q: string) => Promise<PaletteItem[]>, pick = vi.fn()): PaletteOptions => ({
      kind: "search",
      placeholder: "Find in workspace…",
      prompt: "Type to search",
      empty: "No results",
      search,
      pick,
    });
    const emptyText = () => document.querySelector("#palette li.empty")?.textContent;

    it("prompts, searches after a pause and highlights matches", async () => {
      const search = vi.fn((q: string) => Promise.resolve(results[q] ?? []));
      const pick = vi.fn();
      palette.open([], searchOptions(search, pick));
      expect(emptyText()).toBe("Type to search");
      type("to");
      type("todo");
      await vi.advanceTimersByTimeAsync(200);
      expect(search).toHaveBeenCalledExactlyOnceWith("todo");
      expect(labels()).toEqual(["- [ ] todo itema.md:3", "TODOb.md:1"]);
      expect(document.querySelector("#palette mark")?.textContent).toBe("todo");
      key("ArrowDown");
      key("Enter");
      expect(pick).toHaveBeenCalledWith("b.md:1");
    });

    it("shows the empty text for a query without results and drops stale results", async () => {
      let resolveSlow: (items: PaletteItem[]) => void = () => {};
      const search = vi.fn((q: string) =>
        q === "slow" ? new Promise<PaletteItem[]>((r) => (resolveSlow = r)) : Promise.resolve(results[q] ?? []),
      );
      palette.open([], searchOptions(search));
      type("slow");
      await vi.advanceTimersByTimeAsync(200);
      type("zzz");
      await vi.advanceTimersByTimeAsync(200);
      expect(emptyText()).toBe("No results");
      resolveSlow(results.todo);
      await vi.advanceTimersByTimeAsync(0);
      expect(labels()).toEqual([]);
      type("");
      expect(emptyText()).toBe("Type to search");
    });
  });
});
