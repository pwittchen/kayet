// kayet frontend entry point: wires the editor, file tree, preview and chrome together.

import "./theme.css";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Text } from "@codemirror/state";

import {
  api,
  Backup,
  basename,
  Config,
  dirname,
  isMarkdown,
  isWithin,
  Opened,
  relativeTo,
  SearchMatch,
  ThemeMode,
} from "./api";
import { afterPaint, runBench } from "./bench";
import { Chrome } from "./chrome";
import { Editor, EditorSettings } from "./editor";
import { imageExtension } from "./markdown";
import { icons } from "./icons";
import { codeLanguage, isCode } from "./languages";
import { fileScore, Palette, PaletteItem, PaletteOptions } from "./palette";
import { Preview } from "./preview";
import { FileTree } from "./tree";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const appWindow = getCurrentWindow();
const els = {
  app: $("app"),
  sidebar: $("sidebar"),
  tree: $("tree"),
  sidebarDivider: $("sidebar-divider"),
  editorPane: $("editor-pane"),
  editor: $("editor"),
  previewDivider: $("preview-divider"),
  previewPane: $("preview-pane"),
  preview: $("preview"),
  titlebar: $("titlebar"),
  docTitle: $("doc-title"),
  docName: $("doc-name"),
  docEdited: $("doc-edited"),
  btnPalette: $<HTMLButtonElement>("btn-palette"),
  btnPin: $<HTMLButtonElement>("btn-pin"),
  btnZen: $<HTMLButtonElement>("btn-zen"),
  btnBlink: $<HTMLButtonElement>("btn-blink"),
  btnSidebar: $<HTMLButtonElement>("btn-sidebar"),
  btnWorkspace: $<HTMLButtonElement>("btn-workspace"),
  btnSettings: $<HTMLButtonElement>("btn-settings"),
  btnTheme: $<HTMLButtonElement>("btn-theme"),
  btnPreview: $<HTMLButtonElement>("btn-preview"),
  btnSyntax: $<HTMLButtonElement>("btn-syntax"),
  btnCloseFile: $<HTMLButtonElement>("btn-close-file"),
  btnStatus: $<HTMLButtonElement>("btn-status"),
  edgeHandle: $("edge-handle"),
  banner: $("banner"),
  bannerReload: $<HTMLButtonElement>("banner-reload"),
  bannerKeep: $<HTMLButtonElement>("banner-keep"),
  toast: $("toast"),
};

// ---- state ----

let cfg: Config;
/** `~/.kayet/config.toml`; saving it from the editor reloads the settings. */
let configPath = "";
let workspace = "";
/** Currently open document; `path === null` means untitled. */
const doc = {
  path: null as string | null,
  saved: null as Text | null,
  /** Last content known to be on disk, to tell our own writes from external ones. */
  disk: "",
  /** Whether the document was saved since it was loaded; turns the edit status into a check. */
  savedOnce: false,
};
let previewOpen = false; // remembered per session only
let autosaveTimer: number | undefined;

const isDirty = () => !doc.saved || !editor.doc.eq(doc.saved);
const docName = () => (doc.path ? basename(doc.path) : "Untitled");

// ---- components ----

const editor = new Editor(els.editor, defaultEditorSettings(), {
  onChange: () => {
    updateTitle();
    if (previewVisible()) preview.update(() => editor.text(), doc.path);
    scheduleAutosave();
    scheduleBackup();
  },
  onScroll: () => syncPreview(),
  onType: () => chrome.onTyping(),
  onPasteImage: (image) => pasteImage(image),
});

const tree = new FileTree(els.tree, {
  openFile: (path) => void openFile(path),
  renamed: (from, to) => {
    if (doc.path && isWithin(from, doc.path)) {
      setDocPath(to + doc.path.slice(from.length));
    }
  },
  trashed: (path) => {
    if (doc.path && isWithin(path, doc.path)) {
      // Keep the text around as an unsaved, untitled document.
      doc.path = null;
      doc.saved = null;
      rememberLastFile(null);
      updateAll();
      void syncBackup();
    }
  },
  notify,
});

const preview = new Preview(els.previewPane, els.preview, {
  openFile: (path) => void openFile(path),
});

const chrome = new Chrome(
  els.titlebar,
  els.edgeHandle,
  () => cfg?.ui.sidebar_visible ?? false,
  (pinned) => {
    els.btnPin.classList.toggle("on", pinned);
    els.btnPin.setAttribute("aria-pressed", String(pinned));
    if (cfg && cfg.ui.titlebar_pinned !== pinned) {
      cfg.ui.titlebar_pinned = pinned;
      saveConfig();
    }
  },
);

// ---- config ----

function defaultEditorSettings(): EditorSettings {
  return { fontFamily: "mono", fontSize: 15, lineHeight: 1.6, softWrap: true, maxLineWidth: 72 };
}

function editorSettings(): EditorSettings {
  const e = cfg.editor;
  return {
    fontFamily: e.font_family,
    fontSize: e.font_size,
    lineHeight: e.line_height,
    softWrap: e.soft_wrap,
    maxLineWidth: e.max_line_width,
  };
}

function saveConfig(): void {
  void api.setConfig(cfg).catch((e) => console.error("set_config failed", e));
}

/** Opens the config file in the editor. */
async function openSettings(): Promise<void> {
  configPath = await api.configFile();
  await openFile(configPath);
}

/** Applies the config file after it was saved from the editor. */
async function reloadConfig(): Promise<void> {
  let next: Config;
  try {
    next = await api.reloadConfig();
  } catch (e) {
    return notify(String(e));
  }
  const hiddenChanged = next.workspace.show_hidden_files !== cfg.workspace.show_hidden_files;
  const pinnedChanged = next.ui.titlebar_pinned !== cfg.ui.titlebar_pinned;
  cfg = next;
  applyTheme();
  if (pinnedChanged) chrome.setPinned(cfg.ui.titlebar_pinned);
  editor.applySettings(editorSettings());
  applyZen();
  applyCursorBlink();
  updateLayout();
  await applySyntax();
  if (hiddenChanged) await tree.refresh();
}

function rememberLastFile(path: string | null): void {
  if ((cfg.session.last_file ?? null) === path) return;
  cfg.session.last_file = path;
  saveConfig();
}

// ---- theme ----

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let systemTheme: "light" | "dark" = systemDark.matches ? "dark" : "light";

function applyTheme(): void {
  const mode = cfg.ui.theme;
  const resolved = mode === "system" ? systemTheme : mode;
  document.documentElement.dataset.theme = resolved;
  els.btnTheme.innerHTML =
    mode === "system" ? icons.themeSystem : mode === "light" ? icons.themeLight : icons.themeDark;
  els.btnTheme.title = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)} (⌘⇧L)`;
  // Also drives the native traffic lights and sidebar vibrancy appearance.
  void appWindow.setTheme(mode === "system" ? null : mode).catch(() => {});
}

function cycleTheme(): void {
  const order: ThemeMode[] = ["system", "light", "dark"];
  cfg.ui.theme = order[(order.indexOf(cfg.ui.theme) + 1) % order.length];
  applyTheme();
  saveConfig();
}

systemDark.addEventListener("change", (e) => {
  if (cfg.ui.theme !== "system") return;
  systemTheme = e.matches ? "dark" : "light";
  applyTheme();
});

// ---- layout ----

const previewVisible = () => previewOpen && isMarkdown(doc.path);

function updateLayout(): void {
  const ui = cfg.ui;
  els.app.style.setProperty("--sidebar-width", `${ui.sidebar_width}px`);
  els.app.style.setProperty("--preview-split", String(ui.preview_split));
  els.sidebar.hidden = !ui.sidebar_visible;
  els.sidebarDivider.hidden = !ui.sidebar_visible;
  els.btnSidebar.classList.toggle("on", ui.sidebar_visible);
  els.btnCloseFile.hidden = !doc.path;

  const md = isMarkdown(doc.path);
  if (!md) previewOpen = false;
  els.btnPreview.hidden = !md;
  els.btnPreview.classList.toggle("on", previewVisible());
  els.previewPane.hidden = !previewVisible();
  els.previewDivider.hidden = !previewVisible();
  els.app.classList.toggle("with-preview", previewVisible());
  if (!previewVisible()) preview.clear();
}

function updateTitle(): void {
  const dirty = isDirty();
  els.docName.textContent = docName();
  els.docEdited.hidden = !dirty;
  const rel = doc.path ? relativeTo(workspace, doc.path) : null;
  els.docTitle.title = doc.path ? (rel ?? doc.path) : "Not saved yet";
  void appWindow.setTitle(`${docName()}${dirty ? " — edited" : ""}`).catch(() => {});
  updateStatus(dirty);
}

let statusState: "hidden" | "edited" | "saved" = "hidden";

/** Title bar edit status: a dot while there are unsaved changes, a check once they are saved. */
function updateStatus(dirty: boolean): void {
  const state = dirty ? "edited" : doc.savedOnce ? "saved" : "hidden";
  if (state === statusState) return;
  statusState = state;
  const btn = els.btnStatus;
  btn.hidden = state === "hidden";
  btn.classList.toggle("edited", state === "edited");
  btn.innerHTML = state === "edited" ? icons.edited : state === "saved" ? icons.saved : "";
  btn.title = state === "edited" ? "Unsaved changes — click to save" : "Saved";
  btn.setAttribute("aria-label", btn.title);
}

/** Asks whether to save the unsaved changes, then saves them. */
async function promptSave(): Promise<void> {
  if (isDirty() && (await chrome.hold(api.confirmSave(docName())))) await save();
  editor.focus();
}

function updateAll(): void {
  updateLayout();
  updateTitle();
  tree.setActive(doc.path);
}

function applyZen(): void {
  const on = cfg.ui.zen_mode;
  els.app.classList.toggle("zen", on);
  els.btnZen.classList.toggle("on", on);
  els.btnZen.setAttribute("aria-pressed", String(on));
  editor.setZen(on);
}

function toggleZen(): void {
  cfg.ui.zen_mode = !cfg.ui.zen_mode;
  applyZen();
  saveConfig();
  editor.focus();
}

function applyCursorBlink(): void {
  const on = cfg.editor.cursor === "blink";
  els.app.classList.toggle("steady-cursor", !on);
  els.btnBlink.classList.toggle("on", on);
  els.btnBlink.setAttribute("aria-pressed", String(on));
  els.btnBlink.title = on ? "Cursor blink: on" : "Cursor blink: off";
}

function toggleCursorBlink(): void {
  cfg.editor.cursor = cfg.editor.cursor === "blink" ? "steady" : "blink";
  applyCursorBlink();
  saveConfig();
  editor.focus();
}

async function toggleTree(): Promise<void> {
  cfg.ui.sidebar_visible = !cfg.ui.sidebar_visible;
  updateLayout();
  saveConfig();
  if (cfg.ui.sidebar_visible) {
    els.edgeHandle.classList.remove("visible");
    await tree.refresh();
  } else {
    editor.focus();
  }
}

async function togglePreview(): Promise<void> {
  if (!isMarkdown(doc.path)) return;
  previewOpen = !previewOpen;
  updateLayout();
  if (previewVisible()) {
    await preview.render(editor.text(), doc.path);
    syncPreview();
  }
}

function syncPreview(): void {
  if (previewVisible()) preview.syncTo(editor.topLine(), editor.atBottom());
}

function makeResizable(divider: HTMLElement, onMove: (x: number) => void, onDone: () => void): void {
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) => onMove(ev.clientX);
    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      onDone();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
}

makeResizable(
  els.sidebarDivider,
  (x) => {
    cfg.ui.sidebar_width = Math.round(Math.max(180, Math.min(400, x)));
    updateLayout();
  },
  saveConfig,
);

makeResizable(
  els.previewDivider,
  (x) => {
    const left = els.editorPane.getBoundingClientRect().left;
    const total = els.editorPane.offsetWidth + els.previewPane.offsetWidth;
    cfg.ui.preview_split = Math.max(0.2, Math.min(0.8, (x - left) / total));
    updateLayout();
  },
  () => {
    cfg.ui.preview_split = Math.round(cfg.ui.preview_split * 1000) / 1000;
    saveConfig();
    preview.measure();
  },
);

// ---- documents ----

let syntaxSeq = 0;

/**
 * Highlights the open document: Markdown always, code files per the syntax highlighting
 * setting. Code grammars load lazily, so they are applied once ready.
 */
async function applySyntax(): Promise<void> {
  const seq = ++syntaxSeq;
  const code = isCode(doc.path);
  const on = cfg.editor.syntax_highlighting;
  void api.setSyntaxMenu(code, on).catch(() => {});
  els.btnSyntax.hidden = !code;
  els.btnSyntax.classList.toggle("on", on);
  els.btnSyntax.setAttribute("aria-pressed", String(on));
  if (isMarkdown(doc.path)) return editor.setSyntax("markdown");
  const lang = code && on ? await codeLanguage(doc.path) : null;
  if (seq === syntaxSeq) editor.setSyntax(lang);
}

function toggleSyntax(): void {
  if (!isCode(doc.path)) return;
  cfg.editor.syntax_highlighting = !cfg.editor.syntax_highlighting;
  saveConfig();
  void applySyntax();
}

function loadDoc(path: string | null, text: string): void {
  doc.path = path;
  doc.disk = text;
  doc.savedOnce = false;
  editor.load(text, isMarkdown(path) ? "markdown" : null);
  void applySyntax().catch(showError);
  doc.saved = editor.doc;
  hideBanner();
  rememberLastFile(path);
  updateAll();
  syncBackup();
  if (previewVisible()) void preview.render(text, path);
  editor.focus();
}

function setDocPath(path: string): void {
  doc.path = path;
  void applySyntax().catch(showError);
  rememberLastFile(path);
  updateAll();
}

/** Asks to save unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const choice = await chrome.hold(api.confirmUnsaved(docName()));
  if (choice === "save") return save();
  return choice === "discard";
}

/** Opens `path` (asking to save unsaved changes first). Resolves to whether it is now open. */
async function openFile(path: string): Promise<boolean> {
  if (path === doc.path) {
    editor.focus();
    return true;
  }
  if (!(await confirmDiscard())) return false;
  try {
    loadDoc(path, await api.readFile(path));
    return true;
  } catch (e) {
    notify(String(e));
    return false;
  }
}

async function openWithDialog(): Promise<void> {
  const path = await chrome.hold(api.openFileDialog());
  if (path) await openFile(path);
}

async function newDoc(): Promise<void> {
  if (!(await confirmDiscard())) return;
  loadDoc(null, "");
}

/** Closes the open file, leaving an empty untitled document. */
async function closeFile(): Promise<void> {
  if (!(await confirmDiscard())) return;
  loadDoc(null, "");
}

async function writeDoc(path: string): Promise<boolean> {
  const text = editor.text();
  const snapshot = editor.doc;
  try {
    await api.writeFile(path, text);
  } catch (e) {
    notify(`Could not save: ${e}`);
    return false;
  }
  doc.disk = text;
  doc.saved = snapshot;
  doc.savedOnce = true;
  hideBanner();
  updateTitle();
  syncBackup();
  if (path === configPath) await reloadConfig();
  return true;
}

async function save(): Promise<boolean> {
  if (!doc.path) return saveAs();
  return writeDoc(doc.path);
}

async function saveAs(): Promise<boolean> {
  const dir = doc.path ? dirname(doc.path) : workspace;
  const name = doc.path ? basename(doc.path) : "Untitled.md";
  const path = await chrome.hold(api.saveFileDialog(dir, name));
  if (!path || !(await writeDoc(path))) return false;
  setDocPath(path);
  void tree.refresh();
  return true;
}

function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  if (!cfg?.editor.autosave || !doc.path) return;
  autosaveTimer = window.setTimeout(() => {
    if (doc.path && isDirty()) void save();
  }, 1000);
}

// ---- crash recovery ----

let backupTimer: number | undefined;
/** Whether a backup of the buffer may be on disk. */
let backedUp = false;
/** Backup writes and removals, in order. */
let backupQueue: Promise<void> = Promise.resolve();

function queueBackup(op: () => Promise<void>): Promise<void> {
  backupQueue = backupQueue.then(op).catch((e) => console.error("recovery backup failed", e));
  return backupQueue;
}

/** Backs up the buffer within a second of an edit, also while typing continuously. */
function scheduleBackup(): void {
  if (backupTimer === undefined) backupTimer = window.setTimeout(syncBackup, 1000);
}

/** Backs up the buffer while it has unsaved changes and removes the backup once it has none. */
function syncBackup(): Promise<void> {
  window.clearTimeout(backupTimer);
  backupTimer = undefined;
  if (isDirty()) {
    backedUp = true;
    const path = doc.path;
    const text = editor.text();
    return queueBackup(() => api.writeRecovery(path, text));
  }
  if (!backedUp) return backupQueue;
  backedUp = false;
  return queueBackup(() => api.clearRecovery());
}

/** Removes the backup when the window closes with the changes saved or discarded. */
function clearBackup(): Promise<void> {
  window.clearTimeout(backupTimer);
  backupTimer = undefined;
  backedUp = false;
  return queueBackup(() => api.clearRecovery());
}

/**
 * Offers to restore the buffer backed up by a session that did not exit cleanly.
 * Returns true if it was restored.
 */
async function restoreBackup(backup: Backup): Promise<boolean> {
  const name = backup.path ? basename(backup.path) : "Untitled";
  if (!(await chrome.hold(api.confirmRestore(name)))) {
    await clearBackup();
    return false;
  }
  const disk = backup.path ? await api.readFile(backup.path).catch(() => null) : "";
  if (disk === null) {
    // The file is gone: keep the text as unsaved changes to that path.
    loadDoc(backup.path, backup.text);
    doc.saved = null;
    doc.disk = "";
    updateTitle();
  } else {
    loadDoc(backup.path, disk);
    editor.replaceText(backup.text);
  }
  // Rewrites the backup right away, or removes it if the text matches the file after all.
  backedUp = true;
  await syncBackup();
  return true;
}

// ---- external changes ----

async function checkDiskChange(): Promise<void> {
  const path = doc.path;
  if (!path) return;
  let text: string;
  try {
    text = await api.readFile(path);
  } catch {
    return; // deleted or unreadable: keep the buffer as it is
  }
  if (path !== doc.path || text === doc.disk) return;
  if (!isDirty()) {
    doc.disk = text;
    editor.replaceText(text);
    doc.saved = editor.doc;
    updateTitle();
  } else {
    pendingDisk = text;
    els.banner.hidden = false;
  }
}

let pendingDisk: string | null = null;

function hideBanner(): void {
  els.banner.hidden = true;
  pendingDisk = null;
}

els.bannerReload.addEventListener("click", () => {
  if (pendingDisk === null) return hideBanner();
  const text = pendingDisk;
  doc.disk = text;
  editor.replaceText(text);
  doc.saved = editor.doc;
  hideBanner();
  updateTitle();
  editor.focus();
});

els.bannerKeep.addEventListener("click", () => {
  if (pendingDisk !== null) doc.disk = pendingDisk;
  hideBanner();
  editor.focus();
});

// ---- workspace ----

async function applyWorkspace(path: string | null): Promise<void> {
  if (!path) return;
  workspace = path;
  await tree.setRoot(workspace);
  tree.setActive(doc.path);
  updateTitle();
}

async function changeWorkspace(): Promise<void> {
  await applyWorkspace(await chrome.hold(api.pickWorkspace()).catch(showError));
  if (!cfg.ui.sidebar_visible) await toggleTree();
}

/** Handles a file / folder opened from Finder or the `kayet` command while running. */
async function openRequested(req: Opened): Promise<void> {
  if (req.folder) {
    await applyWorkspace(await api.setWorkspace(req.folder).catch(showError));
    if (!cfg.ui.sidebar_visible) await toggleTree();
  }
  if (req.file) await openFile(req.file);
}

async function installCli(): Promise<void> {
  const link = await chrome.hold(api.installCli());
  if (link) notify(`Installed ${link} — open files from a terminal with kayet <file>.`);
}

async function resetWorkspace(): Promise<void> {
  await applyWorkspace(await api.resetWorkspace().catch(showError));
}

// ---- notices ----

let toastTimer: number | undefined;

/** Saves a pasted image next to the open document; returns its relative path, or null. */
async function pasteImage(image: File): Promise<string | null> {
  const extension = imageExtension(image.type);
  if (!extension) return null;
  if (!doc.path) {
    notify("Save the document before pasting images");
    return null;
  }
  try {
    return await api.saveImage(doc.path, extension, new Uint8Array(await image.arrayBuffer()));
  } catch (e) {
    notify(`Could not save the image: ${e}`);
    return null;
  }
}

function notify(message: string): void {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add("visible"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
    toastTimer = window.setTimeout(() => (els.toast.hidden = true), 200);
  }, 5000);
}

function showError(e: unknown): null {
  notify(String(e));
  return null;
}

// ---- commands (menu + title bar) ----

function inTextField(): HTMLInputElement | null {
  const el = document.activeElement;
  return el instanceof HTMLInputElement ? el : null;
}

const commands: Record<string, () => unknown> = {
  new: newDoc,
  open: openWithDialog,
  "open-workspace": changeWorkspace,
  "reset-workspace": resetWorkspace,
  save,
  "save-as": saveAs,
  "close-file": closeFile,
  close: () => appWindow.close(),
  quit: () => appWindow.close(),
  undo: () => (inTextField() ? document.execCommand("undo") : editor.undo()),
  redo: () => (inTextField() ? document.execCommand("redo") : editor.redo()),
  find: () => editor.find(),
  replace: () => editor.replace(),
  "toggle-tree": toggleTree,
  "toggle-preview": togglePreview,
  "open-settings": openSettings,
  "install-cli": installCli,
  "cycle-theme": cycleTheme,
  "toggle-chrome": () => chrome.togglePinned(),
  "toggle-zen": toggleZen,
  "toggle-cursor-blink": toggleCursorBlink,
  "toggle-syntax": toggleSyntax,
  "zoom-in": () => zoom(1),
  "zoom-out": () => zoom(-1),
  "zoom-reset": () => zoom("reset"),
  palette: togglePalette,
  "go-to-file": toggleFileFinder,
  "find-in-workspace": toggleWorkspaceSearch,
};

// ---- command palette ----

const palette = new Palette(() => editor.focus());

/** Everything the palette offers, in menu order; context-only commands appear when they apply. */
function paletteCommands(): PaletteItem[] {
  const md = isMarkdown(doc.path);
  const code = isCode(doc.path);
  const list: (PaletteItem | false)[] = [
    { id: "new", label: "New File", shortcut: "⌘N" },
    { id: "open", label: "Open File…", shortcut: "⌘O" },
    { id: "go-to-file", label: "Go to File…", shortcut: "⌘P" },
    { id: "open-workspace", label: "Open Workspace…", shortcut: "⌘⇧O" },
    { id: "reset-workspace", label: "Reset to Default Workspace" },
    { id: "save", label: "Save", shortcut: "⌘S" },
    { id: "save-as", label: "Save As…", shortcut: "⌘⇧S" },
    !!doc.path && { id: "close-file", label: "Close File", shortcut: "⌘W" },
    { id: "undo", label: "Undo", shortcut: "⌘Z" },
    { id: "redo", label: "Redo", shortcut: "⌘⇧Z" },
    { id: "find", label: "Find…", shortcut: "⌘F" },
    { id: "replace", label: "Replace…", shortcut: "⌘⌥F" },
    { id: "find-in-workspace", label: "Find in Workspace…", shortcut: "⌘⇧F" },
    {
      id: "toggle-tree",
      label: cfg.ui.sidebar_visible ? "Hide File Tree" : "Show File Tree",
      shortcut: "⌘\\",
    },
    md && {
      id: "toggle-preview",
      label: previewVisible() ? "Hide Preview" : "Show Preview",
      shortcut: "⌘⇧P",
    },
    { id: "cycle-theme", label: "Cycle Theme", shortcut: "⌘⇧L" },
    { id: "toggle-chrome", label: "Keep Title Bar Visible", shortcut: "⌘." },
    { id: "toggle-zen", label: cfg.ui.zen_mode ? "Exit Zen Mode" : "Zen Mode", shortcut: "⌘⇧J" },
    {
      id: "toggle-cursor-blink",
      label: cfg.editor.cursor === "blink" ? "Disable Cursor Blink" : "Enable Cursor Blink",
    },
    code && {
      id: "toggle-syntax",
      label: cfg.editor.syntax_highlighting ? "Disable Syntax Highlighting" : "Enable Syntax Highlighting",
    },
    { id: "zoom-in", label: "Zoom In", shortcut: "⌘+" },
    { id: "zoom-out", label: "Zoom Out", shortcut: "⌘−" },
    { id: "zoom-reset", label: "Actual Size", shortcut: "⌘0" },
    { id: "open-settings", label: "Settings…", shortcut: "⌘," },
    { id: "install-cli", label: "Install ‘kayet’ Command" },
    { id: "close", label: "Close Window", shortcut: "⌘⇧W" },
    { id: "quit", label: "Quit kayet", shortcut: "⌘Q" },
  ];
  return list.filter((c): c is PaletteItem => !!c);
}

/** Opens the palette with `items`, switches it to them, or closes it if it shows them already. */
async function showPalette(items: PaletteItem[], options: PaletteOptions): Promise<void> {
  if (palette.showing === options.kind) return palette.close();
  const wasOpen = palette.isOpen;
  const closed = palette.open(items, options);
  // Keeps the title bar up while the palette is open, if it was showing.
  if (!wasOpen) await chrome.hold(closed);
}

function togglePalette(): Promise<void> {
  return showPalette(paletteCommands(), {
    kind: "commands",
    placeholder: "Type a command…",
    empty: "No matching commands",
    pick: run,
  });
}

/** File finder: every workspace file, labeled by name with its folder as detail. */
async function toggleFileFinder(): Promise<void> {
  if (palette.showing === "files") return palette.close();
  const files = await api.listFiles();
  const items = files.map((path) => {
    const rel = relativeTo(workspace, path) ?? path;
    const cut = rel.lastIndexOf("/");
    return { id: path, label: rel.slice(cut + 1), detail: cut > 0 ? rel.slice(0, cut) : undefined };
  });
  const paths = new Map(items.map((i) => [i.id, (i.detail ? `${i.detail}/${i.label}` : i.label).toLowerCase()]));
  await showPalette(items, {
    kind: "files",
    placeholder: "Go to file…",
    empty: files.length ? "No matching files" : "No files in the workspace",
    pick: (path) => void openFile(path),
    rank: (item, query) => fileScore(paths.get(item.id)!, query),
  });
}

/** Workspace-wide search: each matching line, with its file and line number aside. */
function toggleWorkspaceSearch(): Promise<void> {
  const found = new Map<string, SearchMatch>();
  let query = "";
  return showPalette([], {
    kind: "search",
    placeholder: "Find in workspace…",
    prompt: "Type to search all files in the workspace",
    empty: "No results",
    search: async (q) => {
      const matches = await api.searchWorkspace(q);
      query = q;
      found.clear();
      return matches.map((m) => {
        const id = `${m.path}:${m.line}`;
        found.set(id, m);
        return { id, label: m.text, match: [m.start, m.end], aside: `${relativeTo(workspace, m.path) ?? m.path}:${m.line}` };
      });
    },
    pick: (id) => {
      const m = found.get(id);
      if (!m) return;
      void openFile(m.path).then((open) => open && editor.revealMatch(m.line, m.column, m.length, query));
    },
  });
}

function zoom(step: number | "reset"): void {
  editor.setZoom(step);
  preview.measure();
}

function run(id: string): void {
  if (tree.handleMenu(id)) return;
  const command = commands[id];
  if (command) Promise.resolve(command()).catch(showError);
}

els.btnPalette.addEventListener("click", () => run("palette"));
els.btnPin.addEventListener("click", () => run("toggle-chrome"));
els.btnZen.addEventListener("click", () => run("toggle-zen"));
els.btnBlink.addEventListener("click", () => run("toggle-cursor-blink"));
els.btnSidebar.addEventListener("click", () => run("toggle-tree"));
els.btnWorkspace.addEventListener("click", () => run("open-workspace"));
els.btnSettings.addEventListener("click", () => run("open-settings"));
els.btnTheme.addEventListener("click", () => run("cycle-theme"));
els.btnPreview.addEventListener("click", () => run("toggle-preview"));
els.btnSyntax.addEventListener("click", () => run("toggle-syntax"));
els.btnCloseFile.addEventListener("click", () => run("close-file"));
els.btnStatus.addEventListener("click", () => void promptSave().catch(showError));
els.edgeHandle.addEventListener("click", () => run("toggle-tree"));

els.btnPalette.innerHTML = icons.command;
els.btnPin.innerHTML = icons.pin;
els.btnZen.innerHTML = icons.zen;
els.btnBlink.innerHTML = icons.cursor;
els.btnSidebar.innerHTML = icons.sidebar;
els.btnWorkspace.innerHTML = icons.folder;
els.btnSettings.innerHTML = icons.settings;
els.btnPreview.innerHTML = icons.eye;
els.btnSyntax.innerHTML = icons.code;
els.btnCloseFile.innerHTML = icons.closeFile;

// Keep the default browser context menu out of the editor chrome.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest(".cm-editor, input")) e.preventDefault();
});
// Dropped files are handled natively (see `file://dropped`); never navigate away.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

window.addEventListener("resize", () => preview.measure());

// ---- startup ----

/** Opens the document kayet starts with, or an empty untitled one. */
async function openStart(start: string | null | undefined): Promise<void> {
  if (!start) return loadDoc(null, "");
  try {
    loadDoc(start, await api.readFile(start));
  } catch (e) {
    if (start === cfg.session.last_file) rememberLastFile(null);
    else notify(String(e));
    loadDoc(null, "");
  }
}

async function init(): Promise<void> {
  cfg = await api.getConfig();
  workspace = await api.getWorkspace();
  configPath = await api.configFile();
  systemTheme = systemDark.matches ? "dark" : "light";
  applyTheme();
  if (cfg.ui.titlebar_pinned) chrome.setPinned(true);
  editor.applySettings(editorSettings());
  applyZen();
  applyCursorBlink();
  updateAll();

  await Promise.all([
    listen<string>("menu", (e) => run(e.payload)),
    listen<{ paths: string[] }>("fs://changed", (e) => {
      void tree.refresh();
      if (doc.path && e.payload.paths.includes(doc.path)) void checkDiskChange();
    }),
    listen<string>("theme://changed", (e) => {
      if (cfg.ui.theme !== "system") return;
      systemTheme = e.payload === "dark" ? "dark" : "light";
      applyTheme();
    }),
    listen<{ path: string }>("file://dropped", (e) => void openFile(e.payload.path)),
    listen<Opened>("open://requested", (e) => void openRequested(e.payload).catch(showError)),
    appWindow.onCloseRequested(async (event) => {
      if (!(await confirmDiscard())) return event.preventDefault();
      await clearBackup();
    }),
  ]);

  // Launched from Finder or the `kayet` command: that file / folder wins over the session.
  const opened = await api.takeOpened();
  if (opened.folder) {
    workspace = await api.setWorkspace(opened.folder).catch(() => workspace);
  }
  await tree.setRoot(workspace);
  if (opened.folder && !cfg.ui.sidebar_visible) await toggleTree();

  // Unsaved changes left behind by a crash take the place of the start document.
  const backup = await api.loadRecovery().catch(() => null);
  if (!backup || !(await restoreBackup(backup))) await openStart(opened.file ?? cfg.session.last_file);

  const notice = await api.takeNotice();
  if (notice) notify(notice);
}

init()
  .then(async () => {
    const firstPaint = afterPaint();
    const benchDir = await api.benchDir();
    if (!benchDir) return;
    await runBench(benchDir, {
      firstPaint,
      openFile: async (path) => void (await openFile(path)),
      docLength: () => editor.doc.length,
      showPreview: async () => {
        if (!previewVisible()) await togglePreview();
      },
      renderPreview: (text, path) => preview.render(text, path),
    });
  })
  .catch((e) => {
    console.error(e);
    notify(`kayet failed to start: ${e}`);
  });
