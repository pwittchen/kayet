import { afterEach, describe, expect, it } from "vitest";

import type { ThemeFile } from "./api";
import {
  applyCustomColors,
  clearCustomColors,
  effectiveMode,
  isLegacyTheme,
  pickSection,
} from "./theme";

const prop = (token: string) => document.documentElement.style.getPropertyValue(`--${token}`);

afterEach(() => clearCustomColors());

describe("theme resolution", () => {
  it("keeps the pre-palette values as shorthand", () => {
    expect(isLegacyTheme("system")).toBe(true);
    expect(isLegacyTheme("light")).toBe(true);
    expect(isLegacyTheme("dark")).toBe(true);
    expect(isLegacyTheme("kayet")).toBe(false);
    expect(isLegacyTheme("gruvbox")).toBe(false);
  });

  it("lets the legacy shorthand win over the mode key", () => {
    expect(effectiveMode("dark", "light")).toBe("dark");
    expect(effectiveMode("gruvbox", "light")).toBe("light");
    expect(effectiveMode("kayet", "system")).toBe("system");
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
});

describe("custom theme colors", () => {
  it("applies hex colors and counts the skipped keys", () => {
    const skipped = applyCustomColors({
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
    applyCustomColors({ bg: "#282828", text: "#ebdbb2" });
    applyCustomColors({ bg: "#1d2021" });
    expect(prop("bg")).toBe("#1d2021");
    expect(prop("text")).toBe("");
    clearCustomColors();
    expect(prop("bg")).toBe("");
  });
});
