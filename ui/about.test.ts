import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => p,
}));

import { About } from "./about";

describe("About", () => {
  let root: HTMLElement;
  let body: HTMLElement;
  let view: About;

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    root = document.createElement("section");
    root.hidden = true;
    body = document.createElement("div");
    root.append(body);
    document.body.replaceChildren(root);
    view = new About(root, body, { exit: () => view.hide() });
  });

  it("shows the name, version and links", () => {
    view.show("0.10.1");
    expect(view.open).toBe(true);
    expect(body.querySelector(".about-name")?.textContent).toBe("kayet");
    expect(body.querySelector(".about-version")?.textContent).toBe("version 0.10.1");
    const hrefs = [...body.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://getkayet.app");
    expect(hrefs).toContain("https://github.com/pwittchen/kayet/graphs/contributors");
  });

  it("opens links in the browser", () => {
    view.show("0.10.1");
    const link = body.querySelector("a")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://getkayet.app/" });
  });

  it("closes with Esc", () => {
    view.show("0.10.1");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(view.open).toBe(false);
  });
});
