// Web images: shown from local copies the backend downloads into ~/.kayet/cache/images/.

import { api } from "./api";

/** How long a failed download is remembered before it is tried again. */
const RETRY_MS = 60_000;

const downloads = new Map<string, Promise<string>>();
const copies = new Map<string, string>();

export function isWebImage(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** The local copy of the web image at `url`, if it is already known. */
export function knownCopy(url: string): string | undefined {
  return copies.get(url);
}

/** The path of the local copy of the web image at `url` (downloaded once per URL). */
export function localCopy(url: string): Promise<string> {
  let download = downloads.get(url);
  if (!download) {
    download = api.cacheImage(url).then((path) => {
      copies.set(url, path);
      return path;
    });
    download.catch(() => window.setTimeout(() => downloads.delete(url), RETRY_MS));
    downloads.set(url, download);
  }
  return download;
}

/**
 * Points the web images in `body` at their local copies, written like local images (absolute,
 * percent-encoded paths). Images that can't be downloaded keep their URL.
 */
export async function useLocalCopies(body: HTMLElement): Promise<void> {
  await Promise.all(
    [...body.querySelectorAll("img")].map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!isWebImage(src)) return;
      try {
        img.setAttribute("src", encodeURI(await localCopy(src)));
      } catch {
        // Left pointing at the web.
      }
    }),
  );
}
