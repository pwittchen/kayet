// Spotlight-like palette: type to filter, ↑/↓ to move, Enter to pick, Esc to close.
// Lists commands (⌘K), workspace files (⌘P, the file finder) or search results (⌘⇧F).

export interface PaletteItem {
  id: string;
  label: string;
  /** Muted text after the label, e.g. the folder of a file. */
  detail?: string;
  /** Muted text on the right, e.g. where a search result is. */
  aside?: string;
  shortcut?: string;
  /** Range of the label to highlight, e.g. the text a search matched. */
  match?: [number, number];
}

export interface PaletteOptions {
  /** What the palette lists, e.g. "commands" or "files" (see `Palette.showing`). */
  kind: string;
  placeholder: string;
  /** Shown when nothing matches the query. */
  empty: string;
  /** Called with the picked item's id. */
  pick: (id: string) => void;
  /** Ranks an item against the lower-cased query; 0 means no match. Defaults to the label. */
  rank?: (item: PaletteItem, query: string) => number;
  /**
   * Looks items up for the (trimmed, original-case) query instead of filtering the given ones,
   * shortly after typing pauses. `empty` is then shown only for a query without results.
   */
  search?: (query: string) => Promise<PaletteItem[]>;
  /** Shown while the query is empty, in search mode. */
  prompt?: string;
  /** Initially selected item index; defaults to 0. */
  selected?: number;
}

/** Typing pause after which a search runs. */
const SEARCH_DELAY = 150;

/** At most this many items are shown, so long file lists stay quick to filter. */
const MAX_SHOWN = 100;

export class Palette {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private items: PaletteItem[] = [];
  private options: PaletteOptions | null = null;
  private matches: PaletteItem[] = [];
  private selected = 0;
  private closed: Promise<void> = Promise.resolve();
  private done: (() => void) | null = null;
  private searchTimer: number | undefined;
  /** Bumped by each search and by `open`, so stale results are dropped. */
  private searchId = 0;

  constructor(private readonly onClose: () => void) {
    this.root = document.createElement("div");
    this.root.id = "palette";
    this.root.hidden = true;
    this.root.innerHTML =
      `<div class="palette-box" role="dialog" aria-label="Command palette">` +
      `<input type="text" spellcheck="false" autocomplete="off"` +
      ` role="combobox" aria-controls="palette-list" aria-expanded="true" />` +
      `<ul id="palette-list" role="listbox"></ul>` +
      `</div>`;
    this.input = this.root.querySelector("input")!;
    this.list = this.root.querySelector("ul")!;
    document.body.append(this.root);

    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.input.addEventListener("blur", () => this.close());
    // Keep focus in the input while clicking items.
    this.list.addEventListener("mousedown", (e) => e.preventDefault());
    this.list.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest("li");
      if (item) this.pick(Number(item.dataset.index));
    });
    this.list.addEventListener("mousemove", (e) => {
      const item = (e.target as HTMLElement).closest("li");
      if (item) this.select(Number(item.dataset.index), false);
    });
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The `kind` of what the open palette lists, or null while it is closed. */
  get showing(): string | null {
    return this.isOpen ? (this.options?.kind ?? null) : null;
  }

  /**
   * Shows the palette with `items`, or switches it to them if it is already open.
   * The returned promise resolves once it closes.
   */
  open(items: PaletteItem[], options: PaletteOptions): Promise<void> {
    this.items = items;
    this.options = options;
    this.input.placeholder = options.placeholder;
    this.root.querySelector(".palette-box")!.setAttribute("aria-label", options.placeholder);
    this.input.value = "";
    this.searchId++;
    window.clearTimeout(this.searchTimer);
    if (!this.isOpen) {
      this.root.hidden = false;
      this.closed = new Promise((resolve) => (this.done = resolve));
    }
    this.filter();
    if (options.selected !== undefined) this.select(options.selected);
    this.input.focus();
    return this.closed;
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.searchId++;
    window.clearTimeout(this.searchTimer);
    this.done?.();
    this.done = null;
    this.onClose();
  }

  private pick(index: number): void {
    const item = this.matches[index];
    const pick = this.options?.pick;
    if (!item || !pick) return;
    this.close();
    pick(item.id);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const n = this.matches.length;
    switch (e.key) {
      case "ArrowDown":
        if (n) this.select((this.selected + 1) % n);
        break;
      case "ArrowUp":
        if (n) this.select((this.selected - 1 + n) % n);
        break;
      case "Home":
        if (n) this.select(0);
        break;
      case "End":
        if (n) this.select(n - 1);
        break;
      case "Enter":
        this.pick(this.selected);
        break;
      case "Escape":
        this.close();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private onInput(): void {
    const search = this.options?.search;
    if (!search) return this.filter();
    window.clearTimeout(this.searchTimer);
    const id = ++this.searchId;
    const query = this.input.value.trim();
    if (!query) {
      this.items = [];
      return this.filter();
    }
    this.searchTimer = window.setTimeout(() => {
      search(query).then(
        (items) => {
          if (id !== this.searchId) return;
          this.items = items;
          this.filter();
        },
        () => {
          if (id !== this.searchId) return;
          this.items = [];
          this.filter();
        },
      );
    }, SEARCH_DELAY);
  }

  private filter(): void {
    const query = this.input.value.trim().toLowerCase();
    const rank = this.options?.rank ?? ((item: PaletteItem, q: string) => score(item.label.toLowerCase(), q));
    this.matches = (
      query && !this.options?.search
        ? this.items
            .map((item) => ({ item, score: rank(item, query) }))
            .filter((m) => m.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((m) => m.item)
        : this.items
    ).slice(0, MAX_SHOWN);
    this.list.replaceChildren(
      ...this.matches.map((c, i) => {
        const li = document.createElement("li");
        li.id = `palette-item-${i}`;
        li.role = "option";
        li.dataset.index = String(i);
        const label = document.createElement("span");
        label.className = "label";
        if (c.match) {
          const [from, to] = c.match;
          const mark = document.createElement("mark");
          mark.textContent = c.label.slice(from, to);
          label.append(c.label.slice(0, from), mark, c.label.slice(to));
        } else {
          label.textContent = c.label;
        }
        if (c.detail) {
          const detail = document.createElement("span");
          detail.className = "detail";
          detail.textContent = c.detail;
          label.append(detail);
        }
        li.append(label);
        if (c.aside) {
          const aside = document.createElement("span");
          aside.className = "aside";
          aside.textContent = c.aside;
          li.append(aside);
        }
        if (c.shortcut) {
          const kbd = document.createElement("kbd");
          kbd.textContent = c.shortcut;
          li.append(kbd);
        }
        return li;
      }),
    );
    if (!this.matches.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      const prompt = this.options?.search && !query ? this.options.prompt : undefined;
      empty.textContent = prompt ?? this.options?.empty ?? "";
      this.list.append(empty);
    }
    this.select(0);
  }

  private select(index: number, scroll = true): void {
    this.list.querySelector("[aria-selected=true]")?.setAttribute("aria-selected", "false");
    this.selected = index;
    const item = this.list.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!item) return this.input.removeAttribute("aria-activedescendant");
    item.setAttribute("aria-selected", "true");
    this.input.setAttribute("aria-activedescendant", item.id);
    if (scroll) item.scrollIntoView({ block: "nearest" });
  }
}

/**
 * Ranks how well `query` matches `label` (both lower-cased); 0 means no match.
 * Substrings win, word prefixes beat mid-word hits, then any in-order subsequence.
 */
export function score(label: string, query: string): number {
  const at = label.indexOf(query);
  if (at === 0) return 4;
  if (at > 0) return /[\s/._-]/.test(label[at - 1]) ? 3 : 2;
  let i = 0;
  for (const ch of label) if (ch === query[i]) i++;
  return i === query.length ? 1 : 0;
}

/**
 * Ranks a file by its workspace-relative `path` (lower-cased) against the lower-cased query.
 * Matches in the file name beat matches elsewhere in the path; a query with a `/` is
 * matched against the whole path. Spaces in the query are ignored. Among equal matches,
 * shorter names and paths come first.
 */
export function fileScore(path: string, query: string): number {
  const q = query.replace(/\s+/g, "");
  if (!q) return 1;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const inName = q.includes("/") ? 0 : score(name, q);
  const s = inName ? inName + 4 : score(path, q);
  // The tie-breaker stays below 1, so it never outweighs a better match.
  return s ? s + 1 / (2 + name.length + path.length / 1000) : 0;
}
