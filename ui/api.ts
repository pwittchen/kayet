// Typed wrappers around the Rust commands (see core/src/commands.rs).

import { invoke } from "@tauri-apps/api/core";

export type Mode = "system" | "light" | "dark";

export interface Config {
  workspace: { path: string; show_hidden_files: boolean };
  ui: {
    theme: string;
    mode: Mode;
    sidebar_visible: boolean;
    titlebar_pinned: boolean;
    zen_mode: boolean;
    code_mode: boolean;
    sidebar_width: number;
    preview_split: number;
    open_in_new_tab: boolean;
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
    spell_check: boolean;
  };
  window: { width: number; height: number; x: number; y: number };
  updates: { check_automatically: boolean };
  session: {
    last_file?: string | null;
    open_files?: string[];
    recent_files?: string[];
    skipped_version?: string | null;
  };
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

/** A theme from `~/.kayet/themes/<name>.toml`: CSS token values per variant. */
export interface ThemeFile {
  light: Record<string, string>;
  dark: Record<string, string>;
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

/** Keeps a byte order mark, so saving writes it back. */
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  setConfig: (cfg: Config) => invoke<void>("set_config", { cfg }),
  configFile: () => invoke<string>("config_file"),
  reloadConfig: () => invoke<Config>("reload_config"),
  getTheme: (name: string) => invoke<ThemeFile>("get_theme", { name }),
  listThemes: () => invoke<string[]>("list_themes"),
  systemAppearance: () => invoke<"light" | "dark">("system_appearance"),
  getWorkspace: () => invoke<string>("get_workspace"),
  setWorkspace: (path: string) => invoke<string>("set_workspace", { path }),
  resetWorkspace: () => invoke<string>("reset_workspace"),
  pickWorkspace: () => invoke<string | null>("pick_workspace"),
  takeNotice: () => invoke<string | null>("take_notice"),
  takeOpened: () => invoke<Opened>("take_opened"),
  addRecent: (path: string) => invoke<void>("add_recent", { path }),
  recentFiles: () => invoke<string[]>("recent_files"),
  /** Allows opening a recent file picked in the palette; returns its canonical path. */
  allowRecent: (path: string) => invoke<string>("allow_recent", { path }),
  installCli: () => invoke<string | null>("install_cli"),
  /** Checks for a new kayet release and offers to install it (native dialogs). */
  checkForUpdates: () => invoke<void>("check_for_updates"),
  /** Restarts kayet into the update just installed. */
  restartApp: () => invoke<void>("restart_app"),
  listDir: (path: string) => invoke<Entry[]>("list_dir", { path }),
  listFiles: () => invoke<string[]>("list_files"),
  searchWorkspace: (query: string) => invoke<SearchMatch[]>("search_workspace", { query }),
  /** File text travels as raw UTF-8 bytes: encoding and parsing large files as JSON strings takes long. */
  readFile: async (path: string) => utf8.decode(await invoke<ArrayBuffer>("read_file", { path })),
  writeFile: (path: string, contents: string) =>
    invoke<void>("write_file", new TextEncoder().encode(contents), {
      headers: { "kayet-path": encodeURIComponent(path) },
    }),
  /** Saves image bytes next to `document`; returns the new file's name. */
  saveImage: (document: string, extension: string, bytes: Uint8Array) =>
    invoke<string>("save_image", bytes, {
      headers: {
        "kayet-document": encodeURIComponent(document),
        "kayet-extension": encodeURIComponent(extension),
      },
    }),
  /** Backs up the buffers with unsaved changes (one per tab). */
  writeRecovery: (backups: Backup[]) => {
    // The texts go one after another as raw bytes (see `readFile`), their paths and lengths in a header.
    const encoder = new TextEncoder();
    const texts = backups.map((b) => encoder.encode(b.text));
    const body = new Uint8Array(texts.reduce((n, t) => n + t.length, 0));
    let at = 0;
    for (const t of texts) {
      body.set(t, at);
      at += t.length;
    }
    const parts = backups.map((b, i) => ({ path: b.path, bytes: texts[i].length }));
    return invoke<void>("write_recovery", body, {
      headers: { "kayet-backups": encodeURIComponent(JSON.stringify(parts)) },
    });
  },
  clearRecovery: () => invoke<void>("clear_recovery"),
  loadRecovery: () => invoke<Backup[]>("load_recovery"),
  createFile: (path: string) => invoke<string>("create_file", { path }),
  createDir: (path: string) => invoke<string>("create_dir", { path }),
  rename: (from: string, to: string) => invoke<string>("rename", { from, to }),
  trash: (path: string) => invoke<void>("trash", { path }),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  renderMarkdown: (text: string, base: string | null) =>
    invoke<string>("render_markdown", { text, base }),
  /** Renders for export: no scroll-sync anchors, relative links left as written. */
  renderExport: (text: string, base: string | null) =>
    invoke<string>("render_export", { text, base }),
  /** Bytes of an image the preview may show, to embed into an HTML export. */
  readImage: (path: string) => invoke<ArrayBuffer>("read_image", { path }),
  /** Downloads a web image (once) into ~/.kayet/cache/images/; returns the local copy's path. */
  cacheImage: (url: string) => invoke<string>("cache_image", { url }),
  /** Prints the document prepared in `#print` into a PDF at `path`. */
  exportPdf: (path: string) => invoke<void>("export_pdf", { path }),
  /** Enables File → Export as HTML… / PDF…. */
  setExportEnabled: (enabled: boolean) => invoke<void>("set_export_enabled", { enabled }),
  /** Enables View → Switch Appearance… (off for single-variant themes). */
  setAppearanceEnabled: (enabled: boolean) => invoke<void>("set_appearance_enabled", { enabled }),
  setChromeVisible: (visible: boolean) =>
    invoke<void>("set_chrome_visible", { visible }),
  /** Updates the View menu's Syntax Highlighting or Check Spelling item. */
  setMenuCheck: (id: "toggle-zen" | "toggle-code-mode" | "toggle-syntax" | "toggle-spell-check", enabled: boolean, checked: boolean) =>
    invoke<void>("set_menu_check", { id, enabled, checked }),
  openFileDialog: () => invoke<string | null>("open_file_dialog"),
  saveFileDialog: (directory: string | null, fileName: string) =>
    invoke<string | null>("save_file_dialog", { directory, fileName }),
  confirmUnsaved: (name: string) =>
    invoke<"save" | "discard" | "cancel">("confirm_unsaved", { name }),
  confirmSave: (name: string) => invoke<boolean>("confirm_save", { name }),
  /** Asks whether to restore the unsaved changes to `name` and `others` more documents. */
  confirmRestore: (name: string, others: number) =>
    invoke<boolean>("confirm_restore", { name, others }),
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

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
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
