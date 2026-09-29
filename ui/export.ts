// Markdown export: a self-contained HTML file, or a PDF printed from the web view.

import { convertFileSrc } from "@tauri-apps/api/core";
import { api, dirname, safeDecode } from "./api";
import { useLocalCopies } from "./images";
import markdownCss from "./markdown-body.css?raw";

/** Longest wait for an image to load before the PDF is printed without it. */
const IMAGE_TIMEOUT_MS = 5000;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

/**
 * The app's color tokens used by `markdown-body.css`, for the exported page: light, or dark
 * when the reader's system is (mirrors theme.css).
 */
const PAGE_CSS = `
:root {
  --bg: #ffffff;
  --text: #1d1d1f;
  --text-muted: #8a8a8e;
  --border: #e6e6e8;
  --accent: #0891b2;
  --hl-keyword: #a0469e;
  --hl-string: #3e7d4f;
  --hl-number: #b0602a;
  --hl-title: #3b5bb5;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161618;
    --text: #ededef;
    --text-muted: #8a8a8f;
    --border: #2a2a2e;
    --accent: #22d3ee;
    --hl-keyword: #c792ea;
    --hl-string: #9ccc8c;
    --hl-number: #e3a26f;
    --hl-title: #8fb2f5;
  }
}
:root {
  --code-bg: color-mix(in srgb, var(--text) 4.5%, transparent);
  --hl-comment: var(--text-muted);
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, monospace;
  --editor-font-size: 16px;
  --titlebar-height: 0px;
  background: var(--bg);
}
body {
  margin: 0;
  color: var(--text);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
}
`;

/** Page layout, after `markdown-body.css`, which pads for the app's title bar. */
const LAYOUT_CSS = `
.markdown-body {
  padding: 48px 24px 96px;
}
`;

/** Renders `text` (the Markdown file at `path`) for export, with code blocks highlighted. */
export async function renderForExport(text: string, path: string): Promise<HTMLElement> {
  const body = document.createElement("article");
  body.className = "markdown-body";
  body.innerHTML = await api.renderExport(text, dirname(path));
  const blocks = body.querySelectorAll<HTMLElement>("pre > code[class*='language-']");
  if (blocks.length > 0) (await import("./highlight")).highlightBlocks(blocks);
  await useLocalCopies(body);
  return body;
}

/** The document's first top-level heading, or `fallback`. */
export function documentTitle(body: HTMLElement, fallback: string): string {
  return body.querySelector("h1")?.textContent?.trim() || fallback;
}

/** A standalone HTML page showing `body` (rendered Markdown) with the preview's typography. */
export function htmlDocument(title: string, body: string): string {
  const escaped = title.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="kayet">
<title>${escaped}</title>
<style>${PAGE_CSS}
${markdownCss}${LAYOUT_CSS}</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>
`;
}

/** Local images (absolute paths, as the renderer resolves them, or downloaded copies) in `body`. */
function localImages(body: HTMLElement): HTMLImageElement[] {
  return [...body.querySelectorAll("img")].filter((img) => img.getAttribute("src")?.startsWith("/"));
}

/** MIME type of an image file, by extension. */
export function imageType(path: string): string | null {
  const ext = /\.([^./]+)$/.exec(path)?.[1].toLowerCase();
  return (ext && IMAGE_TYPES[ext]) || null;
}

function dataUrl(bytes: ArrayBuffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
}

/**
 * Embeds local images (and the downloaded copies of web images) as data URLs so the page
 * works anywhere. Images that cannot be read (missing, too large) link to the file instead.
 */
async function embedImages(body: HTMLElement): Promise<void> {
  await Promise.all(
    localImages(body).map(async (img) => {
      const src = img.getAttribute("src")!;
      const path = safeDecode(src);
      const type = imageType(path);
      try {
        if (!type) throw new Error("not an image");
        img.src = await dataUrl(await api.readImage(path), type);
      } catch {
        img.src = `file://${src}`;
      }
    }),
  );
}

/** Writes `text` (the Markdown file at `path`) as a standalone HTML page to `out`. */
export async function exportHtml(text: string, path: string, out: string, fallbackTitle: string): Promise<void> {
  const body = await renderForExport(text, path);
  await embedImages(body);
  await api.writeFile(out, htmlDocument(documentTitle(body, fallbackTitle), body.innerHTML));
}

function loaded(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    window.setTimeout(done, IMAGE_TIMEOUT_MS);
  });
}

/**
 * Prints `text` (the Markdown file at `path`) into a PDF at `out`. The document is shown in
 * `host` (visible only to the print stylesheet) while it prints.
 */
export async function exportPdf(text: string, path: string, out: string, host: HTMLElement): Promise<void> {
  const body = await renderForExport(text, path);
  for (const img of localImages(body)) img.src = convertFileSrc(safeDecode(img.getAttribute("src")!));
  host.replaceChildren(body);
  try {
    await Promise.all([...body.querySelectorAll("img")].map(loaded));
    await api.exportPdf(out);
  } finally {
    host.replaceChildren();
  }
}
