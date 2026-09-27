import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "./api";

// A tiny in-memory workspace served by the mocked `listDir`.
const FS: Record<string, [string, boolean][]> = {
  "/ws": [["docs", true], ["src", true], ["a.md", false], ["b.md", false]],
  "/ws/docs": [["notes", true], ["guide.md", false]],
  "/ws/docs/notes": [["n.md", false]],
  "/ws/src": [["main.rs", false]],
};

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    listDir: vi.fn(async (dir: string): Promise<Entry[]> =>
      (FS[dir] ?? []).map(([name, is_dir]) => ({ name, path: `${dir}/${name}`, is_dir })),
    ),
    trash: vi.fn(() => Promise.resolve()),
    showContextMenu: vi.fn(() => Promise.resolve()),
  },
}));

import { api } from "./api";
import { FileTree, TreeCallbacks } from "./tree";

let el: HTMLElement;
let cb: { [K in keyof TreeCallbacks]: ReturnType<typeof vi.fn<TreeCallbacks[K]>> };
let tree: FileTree;

/** Lets pending lazy directory loads settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

/** Dispatches a keydown on the tree and returns whether the tree handled (prevented) it. */
async function press(key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  await flush();
  return event.defaultPrevented;
}

const selected = () => el.querySelector<HTMLElement>(".tree-row.selected")?.dataset.path;
const visibleRows = () =>
  [...el.querySelectorAll<HTMLElement>(".tree-row")].map((row) => row.dataset.path);
const expanded = (path: string) =>
  el.querySelector(`.tree-row[data-path="${path}"]`)?.getAttribute("aria-expanded");

beforeEach(async () => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView ??= () => {};
  el = document.createElement("div");
  el.tabIndex = 0;
  document.body.replaceChildren(el);
  cb = { openFile: vi.fn(), renamed: vi.fn(), trashed: vi.fn(), notify: vi.fn() };
  tree = new FileTree(el, cb);
  await tree.setRoot("/ws");
});

describe("arrow up / down", () => {
  it("starts at the first row on ArrowDown with nothing selected", async () => {
    expect(selected()).toBeUndefined();
    expect(await press("ArrowDown")).toBe(true);
    expect(selected()).toBe("/ws/docs");
  });

  it("starts at the last row on ArrowUp with nothing selected", async () => {
    await press("ArrowUp");
    expect(selected()).toBe("/ws/b.md");
  });

  it("walks the visible rows in order", async () => {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      await press("ArrowDown");
      seen.push(selected());
    }
    expect(seen).toEqual(["/ws/docs", "/ws/src", "/ws/a.md", "/ws/b.md"]);
    await press("ArrowUp");
    expect(selected()).toBe("/ws/a.md");
  });

  it("clamps at both ends", async () => {
    await press("ArrowUp");
    await press("ArrowDown");
    expect(selected()).toBe("/ws/b.md");
    for (let i = 0; i < 6; i++) await press("ArrowUp");
    expect(selected()).toBe("/ws/docs");
  });

  it("includes the children of expanded folders", async () => {
    await press("ArrowDown"); // docs
    await press("ArrowRight"); // expand docs
    await press("ArrowDown");
    expect(selected()).toBe("/ws/docs/notes");
    await press("ArrowDown");
    expect(selected()).toBe("/ws/docs/guide.md");
    await press("ArrowDown");
    expect(selected()).toBe("/ws/src");
  });

  it("does nothing in an empty workspace", async () => {
    await tree.setRoot("/empty");
    expect(await press("ArrowDown")).toBe(true);
    expect(selected()).toBeUndefined();
  });
});

describe("arrow right / left", () => {
  it("expands a collapsed folder and keeps it selected", async () => {
    await press("ArrowDown");
    expect(expanded("/ws/docs")).toBe("false");
    expect(await press("ArrowRight")).toBe(true);
    expect(expanded("/ws/docs")).toBe("true");
    expect(selected()).toBe("/ws/docs");
    expect(api.listDir).toHaveBeenCalledWith("/ws/docs");
    expect(visibleRows()).toEqual([
      "/ws/docs",
      "/ws/docs/notes",
      "/ws/docs/guide.md",
      "/ws/src",
      "/ws/a.md",
      "/ws/b.md",
    ]);
  });

  it("moves into an already expanded folder", async () => {
    await press("ArrowDown");
    await press("ArrowRight");
    await press("ArrowRight");
    expect(selected()).toBe("/ws/docs/notes");
  });

  it("does nothing on a file", async () => {
    await press("ArrowUp"); // b.md
    await press("ArrowRight");
    expect(selected()).toBe("/ws/b.md");
    expect(visibleRows()).toHaveLength(4);
  });

  it("collapses an expanded folder", async () => {
    await press("ArrowDown");
    await press("ArrowRight");
    expect(await press("ArrowLeft")).toBe(true);
    expect(expanded("/ws/docs")).toBe("false");
    expect(selected()).toBe("/ws/docs");
    expect(visibleRows()).toHaveLength(4);
  });

  it("moves from a child to its parent folder", async () => {
    await press("ArrowDown"); // docs
    await press("ArrowRight"); // expand docs
    await press("ArrowRight"); // notes
    await press("ArrowRight"); // expand notes
    await press("ArrowRight"); // n.md
    expect(selected()).toBe("/ws/docs/notes/n.md");
    await press("ArrowLeft");
    expect(selected()).toBe("/ws/docs/notes");
    await press("ArrowLeft"); // collapse notes
    await press("ArrowLeft");
    expect(selected()).toBe("/ws/docs");
  });

  it("stays on a top-level entry with no parent row", async () => {
    await press("ArrowUp"); // b.md
    await press("ArrowLeft");
    expect(selected()).toBe("/ws/b.md");
  });

  it("does not load a folder's children twice", async () => {
    await press("ArrowDown");
    await press("ArrowRight");
    await press("ArrowLeft");
    await press("ArrowRight");
    expect(vi.mocked(api.listDir).mock.calls.filter(([dir]) => dir === "/ws/docs")).toHaveLength(1);
  });
});

describe("Enter", () => {
  it("opens the selected file", async () => {
    await press("ArrowUp");
    expect(await press("Enter")).toBe(true);
    expect(cb.openFile).toHaveBeenCalledExactlyOnceWith("/ws/b.md");
  });

  it("toggles the selected folder", async () => {
    await press("ArrowDown");
    await press("Enter");
    expect(expanded("/ws/docs")).toBe("true");
    await press("Enter");
    expect(expanded("/ws/docs")).toBe("false");
    expect(cb.openFile).not.toHaveBeenCalled();
  });

  it("does nothing without a selection", async () => {
    await press("Enter");
    expect(cb.openFile).not.toHaveBeenCalled();
  });
});

describe("⌘⌫", () => {
  it("moves the selected entry to the Trash", async () => {
    await press("ArrowUp");
    expect(await press("Backspace", { metaKey: true })).toBe(true);
    expect(api.trash).toHaveBeenCalledExactlyOnceWith("/ws/b.md");
    expect(cb.trashed).toHaveBeenCalledWith("/ws/b.md");
  });

  it("ignores a plain Backspace", async () => {
    await press("ArrowUp");
    expect(await press("Backspace")).toBe(false);
    expect(api.trash).not.toHaveBeenCalled();
  });
});

describe("other keys", () => {
  it("are left to the browser", async () => {
    await press("ArrowDown");
    expect(await press("a")).toBe(false);
    expect(await press("Tab")).toBe(false);
    expect(selected()).toBe("/ws/docs");
  });

  it("are all ignored while renaming inline", async () => {
    await press("ArrowUp"); // b.md
    el.querySelector(".tree-row.selected")!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    tree.handleMenu("ctx:rename");
    expect(el.querySelector("input.tree-input")).not.toBeNull();

    expect(await press("ArrowUp")).toBe(false);
    expect(await press("Enter")).toBe(false);
    expect(el.querySelector("input.tree-input")).not.toBeNull();
    expect(cb.openFile).not.toHaveBeenCalled();
  });
});
