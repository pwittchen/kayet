// kayet frontend entry point: wires the editor, file tree, preview and chrome together.

import "./theme.css";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Text } from "@codemirror/state";

import { api, basename, Config, dirname, isMarkdown, isWithin, relativeTo, ThemeMode } from "./api";
import { Chrome } from "./chrome";
import { Editor, EditorSettings } from "./editor";
import { icons } from "./icons";
import { codeLanguage, isCode } from "./languages";
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
  btnPin: $<HTMLButtonElement>("btn-pin"),
  btnZen: $<HTMLButtonElement>("btn-zen"),
  btnSidebar: $<HTMLButtonElement>("btn-sidebar"),
  btnWorkspace: $<HTMLButtonElement>("btn-workspace"),
  btnTheme: $<HTMLButtonElement>("btn-theme"),
  btnPreview: $<HTMLButtonElement>("btn-preview"),
  btnSyntax: $<HTMLButtonElement>("btn-syntax"),
  btnCloseFile: $<HTMLButtonElement>("btn-close-file"),
  edgeHandle: $("edge-handle"),
  banner: $("banner"),
  bannerReload: $<HTMLButtonElement>("banner-reload"),
  bannerKeep: $<HTMLButtonElement>("banner-keep"),
  toast: $("toast"),
};

// ---- state ----

let cfg: Config;
let workspace = "";
/** Currently open document; `path === null` means untitled. */
const doc = {
  path: null as string | null,
  saved: null as Text | null,
  /** Last content known to be on disk, to tell our own writes from external ones. */
  disk: "",
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
  },
  onScroll: () => syncPreview(),
  onType: () => chrome.onTyping(),
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
  editor.load(text, isMarkdown(path) ? "markdown" : null);
  void applySyntax().catch(showError);
  doc.saved = editor.doc;
  hideBanner();
  rememberLastFile(path);
  updateAll();
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

async function openFile(path: string): Promise<void> {
  if (path === doc.path) return editor.focus();
  if (!(await confirmDiscard())) return;
  try {
    loadDoc(path, await api.readFile(path));
  } catch (e) {
    notify(String(e));
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
  hideBanner();
  updateTitle();
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

async function resetWorkspace(): Promise<void> {
  await applyWorkspace(await api.resetWorkspace().catch(showError));
}

// ---- notices ----

let toastTimer: number | undefined;

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
  "cycle-theme": cycleTheme,
  "toggle-chrome": () => chrome.togglePinned(),
  "toggle-zen": toggleZen,
  "toggle-syntax": toggleSyntax,
  "zoom-in": () => zoom(1),
  "zoom-out": () => zoom(-1),
  "zoom-reset": () => zoom("reset"),
};

function zoom(step: number | "reset"): void {
  editor.setZoom(step);
  preview.measure();
}

function run(id: string): void {
  if (tree.handleMenu(id)) return;
  const command = commands[id];
  if (command) Promise.resolve(command()).catch(showError);
}

els.btnPin.addEventListener("click", () => run("toggle-chrome"));
els.btnZen.addEventListener("click", () => run("toggle-zen"));
els.btnSidebar.addEventListener("click", () => run("toggle-tree"));
els.btnWorkspace.addEventListener("click", () => run("open-workspace"));
els.btnTheme.addEventListener("click", () => run("cycle-theme"));
els.btnPreview.addEventListener("click", () => run("toggle-preview"));
els.btnSyntax.addEventListener("click", () => run("toggle-syntax"));
els.btnCloseFile.addEventListener("click", () => run("close-file"));
els.edgeHandle.addEventListener("click", () => run("toggle-tree"));

els.btnPin.innerHTML = icons.pin;
els.btnZen.innerHTML = icons.zen;
els.btnSidebar.innerHTML = icons.sidebar;
els.btnWorkspace.innerHTML = icons.folder;
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

async function init(): Promise<void> {
  cfg = await api.getConfig();
  workspace = await api.getWorkspace();
  systemTheme = systemDark.matches ? "dark" : "light";
  applyTheme();
  if (cfg.ui.titlebar_pinned) chrome.setPinned(true);
  editor.applySettings(editorSettings());
  applyZen();
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
    appWindow.onCloseRequested(async (event) => {
      if (!(await confirmDiscard())) event.preventDefault();
    }),
  ]);

  await tree.setRoot(workspace);

  const last = cfg.session.last_file;
  if (last) {
    try {
      loadDoc(last, await api.readFile(last));
    } catch {
      rememberLastFile(null);
      loadDoc(null, "");
    }
  } else {
    loadDoc(null, "");
  }

  const notice = await api.takeNotice();
  if (notice) notify(notice);
}

init().catch((e) => {
  console.error(e);
  notify(`kayet failed to start: ${e}`);
});
