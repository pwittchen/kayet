// About: the app icon, name, version and project links, in a floating panel.

import { api } from "./api";
import iconUrl from "../core/icons/128x128@2x.png";

export interface AboutCallbacks {
  /** Esc was pressed or the close button used: hide the view. */
  exit: () => void;
}

const LINKS: [text: string, href: string][] = [
  ["Website", "https://getkayet.app"],
  ["Source code", "https://github.com/pwittchen/kayet"],
  ["Contributors", "https://github.com/pwittchen/kayet/graphs/contributors"],
];

/**
 * The About panel, centred over the dimmed window; clicking outside closes it. It never
 * touches the open document; links open in the default browser.
 */
export class About {
  constructor(
    private readonly root: HTMLElement,
    private readonly body: HTMLElement,
    private readonly cb: AboutCallbacks,
  ) {
    body.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("click", (e) => {
      if (e.target === root) this.cb.exit();
    });
    document.addEventListener("keydown", (e) => {
      if (this.open && e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        this.cb.exit();
      }
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  show(version: string): void {
    this.body.replaceChildren(...this.content(version));
    this.root.hidden = false;
    this.root.focus();
  }

  private content(version: string): HTMLElement[] {
    const icon = document.createElement("img");
    icon.className = "about-icon";
    icon.src = iconUrl;
    icon.alt = "";
    const name = document.createElement("h3");
    name.className = "about-name";
    name.textContent = "kayet";
    const ver = paragraph(version ? `version ${version}` : "");
    ver.className = "about-version";
    const tagline = paragraph("A minimalistic text editor for macOS.");
    tagline.className = "about-tagline";
    const links = paragraph();
    links.className = "about-links";
    LINKS.forEach(([text, href], i) => {
      if (i > 0) links.append(separator());
      links.append(link(text, href));
    });
    const author = paragraph("Made by Piotr Wittchen", separator(), link("wittchen.io", "https://wittchen.io"));
    author.className = "about-links";
    return [icon, name, ver, tagline, links, author];
  }

  private onClick(e: MouseEvent): void {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    // An unhandled href would navigate the app webview itself, replacing the editor UI.
    e.preventDefault();
    void api.openExternal(anchor.href);
  }
}

function link(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  return a;
}

function separator(): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.textContent = "·";
  return span;
}

function paragraph(...parts: (string | Node)[]): HTMLParagraphElement {
  const p = document.createElement("p");
  p.append(...parts);
  return p;
}
