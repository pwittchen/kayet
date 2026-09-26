// File tree: lazy directory loading, keyboard navigation, inline create/rename, context menu.

import { api, basename, dirname, Entry, isWithin, join } from "./api";
import { icons } from "./icons";

export interface TreeCallbacks {
  openFile: (path: string) => void;
  /** Called after an entry was renamed/moved, so an open document can follow it. */
  renamed: (from: string, to: string) => void;
  /** Called after an entry was moved to the Trash. */
  trashed: (path: string) => void;
  notify: (message: string) => void;
}

type Editing =
  | { kind: "new-file" | "new-folder"; dir: string }
  | { kind: "rename"; path: string };

interface Row {
  entry: Entry;
  depth: number;
}

export class FileTree {
  private root = "";
  private readonly children = new Map<string, Entry[]>();
  private readonly expanded = new Set<string>();
  private rows: Row[] = [];
  private selected: string | null = null;
  private active: string | null = null;
  private editing: Editing | null = null;
  private menuTarget: Entry | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly cb: TreeCallbacks,
  ) {
    el.addEventListener("keydown", (e) => this.onKeyDown(e));
    el.addEventListener("contextmenu", (e) => this.onContextMenu(e));
  }

  async setRoot(root: string): Promise<void> {
    this.root = root;
    this.children.clear();
    this.expanded.clear();
    this.selected = null;
    this.editing = null;
    await this.load(root);
    this.render();
  }

  setActive(path: string | null): void {
    this.active = path;
    if (path) {
      // Reveal the active file by expanding its ancestors (loaded lazily).
      void this.revealPath(path);
    } else {
      this.render();
    }
  }

  /** Re-lists every loaded directory (called on file system changes). */
  async refresh(): Promise<void> {
    if (!this.root) return;
    const dirs = [...this.children.keys()];
    await Promise.all(
      dirs.map(async (dir) => {
        try {
          this.children.set(dir, await api.listDir(dir));
        } catch {
          this.children.delete(dir);
          this.expanded.delete(dir);
        }
      }),
    );
    this.render();
  }

  focus(): void {
    this.el.focus();
  }

  private async load(dir: string): Promise<void> {
    try {
      this.children.set(dir, await api.listDir(dir));
    } catch (e) {
      this.children.set(dir, []);
      if (dir === this.root) this.cb.notify(String(e));
    }
  }

  private async revealPath(path: string): Promise<void> {
    if (!isWithin(this.root, path)) return this.render();
    const ancestors: string[] = [];
    for (let d = dirname(path); d !== this.root && isWithin(this.root, d); d = dirname(d)) {
      ancestors.unshift(d);
    }
    for (const dir of ancestors) {
      this.expanded.add(dir);
      if (!this.children.has(dir)) await this.load(dir);
    }
    this.selected = path;
    this.render();
    this.el.querySelector(".tree-row.active")?.scrollIntoView({ block: "nearest" });
  }

  private async toggle(dir: string, open?: boolean): Promise<void> {
    const willOpen = open ?? !this.expanded.has(dir);
    if (willOpen) {
      this.expanded.add(dir);
      if (!this.children.has(dir)) await this.load(dir);
    } else {
      this.expanded.delete(dir);
    }
    this.render();
  }

  // ---- rendering ----

  private render(): void {
    const frag = document.createDocumentFragment();
    const header = document.createElement("div");
    header.className = "tree-header";
    header.textContent = basename(this.root) || this.root;
    header.title = this.root;
    frag.append(header);

    this.rows = [];
    const list = document.createElement("div");
    list.className = "tree-list";
    list.setAttribute("role", "tree");
    this.renderDir(this.root, 0, list);
    frag.append(list);

    this.el.replaceChildren(frag);
    const input = this.el.querySelector<HTMLInputElement>("input.tree-input");
    if (input) {
      input.focus();
      const dot = input.value.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 && this.editing?.kind === "rename" ? dot : input.value.length);
    }
  }

  private renderDir(dir: string, depth: number, into: HTMLElement): void {
    if (this.editing && this.editing.kind !== "rename" && this.editing.dir === dir) {
      into.append(this.inputRow(depth, "", this.editing.kind === "new-folder"));
    }
    for (const entry of this.children.get(dir) ?? []) {
      if (this.editing?.kind === "rename" && this.editing.path === entry.path) {
        into.append(this.inputRow(depth, entry.name, entry.is_dir));
      } else {
        into.append(this.row(entry, depth));
      }
      this.rows.push({ entry, depth });
      if (entry.is_dir && this.expanded.has(entry.path)) {
        this.renderDir(entry.path, depth + 1, into);
      }
    }
  }

  private row(entry: Entry, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.setAttribute("role", "treeitem");
    row.dataset.path = entry.path;
    row.style.setProperty("--depth", String(depth));
    if (entry.is_dir) {
      row.classList.add("dir");
      row.setAttribute("aria-expanded", String(this.expanded.has(entry.path)));
    }
    if (entry.path === this.active) row.classList.add("active");
    if (entry.path === this.selected) row.classList.add("selected");

    const chevron = document.createElement("span");
    chevron.className = "chevron";
    if (entry.is_dir) chevron.innerHTML = icons.chevron;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = entry.name;
    row.append(chevron, name);

    if (!entry.is_dir) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.title = "Move to Trash";
      remove.setAttribute("aria-label", `Move ${entry.name} to Trash`);
      remove.innerHTML = icons.close;
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.confirmAndTrash(entry);
      });
      row.append(remove);
    }

    row.addEventListener("click", () => {
      this.selected = entry.path;
      if (entry.is_dir) void this.toggle(entry.path);
      else {
        this.cb.openFile(entry.path);
        this.render();
      }
    });
    return row;
  }

  private inputRow(depth: number, value: string, isDir: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "tree-row editing" + (isDir ? " dir" : "");
    row.style.setProperty("--depth", String(depth));
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    const input = document.createElement("input");
    input.className = "tree-input";
    input.value = value;
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void this.commitEdit(input.value);
      else if (e.key === "Escape") this.cancelEdit();
    });
    input.addEventListener("blur", () => {
      if (this.editing) void this.commitEdit(input.value);
    });
    row.append(chevron, input);
    return row;
  }

  // ---- create / rename / trash ----

  private startEdit(editing: Editing): void {
    this.editing = editing;
    if (editing.kind !== "rename" && editing.dir !== this.root) {
      void this.toggle(editing.dir, true);
    } else {
      this.render();
    }
  }

  private cancelEdit(): void {
    this.editing = null;
    this.render();
    this.el.focus();
  }

  private async commitEdit(raw: string): Promise<void> {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const name = raw.trim();
    if (!name || name.includes("/")) {
      if (name.includes("/")) this.cb.notify("Names cannot contain “/”.");
      this.render();
      return;
    }
    try {
      if (editing.kind === "rename") {
        if (name !== basename(editing.path)) {
          const to = await api.rename(editing.path, join(dirname(editing.path), name));
          this.cb.renamed(editing.path, to);
          this.selected = to;
        }
      } else if (editing.kind === "new-folder") {
        const path = await api.createDir(join(editing.dir, name));
        this.selected = path;
      } else {
        const path = await api.createFile(join(editing.dir, name));
        this.selected = path;
        this.cb.openFile(path);
      }
    } catch (e) {
      this.cb.notify(String(e));
    }
    await this.refresh();
    this.el.focus();
  }

  private async trash(entry: Entry): Promise<void> {
    try {
      await api.trash(entry.path);
      this.cb.trashed(entry.path);
    } catch (e) {
      this.cb.notify(String(e));
    }
    await this.refresh();
  }

  private async confirmAndTrash(entry: Entry): Promise<void> {
    if (await api.confirmTrash(entry.name)) await this.trash(entry);
  }

  // ---- context menu ----

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
    const path = rowEl?.dataset.path;
    const entry = path ? this.rows.find((r) => r.entry.path === path)?.entry ?? null : null;
    this.menuTarget = entry;
    if (entry) {
      this.selected = entry.path;
      this.render();
    }
    const items = [
      { id: "ctx:new-file", label: "New File" },
      { id: "ctx:new-folder", label: "New Folder" },
    ];
    const entryItems = entry
      ? [
          { id: null },
          { id: "ctx:rename", label: "Rename" },
          { id: "ctx:reveal", label: "Reveal in Finder" },
          { id: null },
          { id: "ctx:trash", label: "Move to Trash" },
        ]
      : [{ id: null }, { id: "ctx:reveal", label: "Reveal in Finder" }];
    void api.showContextMenu([...items, ...entryItems]);
  }

  /** Handles a `ctx:*` menu event; returns true if it was ours. */
  handleMenu(id: string): boolean {
    if (!id.startsWith("ctx:")) return false;
    const target = this.menuTarget;
    const targetDir = !target ? this.root : target.is_dir ? target.path : dirname(target.path);
    switch (id) {
      case "ctx:new-file":
        this.startEdit({ kind: "new-file", dir: targetDir });
        break;
      case "ctx:new-folder":
        this.startEdit({ kind: "new-folder", dir: targetDir });
        break;
      case "ctx:rename":
        if (target) this.startEdit({ kind: "rename", path: target.path });
        break;
      case "ctx:reveal":
        void api.reveal(target?.path ?? this.root).catch((e) => this.cb.notify(String(e)));
        break;
      case "ctx:trash":
        if (target) void this.trash(target);
        break;
    }
    return true;
  }

  // ---- keyboard ----

  private onKeyDown(e: KeyboardEvent): void {
    if (this.editing) return;
    const index = this.rows.findIndex((r) => r.entry.path === this.selected);
    const current = index >= 0 ? this.rows[index] : null;
    const select = (i: number) => {
      const row = this.rows[Math.max(0, Math.min(this.rows.length - 1, i))];
      if (!row) return;
      this.selected = row.entry.path;
      this.render();
      this.el.querySelector(".tree-row.selected")?.scrollIntoView({ block: "nearest" });
    };

    switch (e.key) {
      case "ArrowDown":
        select(index + 1);
        break;
      case "ArrowUp":
        select(index < 0 ? this.rows.length - 1 : index - 1);
        break;
      case "ArrowRight":
        if (current?.entry.is_dir) {
          if (!this.expanded.has(current.entry.path)) void this.toggle(current.entry.path, true);
          else select(index + 1);
        }
        break;
      case "ArrowLeft":
        if (current?.entry.is_dir && this.expanded.has(current.entry.path)) {
          void this.toggle(current.entry.path, false);
        } else if (current) {
          const parent = this.rows.findIndex((r) => r.entry.path === dirname(current.entry.path));
          if (parent >= 0) select(parent);
        }
        break;
      case "Enter":
        if (current?.entry.is_dir) void this.toggle(current.entry.path);
        else if (current) this.cb.openFile(current.entry.path);
        break;
      case "Backspace":
        if (e.metaKey && current) void this.trash(current.entry);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
