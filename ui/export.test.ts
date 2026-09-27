import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

import { documentTitle, htmlDocument, imageType } from "./export";

describe("documentTitle", () => {
  it("uses the first h1, or the fallback", () => {
    const body = document.createElement("article");
    body.innerHTML = "<h2>Sub</h2><h1> Main <em>title</em> </h1><h1>Other</h1>";
    expect(documentTitle(body, "notes")).toBe("Main title");
    body.innerHTML = "<p>No heading</p><h1>  </h1>";
    expect(documentTitle(body, "notes")).toBe("notes");
  });
});

describe("htmlDocument", () => {
  it("wraps the body in a standalone page with an escaped title and inline styles", () => {
    const html = htmlDocument("a < b & c", "<p>Hi</p>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>a &lt; b &amp; c</title>");
    expect(html).toContain('<article class="markdown-body">\n<p>Hi</p>\n</article>');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).not.toMatch(/<script|<link/);
  });
});

describe("imageType", () => {
  it("maps image extensions to MIME types", () => {
    expect(imageType("/a/b.PNG")).toBe("image/png");
    expect(imageType("/a/b.jpeg")).toBe("image/jpeg");
    expect(imageType("/a/b.svg")).toBe("image/svg+xml");
    expect(imageType("/a/b.txt")).toBeNull();
    expect(imageType("/a.dir/b")).toBeNull();
  });
});
