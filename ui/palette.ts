// Spotlight-like command palette (⌘K): type to filter, ↑/↓ to move, Enter to run, Esc to close.

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
}

export class Palette {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private commands: PaletteCommand[] = [];
  private matches: PaletteCommand[] = [];
  private selected = 0;
  private done: (() => void) | null = null;

  constructor(
    private readonly run: (id: string) => void,
    private readonly onClose: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "palette";
    this.root.hidden = true;
    this.root.innerHTML =
      `<div class="palette-box" role="dialog" aria-label="Command palette">` +
      `<input type="text" placeholder="Type a command…" spellcheck="false" autocomplete="off"` +
      ` role="combobox" aria-controls="palette-list" aria-expanded="true" />` +
      `<ul id="palette-list" role="listbox"></ul>` +
      `</div>`;
    this.input = this.root.querySelector("input")!;
    this.list = this.root.querySelector("ul")!;
    document.body.append(this.root);

    this.input.addEventListener("input", () => this.filter());
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

  /** Shows the palette; the returned promise resolves once it closes. */
  open(commands: PaletteCommand[]): Promise<void> {
    if (this.isOpen) {
      this.input.select();
      return Promise.resolve();
    }
    this.commands = commands;
    this.input.value = "";
    this.root.hidden = false;
    this.filter();
    this.input.focus();
    return new Promise((resolve) => (this.done = resolve));
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.done?.();
    this.done = null;
    this.onClose();
  }

  private pick(index: number): void {
    const command = this.matches[index];
    if (!command) return;
    this.close();
    this.run(command.id);
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

  private filter(): void {
    const query = this.input.value.trim().toLowerCase();
    this.matches = query
      ? this.commands
          .map((c) => ({ c, score: score(c.label.toLowerCase(), query) }))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((m) => m.c)
      : this.commands;
    this.list.replaceChildren(
      ...this.matches.map((c, i) => {
        const li = document.createElement("li");
        li.id = `palette-item-${i}`;
        li.role = "option";
        li.dataset.index = String(i);
        const label = document.createElement("span");
        label.textContent = c.label;
        li.append(label);
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
      empty.textContent = "No matching commands";
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
function score(label: string, query: string): number {
  const at = label.indexOf(query);
  if (at === 0) return 4;
  if (at > 0) return label[at - 1] === " " ? 3 : 2;
  let i = 0;
  for (const ch of label) if (ch === query[i]) i++;
  return i === query.length ? 1 : 0;
}
