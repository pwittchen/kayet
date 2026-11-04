// Code folding by indentation: the code grammars (legacy modes) have no syntax tree to fold
// along, so a line folds the lines below it that are indented deeper.

import { EditorState } from "@codemirror/state";
import { foldService } from "@codemirror/language";

/** Lines looked at below a line for the end of its block, so folding never walks a whole large file. */
const MAX_BLOCK_LINES = 5000;

/** Indentation width of `text` in columns, or null for a blank line. */
function indentWidth(text: string, tabSize: number): number | null {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width++;
    else if (ch === "\t") width += tabSize - (width % tabSize);
    else return width;
  }
  return null;
}

/**
 * The range folded for the line at `lineStart`: from its end to the end of the last following
 * line indented deeper (blank lines inside the block included, trailing ones not). Null if the
 * next non-blank line is not indented deeper.
 */
export function indentFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const base = indentWidth(line.text, state.tabSize);
  if (base === null) return null;
  let end = line.number;
  const last = Math.min(doc.lines, line.number + MAX_BLOCK_LINES);
  for (let n = line.number + 1; n <= last; n++) {
    const width = indentWidth(doc.line(n).text, state.tabSize);
    if (width === null) continue;
    if (width <= base) break;
    end = n;
  }
  return end > line.number ? { from: line.to, to: doc.line(end).to } : null;
}

export const indentFolding = foldService.of((state, from) => indentFoldRange(state, from));
