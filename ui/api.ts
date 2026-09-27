// Typed wrappers around the Rust commands (see core/src/commands.rs).

import { invoke } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";

export interface Config {
  workspace: { path: string; show_hidden_files: boolean };
  ui: {
    theme: ThemeMode;
    sidebar_visible: boolean;
    titlebar_pinned: boolean;
    zen_mode: boolean;
    sidebar_width: number;
    preview_split: number;
  };
  editor: {
    font_family: "system" | "mono";
    font_size: number;
    line_height: number;
    soft_wrap: boolean;
    max_line_width: number;
    autosave: boolean;
    syntax_highlighting: boolean;
    cursor: "blink" | "steady";
  };
  window: { width: number; height: number; x: number; y: number };
  session: { last_file?: string | null };
}

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** A file and/or folder kayet was asked to open from Finder or the `kayet` command. */
/** A line containing the searched text; columns and ranges count UTF-16 code units. */
export interface SearchMatch {
  path: string;
  /** 1-based line number. */
  line: number;
  column: number;
  length: number;
  /** The line, or an excerpt of it around the match. */
  text: string;
  /** The match within `text`. */
  start: number;
  end: number;
}

export interface Opened {
  file: string | null;
  folder: string | null;
}

/** An unsaved buffer backed up for crash recovery; `path: null` means untitled. */
export interface Backup {
  path: string | null;
  text: string;
}

/** A context menu item; `id: null` renders a separator. */
export interface MenuItemSpec {
  id: string | null;
  label?: string;
}

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  setConfig: (cfg: Config) => invoke<void>("set_config", { cfg }),
  configFile: () => invoke<string>("config_file"),
  reloadConfig: () => invoke<Config>("reload_config"),
  getWorkspace: () => invoke<string>("get_workspace"),
  setWorkspace: (path: string) => invoke<string>("set_workspace", { path }),
  resetWorkspace: () => invoke<string>("reset_workspace"),
  pickWorkspace: () => invoke<string | null>("pick_workspace"),
  takeNotice: () => invoke<string | null>("take_notice"),
  takeOpened: () => invoke<Opened>("take_opened"),
  installCli: () => invoke<string | null>("install_cli"),
  listDir: (path: string) => invoke<Entry[]>("list_dir", { path }),
  listFiles: () => invoke<string[]>("list_files"),
  searchWorkspace: (query: string) => invoke<SearchMatch[]>("search_workspace", { query }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, contents: string) =>
    invoke<void>("write_file", { path, contents }),
  /** Saves image bytes next to `document`; returns the new file's name. */
  saveImage: (document: string, extension: string, bytes: Uint8Array) =>
    invoke<string>("save_image", bytes, {
      headers: {
        "kayet-document": encodeURIComponent(document),
        "kayet-extension": encodeURIComponent(extension),
      },
    }),
  writeRecovery: (path: string | null, contents: string) =>
    invoke<void>("write_recovery", { path, contents }),
  clearRecovery: () => invoke<void>("clear_recovery"),
  loadRecovery: () => invoke<Backup | null>("load_recovery"),
  createFile: (path: string) => invoke<string>("create_file", { path }),
  createDir: (path: string) => invoke<string>("create_dir", { path }),
  rename: (from: string, to: string) => invoke<string>("rename", { from, to }),
  trash: (path: string) => invoke<void>("trash", { path }),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  renderMarkdown: (text: string, base: string | null) =>
    invoke<string>("render_markdown", { text, base }),
  setChromeVisible: (visible: boolean) =>
    invoke<void>("set_chrome_visible", { visible }),
  setSyntaxMenu: (enabled: boolean, checked: boolean) =>
    invoke<void>("set_syntax_menu", { enabled, checked }),
  openFileDialog: () => invoke<string | null>("open_file_dialog"),
  saveFileDialog: (directory: string | null, fileName: string) =>
    invoke<string | null>("save_file_dialog", { directory, fileName }),
  confirmUnsaved: (name: string) =>
    invoke<"save" | "discard" | "cancel">("confirm_unsaved", { name }),
  confirmSave: (name: string) => invoke<boolean>("confirm_save", { name }),
  confirmRestore: (name: string) =>
    invoke<boolean>("confirm_restore", { name }),
  confirmTrash: (name: string) => invoke<boolean>("confirm_trash", { name }),
  showContextMenu: (items: MenuItemSpec[]) =>
    invoke<void>("show_context_menu", { items }),
  benchDir: () => invoke<string | null>("bench_dir"),
  benchReport: (report: unknown) => invoke<void>("bench_report", { report }),
};

// ---- path helpers (POSIX-style; macOS is the primary target) ----

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function join(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

export function isMarkdown(path: string | null): boolean {
  return !!path && /\.(md|markdown)$/i.test(path);
}

/** `path` relative to `root`, or null if it is not inside it. */
export function relativeTo(root: string, path: string): string | null {
  if (path === root) return "";
  const prefix = root.endsWith("/") ? root : root + "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** Whether `path` is `ancestor` itself or lies inside it. */
export function isWithin(ancestor: string, path: string): boolean {
  return relativeTo(ancestor, path) !== null;
}
