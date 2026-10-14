import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => p,
}));

import { Changelog, changelogStartupAction, isNewerVersion } from "./changelog";

describe("changelogStartupAction", () => {
  it("seeds on first run without showing", () => {
    expect(changelogStartupAction(undefined, "0.8.0")).toBe("seed");
    expect(changelogStartupAction(null, "0.8.0")).toBe("seed");
  });

  it("shows once after an upgrade", () => {
    expect(changelogStartupAction("0.7.1", "0.8.0")).toBe("show");
    expect(changelogStartupAction("0.7.1", "0.7.1")).toBe("none");
  });

  it("re-seeds silently on a downgrade", () => {
    expect(changelogStartupAction("0.8.0", "0.7.1")).toBe("seed");
  });
});

describe("isNewerVersion", () => {
  it("compares numerically", () => {
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("v1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("Changelog", () => {
  let root: HTMLElement;
  let body: HTMLElement;
  let view: Changelog;

  const entries = [
    { version: "0.8.0", body: "- New thing", page: "https://example.com/8", published_at: "2026-01-03T00:00:00Z" },
    { version: "0.7.1", body: "", page: "https://example.com/7", published_at: "" },
  ];

  beforeEach(() => {
    invoke.mockReset();
    root = document.createElement("section");
    root.hidden = true;
    const scroller = document.createElement("div");
    body = document.createElement("div");
    root.append(scroller);
    scroller.append(body);
    document.body.replaceChildren(root);
    view = new Changelog(root, scroller, body, { exit: () => view.hide() });
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_changelog") return Promise.resolve(entries);
      if (cmd === "render_markdown") return Promise.resolve("<p>rendered</p>");
      return Promise.resolve(undefined);
    });
  });

  it("renders one section per release, newest first, with a link for empty notes", async () => {
    await view.show();
    expect(root.hidden).toBe(false);
    const sections = body.querySelectorAll(".changelog-entry");
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector("h2")?.textContent).toBe("0.8.0");
    expect(sections[0].textContent).toContain("2026-01-03");
    expect(sections[0].innerHTML).toContain("rendered");
    const link = sections[1].querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/7");
  });

  it("shows the releases-page notice when the fetch fails", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "get_changelog" ? Promise.reject(new Error("offline")) : Promise.resolve(""),
    );
    await view.show();
    expect(body.textContent).toContain("couldn't be loaded");
    expect(body.querySelector("a")?.getAttribute("href")).toBe("https://github.com/pwittchen/kayet/releases");
  });

  it("opens external links through the backend", async () => {
    await view.show();
    body.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/7" });
  });

  it("resolves relative links against the release page instead of navigating the webview", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_changelog") return Promise.resolve(entries);
      if (cmd === "render_markdown") return Promise.resolve('<p><a href="docs/guide.md">guide</a></p>');
      return Promise.resolve(undefined);
    });
    await view.show();
    const link = body.querySelector('a[href="docs/guide.md"]')!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/docs/guide.md" });
  });

  it("ignores links that do not resolve to http(s) or mailto", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_changelog") return Promise.resolve(entries);
      if (cmd === "render_markdown") return Promise.resolve('<p><a href="file:///etc/passwd">file</a></p>');
      return Promise.resolve(undefined);
    });
    await view.show();
    invoke.mockClear();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    body.querySelector('a[href="file:///etc/passwd"]')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("open_external", expect.anything());
  });

  it("shows the releases-page notice when there are no releases", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "get_changelog" ? Promise.resolve([]) : Promise.resolve(""),
    );
    await view.show();
    expect(body.textContent).toContain("couldn't be loaded");
    expect(body.querySelector("a")?.getAttribute("href")).toBe("https://github.com/pwittchen/kayet/releases");
  });

  it("scrolls to the focused version's section", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      await view.show("0.7.1");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).dataset.version).toBe("0.7.1");
  });

  it("falls back to the release page link when notes fail to render", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_changelog") return Promise.resolve(entries);
      if (cmd === "render_markdown") return Promise.reject(new Error("render failed"));
      return Promise.resolve(undefined);
    });
    await view.show();
    const sections = body.querySelectorAll(".changelog-entry");
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector("a")?.getAttribute("href")).toBe("https://example.com/8");
  });

  it("closes on Escape", async () => {
    await view.show();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(root.hidden).toBe(true);
  });
});
