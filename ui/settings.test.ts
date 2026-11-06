import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

import type { Config } from "./api";
import { parseNumber, Settings } from "./settings";

function config(): Config {
  return {
    workspace: { path: "~/notes", show_hidden_files: false },
    ui: {
      theme: "kayet",
      mode: "system",
      sidebar_visible: false,
      titlebar_pinned: false,
      zen_mode: false,
      code_mode: false,
      sidebar_width: 240,
      preview_split: 0.5,
      open_in_new_tab: false,
      presentation_steps: true,
    },
    editor: {
      font_family: "mono",
      font_size: 15,
      line_height: 1.6,
      soft_wrap: true,
      max_line_width: 72,
      autosave: false,
      syntax_highlighting: true,
      cursor: "blink",
      spell_check: false,
    },
    window: { width: 1000, height: 700, x: 0, y: 0 },
    updates: { check_automatically: true },
    session: {},
  };
}

describe("Settings", () => {
  let root: HTMLElement;
  let body: HTMLElement;
  let cfg: Config;
  let view: Settings;
  let editFile: ReturnType<typeof vi.fn<() => void>>;
  let changed: number;
  let checkUpdates: ReturnType<typeof vi.fn<() => void>>;
  let resetWorkspace: ReturnType<typeof vi.fn<() => void>>;

  const rowNamed = (label: string) =>
    [...body.querySelectorAll<HTMLElement>(".settings-row")].find((r) => r.querySelector("label")?.textContent === label)!;
  const control = <T extends HTMLElement>(label: string) => rowNamed(label).querySelector<T>("input, button")!;
  /** Opens the dropdown in the row and clicks the option labeled `option`. */
  const choose = (label: string, option: string) => {
    control(label).click();
    const item = [...document.querySelectorAll<HTMLElement>(".dropdown-list li")].find((li) => li.textContent === option)!;
    item.click();
  };

  beforeEach(() => {
    root = document.createElement("section");
    root.hidden = true;
    body = document.createElement("div");
    root.append(body);
    document.body.replaceChildren(root);
    cfg = config();
    changed = 0;
    editFile = vi.fn<() => void>();
    checkUpdates = vi.fn<() => void>();
    resetWorkspace = vi.fn<() => void>();
    view = new Settings(root, body, {
      exit: () => view.hide(),
      editFile,
      change: (edit) => {
        edit(cfg);
        changed++;
        view.sync();
      },
      changeWorkspace: () => {},
      checkUpdates,
      resetWorkspace,
      config: () => cfg,
      workspace: () => "/Users/me/notes",
      themeFixed: () => false,
    });
    view.show(["gruvbox", "nord"], "0.14.0");
  });

  it("shows the current settings", () => {
    expect(view.open).toBe(true);
    expect(control("Theme").dataset.value).toBe("kayet");
    control("Theme").click();
    expect([...document.querySelectorAll(".dropdown-list li")].map((li) => li.textContent)).toEqual(["kayet", "gruvbox", "nord"]);
    expect(document.querySelector('.dropdown-list li[aria-checked="true"]')?.textContent).toBe("kayet");
    expect(control<HTMLInputElement>("Font size").value).toBe("15");
    expect(control<HTMLInputElement>("Wrap lines").checked).toBe(true);
    expect(rowNamed("Font names").hidden).toBe(true);
    expect(body.querySelector(".settings-path")?.textContent).toBe("/Users/me/notes");
  });

  it("offers editing the config file at the top", () => {
    const first = body.firstElementChild!;
    expect(first.className).toBe("settings-file");
    first.querySelector("button")!.click();
    expect(editFile).toHaveBeenCalledOnce();
  });

  it("shows the version and checks for updates", () => {
    expect(body.querySelector(".settings-version")?.textContent).toBe("kayet 0.14.0");
    const check = [...body.querySelectorAll("button")].find((b) => b.textContent === "Check for Updates…")!;
    check.click();
    expect(checkUpdates).toHaveBeenCalledOnce();
  });

  it("sets the workspace back to the default one", () => {
    const reset = [...rowNamed("Folder").querySelectorAll("button")].find((b) => b.textContent === "Set to Default")!;
    reset.click();
    expect(resetWorkspace).toHaveBeenCalledOnce();
  });

  it("applies a switch right away", () => {
    const zen = control<HTMLInputElement>("Zen mode");
    zen.click();
    expect(cfg.ui.zen_mode).toBe(true);
    expect(changed).toBe(1);
  });

  it("turns highlighting with code editor mode, and disables zen mode meanwhile", () => {
    control<HTMLInputElement>("Code editor mode").click();
    expect(cfg.ui.code_mode).toBe(true);
    expect(cfg.editor.syntax_highlighting).toBe(true);
    expect(control<HTMLInputElement>("Zen mode").disabled).toBe(true);
    expect(control<HTMLInputElement>("Spell check").disabled).toBe(true);
  });

  it("applies numbers as typed once valid", () => {
    const size = control<HTMLInputElement>("Font size");
    size.value = "1";
    size.dispatchEvent(new Event("input"));
    expect(cfg.editor.font_size).toBe(15);
    size.value = "18";
    size.dispatchEvent(new Event("input"));
    expect(cfg.editor.font_size).toBe(18);
  });

  it("normalizes a legacy theme when the theme or mode changes", () => {
    cfg.ui.theme = "dark";
    view.sync();
    expect(control("Theme").dataset.value).toBe("kayet");
    expect(control("Appearance").textContent).toBe("Dark");
    choose("Theme", "nord");
    expect(cfg.ui).toMatchObject({ theme: "nord", mode: "dark" });
  });

  it("takes custom font names", () => {
    choose("Font", "Custom…");
    expect(rowNamed("Font names").hidden).toBe(false);
    const names = control<HTMLInputElement>("Font names");
    names.value = "Iosevka, Menlo";
    names.dispatchEvent(new Event("input"));
    expect(cfg.editor.font_family).toBe("Iosevka, Menlo");
    choose("Font", "System (SF Pro)");
    expect(cfg.editor.font_family).toBe("system");
    expect(rowNamed("Font names").hidden).toBe(true);
  });

  it("closes an open list on Escape, but not the panel", () => {
    control("Appearance").click();
    const list = document.querySelector<HTMLElement>(".dropdown-list")!;
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".dropdown-list")).toBeNull();
    expect(view.open).toBe(true);
    expect(cfg.ui.mode).toBe("system");
  });

  it("picks with the keyboard", () => {
    control("Appearance").click();
    const list = document.querySelector<HTMLElement>(".dropdown-list")!;
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cfg.ui.mode).toBe("light");
    expect(control("Appearance").textContent).toBe("Light");
  });

  it("closes on Escape", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(view.open).toBe(false);
  });
});

describe("parseNumber", () => {
  const spec = { min: 1, max: 3, step: 0.05 };
  it("rounds to the step and rejects values out of range", () => {
    expect(parseNumber("1.62", spec)).toBe(1.6);
    expect(parseNumber("", spec)).toBeNull();
    expect(parseNumber("abc", spec)).toBeNull();
    expect(parseNumber("4", spec)).toBeNull();
  });
});
