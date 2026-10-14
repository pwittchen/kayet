// What's New: the GitHub release notes rendered as Markdown, on demand and once after an update.

import { api, ChangelogEntry, safeDecode } from "./api";

export const RELEASES_PAGE = "https://github.com/pwittchen/kayet/releases";

/** Parses `X.Y.Z` (an optional leading `v` is ignored); null for anything else. */
function parseVersion(version: string): [number, number, number] | null {
  const parts = version.trim().replace(/^v/, "").split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Whether `candidate` is a later version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return candidate !== current;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export type ChangelogStartupAction = "show" | "seed" | "none";

/**
 * What startup does about the changelog: `seed` on first run (record the running version
 * without showing anything), `show` once after an upgrade, `none` when already seen. A
 * downgrade re-seeds silently, so the next upgrade shows its notes again.
 */
export function changelogStartupAction(
  lastSeen: string | null | undefined,
  current: string,
): ChangelogStartupAction {
  if (!lastSeen) return "seed";
  if (lastSeen === current) return "none";
  return isNewerVersion(current, lastSeen) ? "show" : "seed";
}

export interface ChangelogCallbacks {
  /** Esc was pressed or the close button used: hide the view. */
  exit: () => void;
}

/**
 * The changelog overlay: one section per release, newest first, each headed by its version
 * and followed by its notes rendered like the preview. It never touches the open document.
 */
export class Changelog {
  private seq = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly body: HTMLElement,
    private readonly cb: ChangelogCallbacks,
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
    this.seq++;
    this.root.hidden = true;
  }

  /** Fetches and shows the changelog, scrolled to `focusVersion` when given. */
  async show(focusVersion?: string): Promise<void> {
    const seq = ++this.seq;
    this.root.hidden = false;
    this.root.focus();
    this.scroller.scrollTop = 0;
    this.body.replaceChildren(this.note("Loading…"));
    let entries: ChangelogEntry[];
    try {
      entries = await api.getChangelog();
    } catch {
      if (seq === this.seq) this.body.replaceChildren(this.notice());
      return;
    }
    if (seq !== this.seq) return;
    if (!entries.length) {
      this.body.replaceChildren(this.notice());
      return;
    }
    const sections = await Promise.all(entries.map((entry) => this.section(entry)));
    if (seq !== this.seq) return;
    this.body.replaceChildren(...sections);
    if (focusVersion) {
      this.body
        .querySelector(`[data-version="${CSS.escape(focusVersion)}"]`)
        ?.scrollIntoView({ block: "start" });
    }
  }

  private async section(entry: ChangelogEntry): Promise<HTMLElement> {
    const section = document.createElement("section");
    section.className = "changelog-entry";
    section.dataset.version = entry.version;
    section.dataset.page = entry.page;
    const heading = document.createElement("h2");
    heading.textContent = entry.version;
    section.append(heading);
    const date = entry.published_at.slice(0, 10);
    if (date) {
      const time = document.createElement("p");
      time.className = "changelog-date";
      time.textContent = date;
      section.append(time);
    }
    // Notes that fail to render fall back to the release page link, like a release without notes.
    const html = entry.body.trim() ? await api.renderMarkdown(entry.body, null).catch(() => null) : null;
    if (html !== null) {
      const notes = document.createElement("div");
      notes.innerHTML = html;
      section.append(notes);
    } else {
      const link = document.createElement("a");
      link.href = entry.page;
      link.textContent = "View this release on GitHub";
      const p = document.createElement("p");
      p.append(link);
      section.append(p);
    }
    return section;
  }

  private note(text: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "changelog-note";
    p.textContent = text;
    return p;
  }

  /** Shown when the notes cannot be fetched (or there are none): a link to the releases page. */
  private notice(): HTMLElement {
    const div = document.createElement("div");
    div.className = "changelog-note";
    const text = document.createElement("p");
    text.textContent = "The release notes couldn't be loaded.";
    const link = document.createElement("a");
    link.href = RELEASES_PAGE;
    link.textContent = "View the releases on GitHub";
    const p = document.createElement("p");
    p.append(link);
    div.append(text, p);
    return div;
  }

  private onClick(e: MouseEvent): void {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    // Every anchor click is intercepted: an unhandled href would navigate the
    // app webview itself, replacing the editor UI.
    e.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const id = safeDecode(href.slice(1));
      this.body.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (!href) return;
    if (/^(https?:|mailto:)/i.test(href)) {
      void api.openExternal(href);
      return;
    }
    // A relative href (rendered with no base, so left as written): resolve it
    // against the owning release's page and open it externally when it lands
    // on http(s)/mailto; any other scheme is ignored.
    const base = link.closest("[data-page]")?.getAttribute("data-page") || RELEASES_PAGE;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.protocol === "http:" || resolved.protocol === "https:" || resolved.protocol === "mailto:") {
      void api.openExternal(resolved.href);
    }
  }
}
