import { afterEach, describe, expect, it } from "vitest";

import type { ThemeFile } from "./api";
import {
  applyThemeColors,
  clearThemeColors,
  effectiveMode,
  isLegacyTheme,
  migrateLegacyTheme,
  nextMode,
  onlyVariant,
  pickSection,
  themeItems,
} from "./theme";

const prop = (token: string) => document.documentElement.style.getPropertyValue(`--${token}`);

afterEach(() => clearThemeColors());

describe("theme resolution", () => {
  it("keeps the pre-palette values as shorthand", () => {
    expect(isLegacyTheme("system")).toBe(true);
    expect(isLegacyTheme("light")).toBe(true);
    expect(isLegacyTheme("dark")).toBe(true);
    expect(isLegacyTheme("kayet")).toBe(false);
    expect(isLegacyTheme("gruvbox")).toBe(false);
  });

  it("lets an explicit mode win over the legacy shorthand", () => {
    expect(effectiveMode("dark", "light")).toBe("light");
    expect(effectiveMode("dark", "system")).toBe("dark");
    expect(effectiveMode("gruvbox", "light")).toBe("light");
    expect(effectiveMode("kayet", "system")).toBe("system");
  });

  it("cycles the mode and migrates legacy themes to the kayet palette", () => {
    expect(nextMode("kayet", "system")).toEqual({ theme: "kayet", mode: "light" });
    expect(nextMode("kayet", "light")).toEqual({ theme: "kayet", mode: "dark" });
    expect(nextMode("kayet", "dark")).toEqual({ theme: "kayet", mode: "system" });
    expect(nextMode("gruvbox", "dark")).toEqual({ theme: "gruvbox", mode: "system" });
    expect(nextMode("system", "system")).toEqual({ theme: "kayet", mode: "light" });
    expect(nextMode("dark", "system")).toEqual({ theme: "kayet", mode: "system" });
  });

  it("migrates legacy themes preserving the effective mode", () => {
    expect(migrateLegacyTheme("dark", "system")).toEqual({ theme: "kayet", mode: "dark" });
    expect(migrateLegacyTheme("dark", "light")).toEqual({ theme: "kayet", mode: "light" });
    expect(migrateLegacyTheme("gruvbox", "dark")).toEqual({ theme: "gruvbox", mode: "dark" });
  });

  it("lists the built-in palette first and marks the current one", () => {
    expect(themeItems(["gruvbox", "solarized"], "gruvbox")).toEqual([
      { id: "kayet", label: "kayet" },
      { id: "gruvbox", label: "gruvbox", detail: "current" },
      { id: "solarized", label: "solarized" },
    ]);
    expect(themeItems([], "dark")).toEqual([{ id: "kayet", label: "kayet", detail: "current" }]);
  });

  it("picks the matching section", () => {
    const file: ThemeFile = { light: { bg: "#fbf1c7" }, dark: { bg: "#282828" } };
    expect(pickSection(file, "dark")).toEqual({ dark: true, colors: { bg: "#282828" } });
    expect(pickSection(file, "light")).toEqual({ dark: false, colors: { bg: "#fbf1c7" } });
  });

  it("falls back to whichever section exists", () => {
    const darkOnly: ThemeFile = { light: {}, dark: { bg: "#282828" } };
    expect(pickSection(darkOnly, "light")).toEqual({ dark: true, colors: { bg: "#282828" } });
    const empty: ThemeFile = { light: {}, dark: {} };
    expect(pickSection(empty, "dark")).toEqual({ dark: true, colors: {} });
    expect(pickSection(empty, "light")).toEqual({ dark: false, colors: {} });
  });

  it("tells a single-variant theme apart", () => {
    expect(onlyVariant({ light: {}, dark: { bg: "#2e3440" } })).toBe("dark");
    expect(onlyVariant({ light: { bg: "#fbf1c7" }, dark: {} })).toBe("light");
    expect(onlyVariant({ light: { bg: "#fbf1c7" }, dark: { bg: "#282828" } })).toBeNull();
    expect(onlyVariant({ light: {}, dark: {} })).toBeNull();
  });
});

describe("theme colors", () => {
  it("applies hex colors and counts the skipped keys", () => {
    const skipped = applyThemeColors({
      bg: "#282828",
      text: "#ebdbb2",
      selection: "#83a59855",
      caret: "#ebdb",
      accent: "red",
      shadow: "#000000",
    });
    expect(prop("bg")).toBe("#282828");
    expect(prop("text")).toBe("#ebdbb2");
    expect(prop("selection")).toBe("#83a59855");
    expect(prop("caret")).toBe("");
    expect(prop("accent")).toBe("");
    expect(prop("shadow")).toBe("");
    expect(skipped).toBe(3);
  });

  it("clears colors the new theme does not set", () => {
    applyThemeColors({ bg: "#282828", text: "#ebdbb2" });
    applyThemeColors({ bg: "#1d2021" });
    expect(prop("bg")).toBe("#1d2021");
    expect(prop("text")).toBe("");
    clearThemeColors();
    expect(prop("bg")).toBe("");
  });
});
