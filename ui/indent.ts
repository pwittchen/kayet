// Indentation of a document (detected from its text, or set by `.editorconfig`) and the
// `.editorconfig` rules applied on save (trailing whitespace, final newline).

import type { ChangeSpec, Text } from "@codemirror/state";

import type { EditorConfig } from "./api";

export interface Indentation {
  /** What one indentation level inserts: a tab or a run of spaces. */
  unit: string;
  /** How wide a tab is shown, in columns. */
  tabSize: number;
}

/** Lines looked at to detect the indentation, so a large file is not walked through. */
const SAMPLE_LINES = 2000;

/** Used when neither `.editorconfig` nor the text says otherwise. */
const DEFAULT_SIZE = 4;

/**
 * The indentation the text uses: tabs if more lines start with a tab than with spaces, else
 * the most common step by which space indentation grows from one line to the next. Null when
 * the text has (almost) no indented lines.
 */
export function detectIndent(doc: Text): { tabs: boolean; size: number } | null {
  let tabs = 0;
  let spaces = 0;
  let previous = 0;
  const steps = new Map<number, number>();
  const last = Math.min(doc.lines, SAMPLE_LINES);
  for (let n = 1; n <= last; n++) {
    const text = doc.line(n).text;
    const indent = /^[ \t]*/.exec(text)![0];
    if (indent.length === text.length) continue; // blank
    if (indent.startsWith("\t")) {
      tabs++;
      continue;
    }
    // ` * ` continues a block comment: one space past the code's indentation.
    if (indent.length && text[indent.length] === "*" && indent.length % 2 === 1) continue;
    if (indent.length) spaces++;
    const step = indent.length - previous;
    if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = indent.length;
  }
  if (tabs + spaces < 2) return null;
  if (tabs > spaces) return { tabs: true, size: DEFAULT_SIZE };
  let size = 0;
  let count = 0;
  for (const [step, n] of steps) {
    if (n > count || (n === count && step < size)) [size, count] = [step, n];
  }
  return size ? { tabs: false, size } : null;
}

/**
 * The indentation for a document: `.editorconfig` settings win, what the text uses fills in the
 * rest, and 4 spaces (tabs shown 4 columns wide) is the default.
 */
export function indentation(doc: Text, config: EditorConfig | null): Indentation {
  const detected = detectIndent(doc);
  const style = config?.indent_style ?? (detected?.tabs ? "tab" : "space");
  const size = config?.indent_size ?? (detected && !detected.tabs ? detected.size : DEFAULT_SIZE);
  const tabSize = config?.tab_width ?? (style === "tab" ? size : DEFAULT_SIZE);
  return { unit: style === "tab" ? "\t" : " ".repeat(size), tabSize };
}

/**
 * The changes `.editorconfig` asks for on save: trailing spaces and tabs removed
 * (`trim_trailing_whitespace`, but not on the lines in `keep`, e.g. where the cursor is
 * during autosave) and a line break added at the end (`insert_final_newline`).
 */
export function saveChanges(doc: Text, config: EditorConfig | null, lineBreak: string, keep: Set<number> = new Set()): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  if (!config) return changes;
  if (config.trim_trailing_whitespace) {
    for (let n = 1; n <= doc.lines; n++) {
      if (keep.has(n)) continue;
      const line = doc.line(n);
      const trailing = /[ \t]+$/.exec(line.text);
      if (trailing) changes.push({ from: line.from + trailing.index, to: line.to });
    }
  }
  if (config.insert_final_newline && doc.length && doc.line(doc.lines).length) {
    changes.push({ from: doc.length, insert: lineBreak });
  }
  return changes;
}
