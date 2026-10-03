// kayet frontend entry point: wires the editor, file tree, preview and chrome together.

import "./theme.css";
import "./markdown-body.css";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Text } from "@codemirror/state";

import {
  api,
  Backup,
  basename,
  Config,
  dirname,
  isMarkdown,
  isWithin,
  Mode,
  Opened,
  relativeTo,
  SearchMatch,
} from "./api";
import { afterPaint, runBench } from "./bench";
import { Chrome } from "./chrome";
import { Editor, EditorSettings, EditorSnapshot } from "./editor";
import { exportHtml, exportPdf } from "./export";
import { imageExtension, looksLikeMarkdown } from "./markdown";
import { icons } from "./icons";
import { codeLanguage, isCode } from "./languages";
import { fileScore, Palette, PaletteItem, PaletteOptions } from "./palette";
import { Presentation } from "./presentation";
import { Preview } from "./preview";
import { countWords, formatStats } from "./stats";
import {
  applyThemeColors,
  clearThemeColors,
  effectiveMode,
  isLegacyTheme,
  migrateLegacyTheme,
  modeItems,
  nextMode,
  onlyVariant,
  pickSection,
  themeItems,
} from "./theme";
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
  tabs: $("tabs"),
  docName: $("doc-name"),
  docEdited: $("doc-edited"),
  docStats: $("doc-stats"),
  btnPalette: $<HTMLButtonElement>("btn-palette"),
  btnRecent: $<HTMLButtonElement>("btn-recent"),
  btnPin: $<HTMLButtonElement>("btn-pin"),
  btnZen: $<HTMLButtonElement>("btn-zen"),
  btnCode: $<HTMLButtonElement>("btn-code"),
  btnBlink: $<HTMLButtonElement>("btn-blink"),
  btnSidebar: $<HTMLButtonElement>("btn-sidebar"),
  btnWorkspace: $<HTMLButtonElement>("btn-workspace"),
  btnSettings: $<HTMLButtonElement>("btn-settings"),
  btnTheme: $<HTMLButtonElement>("btn-theme"),
  btnPreview: $<HTMLButtonElement>("btn-preview"),
  btnPresent: $<HTMLButtonElement>("btn-present"),
  btnSyntax: $<HTMLButtonElement>("btn-syntax"),
  btnSpell: $<HTMLButtonElement>("btn-spell"),
  btnCloseFile: $<HTMLButtonElement>("btn-close-file"),
  btnNewTab: $<HTMLButtonElement>("btn-new-tab"),
  btnStatus: $<HTMLButtonElement>("btn-status"),
  edgeHandle: $("edge-handle"),
  banner: $("banner"),
  bannerReload: $<HTMLButtonElement>("banner-reload"),
  bannerKeep: $<HTMLButtonElement>("banner-keep"),
  presentation: $("presentation"),
  slideScroller: $("slide-scroller"),
  slide: $("slide"),
  slidePrev: $<HTMLButtonElement>("slide-prev"),
  slideNext: $<HTMLButtonElement>("slide-next"),
  slideFirst: $<HTMLButtonElement>("slide-first"),
  slideCounter: $("slide-counter"),
  toast: $("toast"),
  print: $("print"),
};

// ---- state ----

let cfg: Config;
/** `~/.kayet/config.toml`; saving it from the editor reloads the settings. */
let configPath = "";
let workspace = "";
/** An open document, shown in a tab; `path === null` means untitled. */
interface Tab {
  path: string | null;
  saved: Text | null;
  /** Last content known to be on disk, to tell our own writes from external ones. */
  disk: string;
  /** Whether the document was saved since it was loaded; turns the edit status into a check. */
  savedOnce: boolean;
  /** Changed file content waiting for Reload / Keep mine (see the banner). */
  pendingDisk: string | null;
  /** The editor state while another tab is shown. */
  editor: EditorSnapshot | null;
  /** Whether the untitled document was found to be written in Markdown (kept until it is saved). */
  markdown: boolean;
}

const newTab = (): Tab => ({
  path: null,
  saved: Text.empty,
  disk: "",
  savedOnce: false,
  pendingDisk: null,
  editor: null,
  markdown: false,
});

/** Open documents in tab order; `doc` is the one shown. */
const tabs: Tab[] = [newTab()];
let doc = tabs[0];
let previewOpen = false; // remembered per session only
let exportEnabled: boolean | null = null;
let autosaveTimer: number | undefined;
let statsTimer: number | undefined;
let markdownTimer: number | undefined;

/**
 * Documents longer than this (UTF-16 code units, ~10MB of text) are edited in large file mode:
 * no preview, highlighting, Markdown editing helpers or word count, and backed up once typing
 * pauses. Each of those goes over the whole text, which takes long enough to be felt.
 */
const LARGE_DOC = 10 * 1024 * 1024;
/** Whether the shown document is large (see `LARGE_DOC`). */
let largeDoc = false;

/** The tab's text; a tab not shown yet has none. */
const textOf = (tab: Tab) => (tab === doc ? editor.doc : (tab.editor?.state.doc ?? Text.empty));
const isTabDirty = (tab: Tab) => !tab.saved || !textOf(tab).eq(tab.saved);
const isDirty = () => isTabDirty(doc);
const tabName = (tab: Tab) => (tab.path ? basename(tab.path) : "Untitled");
const docName = () => tabName(doc);
/** An untitled tab nothing was typed into yet, which an opened file may take over. */
const isBlank = (tab: Tab) => !tab.path && !tab.savedOnce && textOf(tab).length === 0;

// ---- components ----

const editor = new Editor(els.editor, defaultEditorSettings(), {
  onChange: () => {
    if (checkLarge()) applyLarge();
    updateTitle();
    scheduleMarkdownCheck();
    if (previewVisible()) preview.update(() => editor.text(), doc.path);
    if (presentation.active) presentation.update(() => editor.text());
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
    for (const tab of tabs) {
      if (!tab.path || !isWithin(from, tab.path)) continue;
      const path = to + tab.path.slice(from.length);
      if (tab === doc) setDocPath(path);
      else tab.path = path;
    }
    rememberSession();
    renderTabs();
  },
  trashed: (path) => {
    const gone = tabs.filter((tab) => tab.path && isWithin(path, tab.path));
    if (!gone.length) return;
    for (const tab of gone) {
      // Keep the text around as an unsaved, untitled document.
      tab.markdown = isMarkdown(tab.path);
      tab.path = null;
      tab.saved = null;
    }
    rememberSession();
    updateAll();
    void syncBackup();
  },
  notify,
});

const preview = new Preview(els.previewPane, els.preview, {
  openFile: (path) => void openFile(path),
});

const presentation = new Presentation(
  els.presentation,
  els.slideScroller,
  els.slide,
  els.slidePrev,
  els.slideNext,
  els.slideFirst,
  els.slideCounter,
  {
    openFile: (path) => void openFile(path),
    exit: () => togglePresentation(),
  },
);

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
  () => updateStats(),
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
  const migrated = migrateLegacyTheme(cfg.ui.theme, cfg.ui.mode);
  if (migrated.theme !== cfg.ui.theme) {
    cfg.ui.theme = migrated.theme;
    cfg.ui.mode = migrated.mode;
    saveConfig();
  }
  void applyTheme();
  if (pinnedChanged) chrome.setPinned(cfg.ui.titlebar_pinned);
  editor.applySettings(editorSettings());
  applyCodeMode();
  applyZen();
  applyCursorBlink();
  updateLayout();
  applySpellCheck();
  updateStats();
  await applySyntax();
  if (hiddenChanged) await tree.refresh();
}

/** Records an opened file for File → Open Recent (the settings file is left out). */
function noteRecent(path: string | null): void {
  if (!path || path === configPath) return;
  void api.addRecent(path).catch((e) => console.error("add_recent failed", e));
}

/** Remembers the files open in tabs and the active one, to be restored on next launch. */
function rememberSession(): void {
  const last = doc.path;
  const open = tabs.flatMap((tab) => (tab.path ? [tab.path] : []));
  const before = cfg.session.open_files ?? [];
  if ((cfg.session.last_file ?? null) === last && open.join("\n") === before.join("\n")) return;
  cfg.session.last_file = last;
  cfg.session.open_files = open;
  saveConfig();
}

// ---- theme ----

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
/** The macOS appearance: a first guess, replaced by the setting itself (see refreshSystemTheme). */
let systemTheme: "light" | "dark" = systemDark.matches ? "dark" : "light";

/**
 * Reads the macOS appearance setting. The app's own appearance cannot tell: setting the
 * window theme pins the whole app, and `prefers-color-scheme` and window theme events then
 * report the pin. Returns whether the appearance changed.
 */
async function refreshSystemTheme(): Promise<boolean> {
  const before = systemTheme;
  try {
    systemTheme = await api.systemAppearance();
  } catch {
    // Keep the last known appearance.
  }
  return systemTheme !== before;
}

/**
 * The theme/mode last rendered: `cfg.ui`, or a picker's preview. Pinning a previewed
 * appearance itself reports a `prefers-color-scheme` change, which must not revert the preview.
 */
let shownTheme: { theme: string; mode: Mode } | null = null;

/** macOS appearance may have changed: re-renders the shown theme if it follows it. */
function systemAppearanceChanged(): void {
  const { theme, mode } = shownTheme ?? cfg.ui;
  if (effectiveMode(theme, mode) === "system") void renderTheme(theme, mode, themePreview !== null);
}

/** Pins the window (and app) appearance, or follows macOS with null. */
function setWindowAppearance(appearance: "light" | "dark" | null): void {
  // Also drives the native traffic lights and sidebar vibrancy appearance.
  void appWindow.setTheme(appearance).catch(() => {});
}

/** The variant of a theme that defines only one, which then can't be toggled. */
let fixedVariant: "light" | "dark" | null = null;

function setFixedVariant(variant: "light" | "dark" | null): void {
  if (variant === fixedVariant) return;
  fixedVariant = variant;
  els.btnTheme.disabled = variant !== null;
  void api.setAppearanceEnabled(variant === null).catch(() => {});
}

const modeLabel = (mode: Mode) => `${mode[0].toUpperCase()}${mode.slice(1)}`;

/** Shows the appearance mode on the theme button: System, Light or Dark. */
function setModeButton(mode: Mode): void {
  els.btnTheme.innerHTML =
    mode === "system" ? icons.themeSystem : mode === "light" ? icons.themeLight : icons.themeDark;
}

function applyBuiltinTheme(mode: "system" | "light" | "dark"): void {
  setFixedVariant(null);
  clearThemeColors();
  const resolved = mode === "system" ? systemTheme : mode;
  document.documentElement.dataset.theme = resolved;
  setModeButton(mode);
  els.btnTheme.title = `Theme: ${modeLabel(mode)} (⌘⇧L)`;
  setWindowAppearance(mode === "system" ? null : mode);
}

// Sequence number drops the results of theme loads overtaken by newer ones.
let themeSeq = 0;

async function applyTheme(): Promise<void> {
  const { theme, mode } = cfg.ui;
  return renderTheme(theme, mode, false);
}

/**
 * Applies `theme`/`mode` to the window (DOM, theme button, appearance pin), in memory only:
 * callers persist `cfg.ui` themselves. A preview additionally skips the invalid-theme notice,
 * which the confirm path surfaces through the normal apply instead.
 */
async function renderTheme(theme: string, mode: Mode, preview: boolean): Promise<void> {
  const seq = ++themeSeq;
  shownTheme = { theme, mode };
  const effective = effectiveMode(theme, mode);
  const systemChanged = effective === "system" ? refreshSystemTheme() : Promise.resolve(false);
  if (theme === "kayet" || isLegacyTheme(theme)) {
    // Shown right away with the last known system appearance, corrected if that was stale.
    applyBuiltinTheme(effective);
    if ((await systemChanged) && seq === themeSeq) applyBuiltinTheme(effective);
    return;
  }
  // Theme file: the matching built-in as the base, the file's colors on top.
  let file;
  try {
    [file] = await Promise.all([api.getTheme(theme), systemChanged]);
  } catch (e) {
    await systemChanged;
    if (seq !== themeSeq) return;
    applyBuiltinTheme(effective);
    els.btnTheme.title = `Theme: ${theme} (⌘⇧L)`;
    if (!preview) notify(String(e));
    return;
  }
  if (seq !== themeSeq) return;
  // A single-variant theme is always shown in its variant; the mode is kept for other themes.
  const only = onlyVariant(file);
  setFixedVariant(only);
  const variant = only ?? (effective === "system" ? systemTheme : effective);
  const { dark, colors } = pickSection(file, variant);
  const skipped = applyThemeColors(colors);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (only) {
    els.btnTheme.innerHTML = dark ? icons.themeDark : icons.themeLight;
    els.btnTheme.title = `Theme: ${theme} · ${dark ? "Dark" : "Light"} only`;
  } else {
    setModeButton(effective);
    els.btnTheme.title = `Theme: ${theme} · ${modeLabel(effective)} (⌘⇧L)`;
  }
  setWindowAppearance(only ?? (effective === "system" ? null : variant));
  if (skipped > 0 && !preview)
    notify(`Theme '${theme}': ${skipped} invalid ${skipped === 1 ? "color" : "colors"} ignored`);
}

/**
 * The look on screen before a theme/appearance picker opened, restored when it is dismissed
 * without a choice; null while no previewing picker is open. Previewing never touches
 * `cfg.ui`, so the snapshot stays the pre-picker look until the picker closes.
 */
let themePreview: { theme: string; mode: Mode } | null = null;

/** Restores the pre-picker look after a dismissal; a no-op without an active preview. */
function cancelThemePreview(): void {
  const snapshot = themePreview;
  themePreview = null;
  if (snapshot) void renderTheme(snapshot.theme, snapshot.mode, true);
}

function switchMode(mode: Mode): void {
  cfg.ui.theme = isLegacyTheme(cfg.ui.theme) ? "kayet" : cfg.ui.theme;
  cfg.ui.mode = mode;
  void applyTheme();
  saveConfig();
}

systemDark.addEventListener("change", systemAppearanceChanged);

// ---- layout ----

/** Whether the shown document is Markdown: a `.md` file, or an untitled document written in it. */
const markdownDoc = () => isMarkdown(doc.path) || (!doc.path && doc.markdown);

const previewVisible = () => previewOpen && markdownDoc() && !largeDoc;

/** Checks soon whether the untitled document being edited became Markdown (see `markdownDoc`). */
function scheduleMarkdownCheck(): void {
  if (doc.path || doc.markdown || largeDoc || markdownTimer !== undefined) return;
  markdownTimer = window.setTimeout(checkMarkdown, 300);
}

function checkMarkdown(): void {
  window.clearTimeout(markdownTimer);
  markdownTimer = undefined;
  if (doc.path || doc.markdown || largeDoc || !looksLikeMarkdown(editor.text())) return;
  doc.markdown = true;
  updateLayout();
}

function updateLayout(): void {
  const ui = cfg.ui;
  els.app.style.setProperty("--sidebar-width", `${ui.sidebar_width}px`);
  els.app.style.setProperty("--preview-split", String(ui.preview_split));
  els.sidebar.hidden = !ui.sidebar_visible;
  els.sidebarDivider.hidden = !ui.sidebar_visible;
  els.btnSidebar.classList.toggle("on", ui.sidebar_visible);
  els.btnCloseFile.hidden = !doc.path && tabs.length < 2;

  const md = isMarkdown(doc.path);
  if (!markdownDoc()) previewOpen = false;
  if (exportEnabled !== md) {
    exportEnabled = md;
    void api.setExportEnabled(md).catch(() => {});
  }
  els.btnPreview.hidden = !markdownDoc() || largeDoc;
  els.btnPreview.classList.toggle("on", previewVisible());
  els.previewPane.hidden = !previewVisible();
  els.previewDivider.hidden = !previewVisible();
  els.app.classList.toggle("with-preview", previewVisible());
  if (!previewVisible()) preview.clear();

  if (presentation.active && !presentable()) endPresentation();
  els.btnPresent.hidden = !presentable();
  updatePresentButton();
}

function updateTitle(): void {
  const dirty = isDirty();
  els.docName.textContent = docName();
  els.docEdited.hidden = !dirty;
  els.docTitle.title = tabTooltip(doc);
  void appWindow.setTitle(`${docName()}${dirty ? " — edited" : ""}`).catch(() => {});
  updateStatus(dirty);
  renderTabs();
  scheduleStats();
}

function tabTooltip(tab: Tab): string {
  return tab.path ? (relativeTo(workspace, tab.path) ?? tab.path) : "Not saved yet";
}

/** What the tab strip shows, so it is rebuilt only when that changes (not on every keystroke). */
let tabsShown = "";

/**
 * With more than one tab open, the title bar shows a tab strip in place of the document name:
 * each tab by name, with a dot while it has unsaved changes and a close button on hover.
 */
function renderTabs(): void {
  const multiple = tabs.length > 1;
  const shown = multiple
    ? tabs.map((tab) => `${tab === doc}:${isTabDirty(tab)}:${tab.path}:${tabTooltip(tab)}`).join("\n")
    : "";
  if (shown === tabsShown) return;
  tabsShown = shown;
  els.tabs.hidden = !multiple;
  els.docTitle.hidden = multiple;
  if (!multiple) {
    els.tabs.replaceChildren();
    els.docTitle.append(els.docStats);
    return;
  }
  const items = tabs.map((tab) => {
    const item = document.createElement("div");
    item.className = "tab";
    item.role = "tab";
    item.title = tabTooltip(tab);
    item.setAttribute("aria-selected", String(tab === doc));
    item.classList.toggle("edited", isTabDirty(tab));
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = tabName(tab);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.innerHTML = icons.closeFile;
    close.title = "Close tab";
    close.setAttribute("aria-label", `Close ${tabName(tab)}`);
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      void closeTab(tab).catch(showError);
    });
    item.append(name, close);
    item.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    item.addEventListener("click", () => void activate(tab).catch(showError));
    item.addEventListener("auxclick", (e) => {
      if (e.button === 1) void closeTab(tab).catch(showError);
    });
    return item;
  });
  els.tabs.replaceChildren(...items, els.docStats);
  els.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * Title bar word count and reading time, for prose (not code files, not in code editor mode,
 * not large files); counted only while the title bar shows.
 */
function updateStats(): void {
  window.clearTimeout(statsTimer);
  statsTimer = undefined;
  const stats = isCode(doc.path) || cfg?.ui.code_mode || largeDoc ? "" : formatStats(countWords(editor.text()));
  els.docStats.textContent = stats;
  els.docStats.hidden = !stats;
}

function scheduleStats(): void {
  if (!chrome.isVisible || statsTimer !== undefined) return;
  statsTimer = window.setTimeout(updateStats, 300);
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

/** Zen mode per the setting; unavailable in code editor mode. */
function applyZen(): void {
  const code = cfg.ui.code_mode;
  const on = cfg.ui.zen_mode && !code;
  void api.setMenuCheck("toggle-zen", !code, on).catch(() => {});
  els.app.classList.toggle("zen", on);
  els.btnZen.hidden = code;
  els.btnZen.classList.toggle("on", on);
  els.btnZen.setAttribute("aria-pressed", String(on));
  editor.setZen(on);
}

function toggleZen(): void {
  if (cfg.ui.code_mode) return;
  cfg.ui.zen_mode = !cfg.ui.zen_mode;
  applyZen();
  saveConfig();
  editor.focus();
}

/** Code editor mode: line numbers, no paddings or wrapping; zen mode and spell check are off meanwhile. */
function applyCodeMode(): void {
  const on = cfg.ui.code_mode;
  void api.setMenuCheck("toggle-code-mode", true, on).catch(() => {});
  els.btnCode.classList.toggle("on", on);
  els.btnCode.setAttribute("aria-pressed", String(on));
  els.btnCode.title = on ? "Code editor mode: on" : "Code editor mode: off";
  editor.setCodeMode(on);
}

/** Toggles code editor mode, turning syntax highlighting on or off with it. */
function toggleCodeMode(): void {
  cfg.ui.code_mode = !cfg.ui.code_mode;
  cfg.editor.syntax_highlighting = cfg.ui.code_mode;
  applyCodeMode();
  applyZen();
  applySpellCheck();
  void applySyntax().catch(showError);
  updateStats();
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
  if (!markdownDoc()) return;
  if (largeDoc) return notify("Preview is off for large files");
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

// ---- presentation ----

/** Markdown files and untitled documents can be presented as slides (not large ones). */
const presentable = () => (!doc.path || isMarkdown(doc.path)) && !largeDoc;

function updatePresentButton(): void {
  const on = presentation.active;
  els.btnPresent.innerHTML = on ? icons.exitPresent : icons.present;
  els.btnPresent.title = on ? "Exit presentation (Esc)" : "Present slides";
  els.btnPresent.setAttribute("aria-label", els.btnPresent.title);
}

/** Enters presentation mode (the document as edited, unsaved changes included) or leaves it. */
function togglePresentation(): void {
  if (presentation.active) {
    endPresentation();
    editor.focus();
    return;
  }
  if (!presentable()) return;
  document.body.classList.add("presenting");
  presentation.start(editor.text(), doc.path);
  updatePresentButton();
}

function endPresentation(): void {
  if (!presentation.active) return;
  presentation.stop();
  document.body.classList.remove("presenting");
  updatePresentButton();
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
 * setting, large files never. Code grammars load lazily, so they are applied once ready. The
 * toggle is offered for code files, and for every file in code editor mode.
 */
async function applySyntax(): Promise<void> {
  const seq = ++syntaxSeq;
  const code = isCode(doc.path);
  const available = (code || cfg.ui.code_mode) && !largeDoc;
  const on = cfg.editor.syntax_highlighting;
  void api.setMenuCheck("toggle-syntax", available, on).catch(() => {});
  els.btnSyntax.hidden = !available;
  els.btnSyntax.classList.toggle("on", on);
  els.btnSyntax.setAttribute("aria-pressed", String(on));
  if (largeDoc) return editor.setSyntax(null);
  if (isMarkdown(doc.path)) return editor.setSyntax("markdown");
  const lang = code && on ? await codeLanguage(doc.path) : null;
  if (seq === syntaxSeq) editor.setSyntax(lang);
}

function toggleSyntax(): void {
  if ((!isCode(doc.path) && !cfg.ui.code_mode) || largeDoc) return;
  cfg.editor.syntax_highlighting = !cfg.editor.syntax_highlighting;
  saveConfig();
  void applySyntax();
}

/**
 * Spell check for prose (Markdown, plain text, untitled — not code files), per the setting;
 * unavailable in code editor mode.
 */
function applySpellCheck(): void {
  const prose = !isCode(doc.path) && !cfg.ui.code_mode;
  const on = cfg.editor.spell_check && !cfg.ui.code_mode;
  void api.setMenuCheck("toggle-spell-check", prose, on).catch(() => {});
  els.btnSpell.hidden = !prose;
  els.btnSpell.classList.toggle("on", on);
  els.btnSpell.setAttribute("aria-pressed", String(on));
  els.btnSpell.title = on ? "Spell check: on" : "Spell check: off";
  editor.setSpellCheck(prose && on);
}

function toggleSpellCheck(): void {
  if (isCode(doc.path) || cfg.ui.code_mode) return;
  cfg.editor.spell_check = !cfg.editor.spell_check;
  applySpellCheck();
  saveConfig();
  editor.focus();
}

/** Updates `largeDoc` for the shown document; returns true if it changed. */
function checkLarge(): boolean {
  const large = editor.doc.length > LARGE_DOC;
  if (large === largeDoc) return false;
  largeDoc = large;
  return true;
}

/** Switches the shown document into or out of large file mode after an edit. */
function applyLarge(): void {
  void applySyntax().catch(showError);
  updateLayout();
  if (largeDoc) notifyLarge();
}

function notifyLarge(): void {
  notify("Large file: preview, highlighting and word count are off");
}

/** Shows `text` as the current document; `recent` records the file for File → Open Recent. */
function loadDoc(path: string | null, text: string, recent = true): void {
  endPresentation();
  doc.path = path;
  doc.disk = text;
  doc.savedOnce = false;
  doc.markdown = false;
  window.clearTimeout(markdownTimer);
  markdownTimer = undefined;
  applySpellCheck();
  editor.load(text, isMarkdown(path) && text.length <= LARGE_DOC ? "markdown" : null);
  checkLarge();
  if (largeDoc) notifyLarge();
  void applySyntax().catch(showError);
  doc.saved = editor.doc;
  hideBanner();
  rememberSession();
  if (recent) noteRecent(path);
  updateAll();
  syncBackup();
  if (previewVisible()) void preview.render(text, path);
  editor.focus();
}

function setDocPath(path: string): void {
  doc.path = path;
  applySpellCheck();
  void applySyntax().catch(showError);
  rememberSession();
  noteRecent(path);
  updateAll();
}

/** Asks to save unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const choice = await chrome.hold(api.confirmUnsaved(docName()));
  if (choice === "save") return save();
  return choice === "discard";
}

/** Shows `tab`, putting the current document aside. */
async function activate(tab: Tab): Promise<void> {
  if (tab === doc) return editor.focus();
  endPresentation();
  if (tabs.includes(doc)) {
    await flushAutosave();
    doc.editor = editor.snapshot();
  }
  doc = tab;
  if (tab.editor) editor.restore(tab.editor);
  else editor.load("", null);
  tab.editor = null;
  checkLarge();
  els.banner.hidden = tab.pendingDisk === null;
  applySpellCheck();
  void applySyntax().catch(showError);
  rememberSession();
  updateAll();
  if (previewVisible()) {
    void preview.render(editor.text(), doc.path).then(syncPreview);
  }
  editor.focus();
  void checkDiskChange();
}

/** Opens a new tab next to the current one (with an empty untitled document) and shows it. */
async function addTab(): Promise<void> {
  const tab = newTab();
  tabs.splice(tabs.indexOf(doc) + 1, 0, tab);
  await activate(tab);
  loadDoc(null, "");
}

/** Whether an opened file gets a tab of its own rather than replacing the current document. */
const opensInNewTab = () => cfg.ui.open_in_new_tab && !isBlank(doc);

/**
 * Opens `path`: shows its tab if it is open already, else opens it in a new tab or in place
 * of the current document (asking to save unsaved changes first), per `open_in_new_tab`.
 * Resolves to whether it is now open.
 */
async function openFile(path: string): Promise<boolean> {
  const open = tabs.find((tab) => tab.path === path);
  if (open) {
    await activate(open);
    return true;
  }
  const inNewTab = opensInNewTab();
  if (!inNewTab && !(await confirmDiscard())) return false;
  let text: string;
  try {
    text = await api.readFile(path);
  } catch (e) {
    notify(String(e));
    return false;
  }
  if (inNewTab) await addTab();
  loadDoc(path, text);
  return true;
}

async function openWithDialog(): Promise<void> {
  const path = await chrome.hold(api.openFileDialog());
  if (path) await openFile(path);
}

/** A new untitled document, in a new tab or in place of the current one (see `open_in_new_tab`). */
async function newDoc(): Promise<void> {
  if (opensInNewTab()) return addTab();
  if (!(await confirmDiscard())) return;
  loadDoc(null, "");
}

/**
 * Closes `tab` (asking to save unsaved changes first) and shows its neighbor. The last tab
 * is not closed but left with an empty untitled document. Resolves to false if cancelled.
 */
async function closeTab(tab: Tab = doc): Promise<boolean> {
  if (isTabDirty(tab)) {
    await activate(tab);
    if (!(await confirmDiscard())) return false;
  }
  if (tabs.length === 1) {
    loadDoc(null, "");
    return true;
  }
  const at = tabs.indexOf(tab);
  tabs.splice(at, 1);
  if (tab === doc) {
    window.clearTimeout(autosaveTimer);
    await activate(tabs[Math.min(at, tabs.length - 1)]);
  } else {
    rememberSession();
    updateAll();
  }
  void syncBackup();
  return true;
}

/** Shows the next (`step` 1) or previous (-1) tab, wrapping around. */
function cycleTab(step: number): Promise<void> {
  const at = tabs.indexOf(doc);
  return activate(tabs[(at + step + tabs.length) % tabs.length]);
}

/** Asks about the unsaved changes of every tab. Returns false if the user cancelled. */
async function confirmDiscardAll(): Promise<boolean> {
  for (const tab of [...tabs]) {
    if (!isTabDirty(tab)) continue;
    await activate(tab);
    if (!(await confirmDiscard())) return false;
  }
  return true;
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

/** Exports the open Markdown file (as currently edited) to a file picked by the user. */
async function exportDoc(format: "html" | "pdf"): Promise<void> {
  const path = doc.path;
  if (!path || !isMarkdown(path)) return;
  const stem = basename(path).replace(/\.(md|markdown)$/i, "");
  const out = await chrome.hold(api.saveFileDialog(dirname(path), `${stem}.${format}`));
  if (!out) return;
  if (out === path) return notify("Choose another file name for the export");
  const text = editor.text();
  if (format === "html") await exportHtml(text, path, out, stem);
  else await chrome.hold(exportPdf(text, path, out, els.print));
  notify(`Exported ${basename(out)}`);
}

function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = undefined;
  if (!cfg?.editor.autosave || !doc.path) return;
  autosaveTimer = window.setTimeout(() => void flushAutosave(), 1000);
}

/** Saves right away what autosave is waiting to save (before another tab is shown). */
async function flushAutosave(): Promise<void> {
  if (autosaveTimer === undefined) return;
  window.clearTimeout(autosaveTimer);
  autosaveTimer = undefined;
  if (doc.path && isDirty()) await save();
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

/** When the first edit not backed up yet was made. */
let backupPendingSince = 0;
/** A large backup waits for this long a pause in typing, but at most `LARGE_BACKUP_MAX_WAIT_MS`. */
const LARGE_BACKUP_IDLE_MS = 2000;
const LARGE_BACKUP_MAX_WAIT_MS = 30_000;

/**
 * Backs up the buffer within a second of an edit, also while typing continuously. Large ones
 * take long enough to back up to be felt, so they wait for typing to pause (but not forever).
 */
function scheduleBackup(): void {
  const pending = backupTimer !== undefined;
  const large = largeBackup();
  if (pending && !large) return;
  const now = Date.now();
  if (!pending) backupPendingSince = now;
  window.clearTimeout(backupTimer);
  const delay = large ? Math.min(LARGE_BACKUP_IDLE_MS, backupPendingSince + LARGE_BACKUP_MAX_WAIT_MS - now) : 1000;
  backupTimer = window.setTimeout(syncBackup, Math.max(0, delay));
}

/** Whether the tabs with unsaved changes together make a large backup (see `LARGE_DOC`). */
function largeBackup(): boolean {
  let length = 0;
  for (const tab of tabs) if (isTabDirty(tab)) length += textOf(tab).length;
  return length > LARGE_DOC;
}

/** Backs up the tabs with unsaved changes and removes the backup once there are none. */
function syncBackup(): Promise<void> {
  window.clearTimeout(backupTimer);
  backupTimer = undefined;
  const dirty = tabs.filter(isTabDirty);
  if (dirty.length) {
    backedUp = true;
    const backups = dirty.map((tab) => ({
      path: tab.path,
      text: tab === doc ? editor.text() : (tab.editor?.state.sliceDoc() ?? ""),
    }));
    return queueBackup(() => api.writeRecovery(backups));
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
 * Offers to restore the buffers backed up by a session that did not exit cleanly, each in a
 * tab of its own. Returns true if they were restored.
 */
async function restoreBackups(backups: Backup[]): Promise<boolean> {
  const name = backups[0].path ? basename(backups[0].path) : "Untitled";
  if (!(await chrome.hold(api.confirmRestore(name, backups.length - 1)))) {
    await clearBackup();
    return false;
  }
  for (const [i, backup] of backups.entries()) {
    if (i > 0) await addTab();
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
  }
  // Rewrites the backup right away, or removes it if the texts match the files after all.
  backedUp = true;
  await syncBackup();
  return true;
}

// ---- external changes ----

/** Reloads the shown file if it changed on disk, or offers to (see the banner) if it has unsaved changes. */
async function checkDiskChange(): Promise<void> {
  const tab = doc;
  const path = tab.path;
  if (!path) return;
  let text: string;
  try {
    text = await api.readFile(path);
  } catch {
    return; // deleted or unreadable: keep the buffer as it is
  }
  // Another tab shown meanwhile: this one is checked again once it is shown.
  if (tab !== doc || path !== tab.path || text === tab.disk) return;
  if (!isDirty()) {
    tab.disk = text;
    editor.replaceText(text);
    tab.saved = editor.doc;
    updateTitle();
  } else {
    tab.pendingDisk = text;
    els.banner.hidden = false;
  }
}

function hideBanner(): void {
  els.banner.hidden = true;
  doc.pendingDisk = null;
}

els.bannerReload.addEventListener("click", () => {
  if (doc.pendingDisk === null) return hideBanner();
  const text = doc.pendingDisk;
  doc.disk = text;
  editor.replaceText(text);
  doc.saved = editor.doc;
  hideBanner();
  updateTitle();
  editor.focus();
});

els.bannerKeep.addEventListener("click", () => {
  if (doc.pendingDisk !== null) doc.disk = doc.pendingDisk;
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

/** Restarts into the kayet `version` just installed, once unsaved changes are dealt with. */
async function restartToUpdate(version: string): Promise<void> {
  if (!(await confirmDiscardAll())) {
    notify(`kayet ${version} is installed and starts the next time you open kayet.`);
    return;
  }
  await clearBackup();
  await api.restartApp();
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
  "export-html": () => exportDoc("html"),
  "export-pdf": () => exportDoc("pdf"),
  "new-tab": addTab,
  "close-file": () => closeTab(),
  "next-tab": () => cycleTab(1),
  "prev-tab": () => cycleTab(-1),
  close: () => appWindow.close(),
  quit: () => appWindow.close(),
  undo: () => (inTextField() ? document.execCommand("undo") : editor.undo()),
  redo: () => (inTextField() ? document.execCommand("redo") : editor.redo()),
  find: () => editor.find(),
  replace: () => editor.replace(),
  "toggle-tree": toggleTree,
  "toggle-preview": togglePreview,
  "toggle-presentation": togglePresentation,
  "open-settings": openSettings,
  "install-cli": installCli,
  "check-updates": () => api.checkForUpdates(),
  "cycle-appearance": toggleAppearance,
  "switch-theme": toggleThemes,
  "toggle-chrome": () => chrome.togglePinned(),
  "toggle-zen": toggleZen,
  "toggle-code-mode": toggleCodeMode,
  "toggle-cursor-blink": toggleCursorBlink,
  "toggle-syntax": toggleSyntax,
  "toggle-spell-check": toggleSpellCheck,
  "zoom-in": () => zoom(1),
  "zoom-out": () => zoom(-1),
  "zoom-reset": () => zoom("reset"),
  palette: togglePalette,
  "go-to-file": toggleFileFinder,
  "open-recent": toggleRecent,
  "find-in-workspace": toggleWorkspaceSearch,
};

// ---- command palette ----

const palette = new Palette(() => {
  // Dismissal without a choice (Esc, outside click, blur, shortcut re-press); a no-op for
  // other lists and, on confirm, overtaken at once by the pick applying the choice.
  cancelThemePreview();
  editor.focus();
});

/** Everything the palette offers, in menu order; context-only commands appear when they apply. */
function paletteCommands(): PaletteItem[] {
  const md = isMarkdown(doc.path);
  const code = isCode(doc.path);
  const codeMode = cfg.ui.code_mode;
  const list: (PaletteItem | false)[] = [
    { id: "new", label: "New File", shortcut: "⌘N" },
    { id: "new-tab", label: "New Tab", shortcut: "⌘T" },
    { id: "open", label: "Open File…", shortcut: "⌘O" },
    { id: "open-recent", label: "Open Recent…" },
    { id: "go-to-file", label: "Go to File…", shortcut: "⌘P" },
    { id: "open-workspace", label: "Open Workspace…", shortcut: "⌘⇧O" },
    { id: "reset-workspace", label: "Reset to Default Workspace" },
    { id: "save", label: "Save", shortcut: "⌘S" },
    { id: "save-as", label: "Save As…", shortcut: "⌘⇧S" },
    md && { id: "export-html", label: "Export as HTML…" },
    md && { id: "export-pdf", label: "Export as PDF…" },
    (!!doc.path || tabs.length > 1) && { id: "close-file", label: "Close File", shortcut: "⌘W" },
    tabs.length > 1 && { id: "next-tab", label: "Show Next Tab", shortcut: "⌃⇥" },
    tabs.length > 1 && { id: "prev-tab", label: "Show Previous Tab", shortcut: "⌃⇧⇥" },
    { id: "undo", label: "Undo", shortcut: "⌘Z" },
    { id: "redo", label: "Redo", shortcut: "⌘⇧Z" },
    { id: "find", label: "Find…", shortcut: "⌘F" },
    { id: "replace", label: "Replace…", shortcut: "⌘R" },
    { id: "find-in-workspace", label: "Find in Workspace…", shortcut: "⌘⇧F" },
    {
      id: "toggle-tree",
      label: cfg.ui.sidebar_visible ? "Hide File Tree" : "Show File Tree",
      shortcut: "⌘\\",
    },
    markdownDoc() && !largeDoc && {
      id: "toggle-preview",
      label: previewVisible() ? "Hide Preview" : "Show Preview",
      shortcut: "⌘⇧P",
    },
    (presentable() || presentation.active) && {
      id: "toggle-presentation",
      label: presentation.active ? "Exit Presentation" : "Start Presentation",
    },
    !fixedVariant && { id: "cycle-appearance", label: "Switch Appearance…", shortcut: "⌘⇧L" },
    { id: "switch-theme", label: "Switch Theme…" },
    { id: "toggle-chrome", label: "Keep Title Bar Visible", shortcut: "⌘." },
    !codeMode && { id: "toggle-zen", label: cfg.ui.zen_mode ? "Exit Zen Mode" : "Zen Mode", shortcut: "⌘⇧J" },
    { id: "toggle-code-mode", label: codeMode ? "Exit Code Editor Mode" : "Code Editor Mode" },
    {
      id: "toggle-cursor-blink",
      label: cfg.editor.cursor === "blink" ? "Disable Cursor Blink" : "Enable Cursor Blink",
    },
    (code || codeMode) && !largeDoc && {
      id: "toggle-syntax",
      label: cfg.editor.syntax_highlighting ? "Disable Syntax Highlighting" : "Enable Syntax Highlighting",
    },
    !code && !codeMode && {
      id: "toggle-spell-check",
      label: cfg.editor.spell_check ? "Disable Spell Check" : "Enable Spell Check",
    },
    { id: "zoom-in", label: "Zoom In", shortcut: "⌘+" },
    { id: "zoom-out", label: "Zoom Out", shortcut: "⌘−" },
    { id: "zoom-reset", label: "Actual Size", shortcut: "⌘0" },
    { id: "open-settings", label: "Settings…", shortcut: "⌘," },
    { id: "install-cli", label: "Install ‘kayet’ Command" },
    { id: "check-updates", label: "Check for Updates…" },
    { id: "close", label: "Close Window", shortcut: "⌘⇧W" },
    { id: "quit", label: "Quit kayet", shortcut: "⌘Q" },
  ];
  return list.filter((c): c is PaletteItem => !!c);
}

/** Opens the palette with `items`, switches it to them, or closes it if it shows them already. */
async function showPalette(items: PaletteItem[], options: PaletteOptions): Promise<void> {
  if (palette.showing === options.kind) return palette.close();
  // Switching lists bypasses Palette.close, so a theme/appearance preview is reverted here;
  // the two previewing pickers revert it themselves before snapshotting the pre-picker look.
  if (!options.onHighlight) cancelThemePreview();
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

/** Recently opened files (but the open one), labeled by name with their folder as detail. */
async function toggleRecent(): Promise<void> {
  if (palette.showing === "recent") return palette.close();
  const files = (await api.recentFiles()).filter((path) => path !== doc.path);
  const items = files.map((path) => {
    const dir = dirname(path);
    return { id: path, label: basename(path), detail: relativeTo(workspace, dir) ?? dir };
  });
  await showPalette(items, {
    kind: "recent",
    placeholder: "Open recent…",
    empty: files.length ? "No matching files" : "No recent files",
    pick: (path) => void api.allowRecent(path).then(openFile).catch(showError),
  });
}

/** Switch palette: the built-in one plus every theme file, the current one marked. */
async function toggleThemes(): Promise<void> {
  if (palette.showing === "themes") return palette.close();
  const listed = await api.listThemes();
  // A preview from the appearance picker is reverted first (list switches bypass close).
  // Snapshot only after the await: nothing yields between here and open, so no
  // interleaved dismiss can disarm the restore before the picker opens.
  cancelThemePreview();
  themePreview = { theme: cfg.ui.theme, mode: cfg.ui.mode };
  await showPalette(themeItems(listed, cfg.ui.theme), {
    kind: "themes",
    placeholder: "Switch theme…",
    empty: "No matching themes",
    pick: (name) => switchTheme(name),
    onHighlight: (name) => void renderTheme(name, cfg.ui.mode, true),
  });
}

function switchTheme(name: string): void {
  cfg.ui.theme = name;
  void applyTheme();
  saveConfig();
}

/** Appearance picker: System / Light / Dark, the current mode marked, the next preselected. */
async function toggleAppearance(): Promise<void> {
  if (fixedVariant) return;
  if (palette.showing === "appearance") return palette.close();
  // A preview from the themes picker is reverted first (list switches bypass close).
  cancelThemePreview();
  themePreview = { theme: cfg.ui.theme, mode: cfg.ui.mode };
  const current = effectiveMode(cfg.ui.theme, cfg.ui.mode);
  const next = nextMode(cfg.ui.theme, cfg.ui.mode).mode;
  const items = modeItems(current);
  await showPalette(items, {
    kind: "appearance",
    placeholder: "Switch appearance…",
    empty: "No matching modes",
    selected: items.findIndex((item) => item.id === next),
    pick: (mode) => switchMode(mode as Mode),
    // Like switchMode, previewed against the kayet palette for a legacy theme value.
    onHighlight: (mode) =>
      void renderTheme(isLegacyTheme(cfg.ui.theme) ? "kayet" : cfg.ui.theme, mode as Mode, true),
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
els.btnRecent.addEventListener("click", () => run("open-recent"));
els.btnPin.addEventListener("click", () => run("toggle-chrome"));
els.btnZen.addEventListener("click", () => run("toggle-zen"));
els.btnCode.addEventListener("click", () => run("toggle-code-mode"));
els.btnBlink.addEventListener("click", () => run("toggle-cursor-blink"));
els.btnSidebar.addEventListener("click", () => run("toggle-tree"));
els.btnWorkspace.addEventListener("click", () => run("open-workspace"));
els.btnSettings.addEventListener("click", () => run("open-settings"));
els.btnTheme.addEventListener("click", () => run("cycle-appearance"));
els.btnPreview.addEventListener("click", () => run("toggle-preview"));
els.btnPresent.addEventListener("click", () => run("toggle-presentation"));
els.btnSyntax.addEventListener("click", () => run("toggle-syntax"));
els.btnSpell.addEventListener("click", () => run("toggle-spell-check"));
els.btnCloseFile.addEventListener("click", () => run("close-file"));
els.btnNewTab.addEventListener("click", () => run("new-tab"));
els.btnStatus.addEventListener("click", () => void promptSave().catch(showError));
els.edgeHandle.addEventListener("click", () => run("toggle-tree"));

els.btnPalette.innerHTML = icons.command;
els.btnRecent.innerHTML = icons.recent;
els.btnPin.innerHTML = icons.pin;
els.btnZen.innerHTML = icons.zen;
els.btnCode.innerHTML = icons.lineNumbers;
els.btnBlink.innerHTML = icons.cursor;
els.btnSidebar.innerHTML = icons.sidebar;
els.btnWorkspace.innerHTML = icons.folder;
els.btnSettings.innerHTML = icons.settings;
els.btnPreview.innerHTML = icons.eye;
els.slidePrev.innerHTML = icons.chevronLeft;
els.slideNext.innerHTML = icons.chevronRight;
els.slideFirst.innerHTML = icons.toStart;
els.btnSyntax.innerHTML = icons.code;
els.btnSpell.innerHTML = icons.spell;
els.btnCloseFile.innerHTML = icons.closeFile;
els.btnNewTab.innerHTML = icons.newTab;

// ⌃⇥ / ⌃⇧⇥ switch tabs, like ⇧⌘] / ⇧⌘[ (Window menu).
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    run(e.shiftKey ? "prev-tab" : "next-tab");
  },
  true,
);

// Keep the default browser context menu out of the editor chrome.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest(".cm-editor, input")) e.preventDefault();
});
// Dropped files are handled natively (see `file://dropped`); never navigate away.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

window.addEventListener("resize", () => preview.measure());

// ---- startup ----

/**
 * Opens the documents kayet starts with: the files open in tabs last time (showing the one
 * that was active), or an empty untitled document.
 */
async function openSession(): Promise<void> {
  const last = cfg.session.last_file ?? null;
  const files = cfg.session.open_files?.length ? cfg.session.open_files : last ? [last] : [];
  const texts = await Promise.all(files.map((path) => api.readFile(path).catch(() => null)));
  let active: Tab | null = null;
  for (const [i, path] of files.entries()) {
    const text = texts[i];
    if (text === null) continue; // gone since: dropped from the session
    if (!isBlank(doc)) await addTab();
    // Only the active file is recorded again, so the recent files keep their order.
    loadDoc(path, text, path === last);
    if (path === last) active = doc;
  }
  if (active) await activate(active);
  else if (!isBlank(doc)) await activate(tabs[0]);
  else loadDoc(null, "");
}

async function init(): Promise<void> {
  cfg = await api.getConfig();
  workspace = await api.getWorkspace();
  configPath = await api.configFile();
  systemTheme = systemDark.matches ? "dark" : "light";
  void applyTheme();
  if (cfg.ui.titlebar_pinned) chrome.setPinned(true);
  editor.applySettings(editorSettings());
  applyCodeMode();
  applyZen();
  applyCursorBlink();
  updateAll();

  await Promise.all([
    listen<string>("menu", (e) => run(e.payload)),
    listen<{ paths: string[] }>("fs://changed", (e) => {
      void tree.refresh();
      if (doc.path && e.payload.paths.includes(doc.path)) void checkDiskChange();
    }),
    listen<string>("theme://changed", systemAppearanceChanged),
    listen<string>("notice", (e) => notify(e.payload)),
    listen<{ path: string }>("file://dropped", (e) => void openFile(e.payload.path)),
    listen<Opened>("open://requested", (e) => void openRequested(e.payload).catch(showError)),
    listen<string>("update://installed", (e) => void restartToUpdate(e.payload).catch(showError)),
    appWindow.onCloseRequested(async (event) => {
      if (!(await confirmDiscardAll())) return event.preventDefault();
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

  // Unsaved changes left behind by a crash take the place of the start documents.
  const backups = await api.loadRecovery().catch(() => []);
  if (!backups.length || !(await restoreBackups(backups))) {
    await openSession();
    // Launched to open a file: it wins over the session's active document.
    if (opened.file) await openFile(opened.file);
  }

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
      showChrome: () => chrome.setPinned(true),
      type: (text) => editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: "input.type" }),
    });
  })
  .catch((e) => {
    console.error(e);
    notify(`kayet failed to start: ${e}`);
  });
