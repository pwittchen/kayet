// About: the app icon, name, version and project links, shown like What's New.

import { api } from "./api";
import iconUrl from "../core/icons/128x128@2x.png";

export interface AboutCallbacks {
  /** Esc was pressed or the close button used: hide the view. */
  exit: () => void;
}

const LINKS: [text: string, href: string][] = [
  ["getkayet.app", "https://getkayet.app"],
  ["Source code on GitHub", "https://github.com/pwittchen/kayet"],
];

/** The About overlay. It never touches the open document; links open in the default browser. */
export class About {
  constructor(
    private readonly root: HTMLElement,
    private readonly body: HTMLElement,
    private readonly cb: AboutCallbacks,
  ) {
    body.addEventListener("click", (e) => this.onClick(e));
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
    const name = document.createElement("h2");
    name.textContent = "kayet";
    const ver = document.createElement("p");
    ver.className = "about-version";
    ver.textContent = version ? `version ${version}` : "";
    const links = LINKS.map(([text, href]) => paragraph(link(text, href)));
    const author = paragraph("Made by Piotr Wittchen (", link("wittchen.io", "https://wittchen.io"), ")");
    const contributors = paragraph(
      "and ",
      link("open-source contributors", "https://github.com/pwittchen/kayet/graphs/contributors"),
    );
    return [icon, name, ver, ...links, author, contributors];
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

function paragraph(...parts: (string | Node)[]): HTMLParagraphElement {
  const p = document.createElement("p");
  p.append(...parts);
  return p;
}
