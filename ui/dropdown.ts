// A dropdown drawn like kayet's own controls: a field-like button and a floating list styled
// like the command palette (in place of the native <select> and its system popup menu).

export type DropdownOption = [value: string, label: string];

export class Dropdown {
  /** The button that shows the current choice and opens the list. */
  readonly el: HTMLButtonElement;
  private list: HTMLUListElement | null = null;
  private highlighted = 0;
  private current = "";
  private readonly close = () => this.hide();
  /** Scrolling underneath (the Settings panel) would leave the list behind; its own scrolling doesn't. */
  private readonly scrolled = (e: Event) => {
    if (e.target !== this.list) this.hide();
  };
  private readonly outside = (e: PointerEvent) => {
    if (!this.list?.contains(e.target as Node) && e.target !== this.el) this.hide();
  };

  constructor(
    private options: DropdownOption[],
    private readonly onChange: (value: string) => void,
  ) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "dropdown";
    this.el.setAttribute("aria-haspopup", "listbox");
    this.el.setAttribute("aria-expanded", "false");
    this.el.addEventListener("click", () => (this.list ? this.hide() : this.show()));
    this.el.addEventListener("keydown", (e) => {
      if (this.list || !["ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      this.show();
    });
  }

  get open(): boolean {
    return this.list !== null;
  }

  get value(): string {
    return this.current;
  }

  /** Shows `value` as the choice; one not among the options is added (e.g. a missing theme). */
  set value(value: string) {
    if (!this.options.some(([v]) => v === value)) this.options = [...this.options, [value, value]];
    this.current = value;
    this.el.dataset.value = value;
    this.el.textContent = this.options.find(([v]) => v === value)![1];
  }

  get disabled(): boolean {
    return this.el.disabled;
  }

  set disabled(disabled: boolean) {
    this.el.disabled = disabled;
    if (disabled) this.hide();
  }

  show(): void {
    if (this.list || this.el.disabled) return;
    const list = document.createElement("ul");
    list.className = "dropdown-list";
    list.setAttribute("role", "listbox");
    list.tabIndex = -1;
    this.highlighted = Math.max(
      0,
      this.options.findIndex(([v]) => v === this.current),
    );
    this.options.forEach(([value, label], i) => {
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      item.textContent = label;
      item.setAttribute("aria-checked", String(value === this.current));
      item.addEventListener("pointermove", () => this.highlight(i));
      item.addEventListener("click", () => this.pick(i));
      list.append(item);
    });
    list.addEventListener("keydown", (e) => this.onKey(e));
    list.addEventListener("focusout", (e) => {
      if (!list.contains(e.relatedTarget as Node | null)) this.hide();
    });
    document.body.append(list);
    this.list = list;
    this.place(list);
    this.highlight(this.highlighted);
    this.el.setAttribute("aria-expanded", "true");
    list.focus();
    document.addEventListener("pointerdown", this.outside, true);
    window.addEventListener("resize", this.close);
    document.addEventListener("scroll", this.scrolled, true);
  }

  hide(): void {
    const list = this.list;
    if (!list) return;
    this.list = null;
    document.removeEventListener("pointerdown", this.outside, true);
    window.removeEventListener("resize", this.close);
    document.removeEventListener("scroll", this.scrolled, true);
    this.el.setAttribute("aria-expanded", "false");
    const focused = list.contains(document.activeElement);
    list.remove();
    if (focused) this.el.focus();
  }

  /** Below the button (above it if there is no room), at least as wide as it. */
  private place(list: HTMLUListElement): void {
    const box = this.el.getBoundingClientRect();
    list.style.minWidth = `${box.width}px`;
    list.style.left = `${box.left}px`;
    const below = window.innerHeight - box.bottom;
    if (below < Math.min(list.offsetHeight, 240) + 8 && box.top > below) {
      list.style.bottom = `${window.innerHeight - box.top + 4}px`;
      list.style.maxHeight = `${box.top - 12}px`;
    } else {
      list.style.top = `${box.bottom + 4}px`;
      list.style.maxHeight = `${below - 12}px`;
    }
  }

  private highlight(i: number): void {
    const items = this.list?.children;
    if (!items?.length) return;
    this.highlighted = (i + items.length) % items.length;
    [...items].forEach((item, n) => item.setAttribute("aria-selected", String(n === this.highlighted)));
    items[this.highlighted].scrollIntoView?.({ block: "nearest" });
  }

  private pick(i: number): void {
    const [value] = this.options[i];
    this.hide();
    this.el.focus();
    if (value === this.current) return;
    this.value = value;
    this.onChange(value);
  }

  private onKey(e: KeyboardEvent): void {
    const keys: Record<string, () => void> = {
      ArrowDown: () => this.highlight(this.highlighted + 1),
      ArrowUp: () => this.highlight(this.highlighted - 1),
      Home: () => this.highlight(0),
      End: () => this.highlight(this.options.length - 1),
      Enter: () => this.pick(this.highlighted),
      " ": () => this.pick(this.highlighted),
      // Taken here, so the Settings panel underneath stays open.
      Escape: () => this.hide(),
      Tab: () => this.hide(),
    };
    const action = keys[e.key];
    if (!action) return;
    if (e.key !== "Tab") e.preventDefault();
    e.stopPropagation();
    action();
  }
}
