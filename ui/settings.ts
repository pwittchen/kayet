// Settings: a panel of controls for `~/.kayet/config.toml`, each change applied right away.

import { Config, Mode } from "./api";
import { Dropdown, DropdownOption } from "./dropdown";
import { icons } from "./icons";
import { effectiveMode, isLegacyTheme } from "./theme";

export interface SettingsCallbacks {
  /** Esc was pressed, the close button used or the scrim clicked: hide the panel. */
  exit: () => void;
  /** "Edit as Text" was clicked: close the panel and open config.toml in the editor. */
  editFile: () => void;
  /** A control changed: `edit` updates the config, which is then saved and applied. */
  change: (edit: (cfg: Config) => void) => void;
  /** "Change…" next to the workspace folder was clicked. */
  changeWorkspace: () => void;
  /** "Set to Default" next to the workspace folder was clicked: go back to ~/.kayet/workspace. */
  resetWorkspace: () => void;
  /** "Check for Updates…" was clicked: run an update check (its result comes as a dialog). */
  checkUpdates: () => void;
  /** The config as it is now. */
  config: () => Config;
  /** The workspace folder shown. */
  workspace: () => string;
  /** Whether the theme has a single variant, so the appearance mode can't be switched. */
  themeFixed: () => boolean;
}

const MODES: DropdownOption[] = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

const FONTS: DropdownOption[] = [
  ["mono", "Monospace (SF Mono)"],
  ["system", "System (SF Pro)"],
  ["custom", "Custom…"],
];

/** The tabs' icons, in the order of the sections. */
const TAB_ICONS = [icons.themeSystem, icons.editor, icons.window, icons.folder, icons.updates];

/** A number setting: its range, and the step values are rounded to. */
interface NumberSpec {
  min: number;
  max: number;
  step: number;
}

/**
 * The Settings panel, centred over the dimmed window like About. Controls write straight into
 * the config through `change`; `sync` brings them up to date after it changed elsewhere (menu
 * commands, the config file).
 */
export class Settings {
  /** Brings each control up to date with the config; the focused one is left alone. */
  private syncs: (() => void)[] = [];
  /** Whether "Custom…" was picked for the font while the setting still names a keyword. */
  private customFont = false;
  /** The dropdowns shown, whose open lists close with the panel. */
  private dropdowns: Dropdown[] = [];
  /** The tab shown; kept while kayet runs, so the panel reopens where it was left. */
  private tab = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly body: HTMLElement,
    private readonly cb: SettingsCallbacks,
  ) {
    root.addEventListener("click", (e) => {
      if (e.target === root) this.cb.exit();
    });
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
    for (const d of this.dropdowns) d.hide();
    this.root.hidden = true;
  }

  /**
   * Shows the panel; `themes` are the theme files there are (besides the built-in one),
   * `version` the running kayet's.
   */
  show(themes: string[], version: string): void {
    this.hide();
    this.syncs = [];
    this.dropdowns = [];
    this.customFont = false;
    this.body.replaceChildren(...this.content(themes, version));
    this.sync();
    this.root.hidden = false;
    this.root.focus();
  }

  sync(): void {
    for (const sync of this.syncs) sync();
  }

  private get cfg(): Config {
    return this.cb.config();
  }

  private content(themes: string[], version: string): HTMLElement[] {
    const file = document.createElement("div");
    file.className = "settings-file";
    const note = document.createElement("span");
    note.textContent = "Saved to ~/.kayet/config.toml";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "settings-link";
    edit.textContent = "Edit as Text File";
    edit.addEventListener("click", () => this.cb.editFile());
    file.append(note, edit);

    const sections = [
      section(
        "Appearance",
        this.select(
          "Theme",
          ["kayet", ...themes.filter((t) => t !== "kayet")].map((t) => [t, t]),
          (c) => (isLegacyTheme(c.ui.theme) ? "kayet" : c.ui.theme),
          (c, theme) => {
            c.ui.mode = effectiveMode(c.ui.theme, c.ui.mode);
            c.ui.theme = theme;
          },
        ),
        this.select(
          "Appearance",
          MODES,
          (c) => effectiveMode(c.ui.theme, c.ui.mode),
          (c, mode) => {
            if (isLegacyTheme(c.ui.theme)) c.ui.theme = "kayet";
            c.ui.mode = mode as Mode;
          },
          () => this.cb.themeFixed(),
        ),
        ...this.font(),
        this.number("Font size", { min: 8, max: 40, step: 1 }, (c) => c.editor.font_size, (c, v) => (c.editor.font_size = v)),
        this.number(
          "Line height",
          { min: 1, max: 3, step: 0.05 },
          (c) => c.editor.line_height,
          (c, v) => (c.editor.line_height = v),
        ),
        this.toggle(
          "Blinking cursor",
          (c) => c.editor.cursor === "blink",
          (c, on) => (c.editor.cursor = on ? "blink" : "steady"),
        ),
      ),
      section(
        "Editor",
        this.toggle("Wrap lines", (c) => c.editor.soft_wrap, (c, on) => (c.editor.soft_wrap = on)),
        this.number(
          "Line width (characters)",
          { min: 20, max: 400, step: 1 },
          (c) => c.editor.max_line_width,
          (c, v) => (c.editor.max_line_width = v),
        ),
        this.toggle("Autosave", (c) => c.editor.autosave, (c, on) => (c.editor.autosave = on)),
        this.toggle(
          "Syntax highlighting",
          (c) => c.editor.syntax_highlighting,
          (c, on) => (c.editor.syntax_highlighting = on),
        ),
        this.toggle(
          "Spell check",
          (c) => c.editor.spell_check,
          (c, on) => (c.editor.spell_check = on),
          (c) => c.ui.code_mode,
        ),
        this.toggle(
          "Code editor mode",
          (c) => c.ui.code_mode,
          // Like the title bar toggle: highlighting goes on and off with it.
          (c, on) => {
            c.ui.code_mode = on;
            c.editor.syntax_highlighting = on;
          },
        ),
        this.toggle("Zen mode", (c) => c.ui.zen_mode, (c, on) => (c.ui.zen_mode = on), (c) => c.ui.code_mode),
      ),
      section(
        "Window",
        this.toggle("Show file tree", (c) => c.ui.sidebar_visible, (c, on) => (c.ui.sidebar_visible = on)),
        this.toggle("Keep title bar visible", (c) => c.ui.titlebar_pinned, (c, on) => (c.ui.titlebar_pinned = on)),
        this.toggle("Open files in new tabs", (c) => c.ui.open_in_new_tab, (c, on) => (c.ui.open_in_new_tab = on)),
        this.toggle(
          "Reveal slides step by step",
          (c) => c.ui.presentation_steps,
          (c, on) => (c.ui.presentation_steps = on),
        ),
      ),
      section(
        "Workspace",
        this.workspace(),
        this.toggle(
          "Show hidden files",
          (c) => c.workspace.show_hidden_files,
          (c, on) => (c.workspace.show_hidden_files = on),
        ),
      ),
      section(
        "Updates",
        this.version(version),
        this.toggle(
          "Check for updates automatically",
          (c) => c.updates.check_automatically,
          (c, on) => (c.updates.check_automatically = on),
        ),
      ),
    ];
    const [bar, ...panes] = this.tabs(sections);
    return [bar, file, ...panes];
  }

  /**
   * A toolbar of tabs over the sections (an icon above each name, like a Mac settings window),
   * of which the chosen one is shown.
   */
  private tabs(sections: HTMLElement[]): HTMLElement[] {
    const bar = document.createElement("div");
    bar.className = "settings-tabs";
    bar.setAttribute("role", "tablist");
    this.tab = Math.min(this.tab, sections.length - 1);
    const buttons = sections.map((pane, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-tab";
      button.setAttribute("role", "tab");
      const label = document.createElement("span");
      label.textContent = pane.dataset.title ?? "";
      button.innerHTML = TAB_ICONS[i] ?? "";
      button.append(label);
      button.id = `settings-tab-${i}`;
      pane.id = `settings-pane-${i}`;
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute("aria-labelledby", button.id);
      button.setAttribute("aria-controls", pane.id);
      button.addEventListener("click", () => select(i));
      return button;
    });
    const select = (i: number) => {
      this.tab = i;
      for (const d of this.dropdowns) d.hide();
      buttons.forEach((b, j) => {
        b.setAttribute("aria-selected", String(j === i));
        b.tabIndex = j === i ? 0 : -1;
        sections[j].hidden = j !== i;
      });
    };
    // Arrow keys move between the tabs, like a native tab bar.
    bar.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const i = (this.tab + step + sections.length) % sections.length;
      select(i);
      buttons[i].focus();
    });
    bar.append(...buttons);
    select(this.tab);
    return [bar, ...sections];
  }

  private toggle(
    label: string,
    get: (c: Config) => boolean,
    set: (c: Config, on: boolean) => void,
    disabled: (c: Config) => boolean = () => false,
  ): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "settings-switch";
    input.setAttribute("role", "switch");
    input.addEventListener("change", () => this.cb.change((c) => set(c, input.checked)));
    this.syncs.push(() => {
      input.checked = get(this.cfg);
      input.disabled = disabled(this.cfg);
    });
    return row(label, input);
  }

  private select(
    label: string,
    options: DropdownOption[],
    get: (c: Config) => string,
    set: (c: Config, value: string) => void,
    disabled: () => boolean = () => false,
  ): HTMLElement {
    const select = new Dropdown(options, (value) => this.cb.change((c) => set(c, value)));
    this.dropdowns.push(select);
    this.syncs.push(() => {
      // A theme set in the file but not found keeps its name in the list.
      select.value = get(this.cfg);
      select.disabled = disabled();
    });
    return row(label, select.el);
  }

  /** A number field; a value is applied as typed once it is a number within range. */
  private number(
    label: string,
    spec: NumberSpec,
    get: (c: Config) => number,
    set: (c: Config, value: number) => void,
  ): HTMLElement {
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.addEventListener("input", () => {
      const value = parseNumber(input.value, spec);
      if (value !== null && value !== get(this.cfg)) this.cb.change((c) => set(c, value));
    });
    // Leaving the field shows the value in effect (an invalid one is dropped).
    input.addEventListener("change", () => (input.value = String(get(this.cfg))));
    this.syncs.push(() => {
      if (document.activeElement !== input) input.value = String(get(this.cfg));
    });
    return row(label, input);
  }

  /** The font: SF Mono, SF Pro, or font family names typed in. */
  private font(): HTMLElement[] {
    const select = new Dropdown(FONTS, (value) => {
      this.customFont = value === "custom";
      if (this.customFont) {
        custom.hidden = false;
        input.focus();
      } else {
        this.cb.change((c) => (c.editor.font_family = value));
      }
    });
    this.dropdowns.push(select);
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Font names, e.g. Iosevka, Menlo";
    input.spellcheck = false;
    const custom = row("Font names", input);
    const isKeyword = (f: string) => f === "mono" || f === "system";
    input.addEventListener("input", () => {
      const names = input.value.trim();
      if (names) this.cb.change((c) => (c.editor.font_family = names));
    });
    this.syncs.push(() => {
      const family = this.cfg.editor.font_family;
      const isCustom = this.customFont || !isKeyword(family);
      select.value = isCustom ? "custom" : family;
      custom.hidden = !isCustom;
      if (document.activeElement !== input) input.value = isKeyword(family) ? "" : family;
    });
    return [row("Font", select.el), custom];
  }

  /** The running version, with a button checking for a newer one. */
  private version(version: string): HTMLElement {
    const text = document.createElement("span");
    text.className = "settings-version";
    text.textContent = version ? `kayet ${version}` : "kayet";
    const check = document.createElement("button");
    check.type = "button";
    check.className = "settings-link";
    check.textContent = "Check for Updates…";
    check.addEventListener("click", () => this.cb.checkUpdates());
    const el = document.createElement("div");
    el.className = "settings-row";
    el.append(text, check);
    return el;
  }

  private workspace(): HTMLElement {
    const path = document.createElement("span");
    path.className = "settings-path";
    const change = document.createElement("button");
    change.type = "button";
    change.className = "settings-link";
    change.textContent = "Change…";
    change.addEventListener("click", () => this.cb.changeWorkspace());
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "settings-link";
    reset.textContent = "Set to Default";
    reset.title = "~/.kayet/workspace";
    reset.addEventListener("click", () => this.cb.resetWorkspace());
    const box = document.createElement("div");
    box.className = "settings-folder";
    box.append(path, change, reset);
    this.syncs.push(() => {
      path.textContent = this.cb.workspace();
      path.title = path.textContent;
    });
    return row("Folder", box);
  }
}

/** `text` as a setting value: rounded to the step, or null if not a number within range. */
export function parseNumber(text: string, spec: NumberSpec): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < spec.min || n > spec.max) return null;
  return Math.round(Math.round(n / spec.step) * spec.step * 1000) / 1000;
}

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings-section";
  el.dataset.title = title;
  el.append(...rows);
  return el;
}

let rowId = 0;

function row(label: string, control: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = "settings-row";
  const text = document.createElement("label");
  text.textContent = label;
  const field = control.matches("input, button") ? control : control.querySelector("button");
  if (field) {
    field.id ||= `setting-${++rowId}`;
    text.htmlFor = field.id;
  }
  el.append(text, control);
  return el;
}
