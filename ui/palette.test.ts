import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
