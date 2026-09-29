import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { isWebImage, knownCopy, localCopy, useLocalCopies } from "./images";

beforeEach(() => invoke.mockReset());

describe("isWebImage", () => {
  it("matches http(s) URLs only", () => {
    expect(isWebImage("https://x/a.png")).toBe(true);
    expect(isWebImage("HTTP://x/a.png")).toBe(true);
    expect(isWebImage("/a.png")).toBe(false);
    expect(isWebImage("data:image/png;base64,")).toBe(false);
  });
});

describe("localCopy", () => {
  it("downloads each URL once", async () => {
    invoke.mockResolvedValue("/cache/1.png");
    const [a, b] = await Promise.all([localCopy("https://x/1.png"), localCopy("https://x/1.png")]);
    expect(a).toBe("/cache/1.png");
    expect(b).toBe("/cache/1.png");
    expect(knownCopy("https://x/1.png")).toBe("/cache/1.png");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("cache_image", { url: "https://x/1.png" });
  });
});

describe("useLocalCopies", () => {
  it("points web images at their copies and leaves the rest", async () => {
    invoke.mockImplementation((_cmd: string, args?: { url?: string }) =>
      args?.url?.includes("bad") ? Promise.reject(new Error("404")) : Promise.resolve("/my cache/2.png"),
    );
    const body = document.createElement("div");
    body.innerHTML = '<img src="https://x/2.png"><img src="https://x/bad.png"><img src="/local/a.png">';
    await useLocalCopies(body);
    const srcs = [...body.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["/my%20cache/2.png", "https://x/bad.png", "/local/a.png"]);
  });
});
