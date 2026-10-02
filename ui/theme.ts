// Custom themes (see SPEC.md §9): palette/mode resolution and applying a theme's colors.
// A custom theme is a built-in base (light or dark, from the applied variant) with the
// theme's colors set as inline custom properties on top of it.

import type { Mode, ThemeFile } from "./api";

/** Base tokens a custom theme may override; the rest derive from them (see theme.css). */
export const THEME_TOKENS = [
  "bg",
  "bg-sidebar",
  "text",
  "text-muted",
  "border",
  "accent",
  "selection",
  "caret",
  "hl-keyword",
  "hl-string",
  "hl-number",
  "hl-title",
  "hl-comment",
] as const;

/** Theme colors are hex: #rgb, #rrggbb or #rrggbbaa. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * The pre-palette `theme` values, kept as shorthand for the built-in palette with that
 * mode, so old configs keep working.
 */
export function isLegacyTheme(theme: string): theme is "system" | "light" | "dark" {
  return theme === "system" || theme === "light" || theme === "dark";
}

/** The effective mode: the legacy shorthand wins over the `mode` key. */
export function effectiveMode(theme: string, mode: Mode): Mode {
  return isLegacyTheme(theme) ? theme : mode;
}

/**
 * Picks the section matching the variant, falling back to whichever section exists, so
 * a single-variant theme looks the same in both modes. Returns whether the applied
 * section is the dark one, plus its colors.
 */
export function pickSection(
  file: ThemeFile,
  variant: "light" | "dark",
): { dark: boolean; colors: Record<string, string> } {
  const wanted = file[variant];
  if (Object.keys(wanted).length > 0) return { dark: variant === "dark", colors: wanted };
  const other = variant === "dark" ? file.light : file.dark;
  if (Object.keys(other).length > 0) return { dark: variant === "light", colors: other };
  return { dark: variant === "dark", colors: {} };
}

/**
 * Sets the theme's colors as inline custom properties (clearing any previous ones first).
 * Unknown keys and non-hex values are skipped; returns how many were skipped.
 */
export function applyCustomColors(colors: Record<string, string>): number {
  const root = document.documentElement;
  const allowed = new Set<string>(THEME_TOKENS);
  for (const token of THEME_TOKENS) root.style.removeProperty(`--${token}`);
  let skipped = 0;
  for (const [key, value] of Object.entries(colors)) {
    if (!allowed.has(key) || !HEX_COLOR.test(value)) {
      skipped += 1;
      continue;
    }
    root.style.setProperty(`--${key}`, value);
  }
  return skipped;
}

/** Removes any custom theme colors, revealing the built-in palette underneath. */
export function clearCustomColors(): void {
  const root = document.documentElement;
  for (const token of THEME_TOKENS) root.style.removeProperty(`--${token}`);
}
