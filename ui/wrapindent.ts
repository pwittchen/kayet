// Hanging indent for soft-wrapped lines: a wrapped line continues under the text of a list
// item, block quote or indented line instead of at the left edge.

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

/** Leading whitespace, block quote markers and a list marker (with an optional task box). */
const PREFIX = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;

/**
 * The part of `line` that wrapped lines are indented by, with tabs expanded to spaces at
 * `tabSize` stops; empty when there is none or nothing follows it.
 */
export function hangingPrefix(line: string, tabSize: number): string {
  const prefix = PREFIX.exec(line)?.[0] ?? "";
  if (prefix === "" || prefix.length === line.length) return "";
  let out = "";
  for (const ch of prefix) {
    out += ch === "\t" ? " ".repeat(tabSize - (out.length % tabSize)) : ch;
  }
  return out;
}

let canvas: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in pixels in `font`, or `null` when it cannot be measured. */
function textWidth(text: string, font: string): number | null {
  if (canvas === undefined) {
    try {
      canvas = document.createElement("canvas").getContext("2d");
    } catch {
      canvas = null;
    }
  }
  if (!canvas || !font) return null;
  canvas.font = font;
  const width = canvas.measureText(text).width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

class HangingIndent {
  decorations: DecorationSet;
  private font = "";
  private readonly widths = new Map<string, Decoration>();

  constructor(view: EditorView) {
    this.readFont(view);
    this.decorations = this.build(view);
  }

  update(u: ViewUpdate) {
    // A font, size or zoom change shows up as a geometry change.
    if (u.geometryChanged && this.readFont(u.view)) this.widths.clear();
    if (u.docChanged || u.viewportChanged || u.geometryChanged) this.decorations = this.build(u.view);
  }

  /** Reads the text font; true when it changed. */
  private readFont(view: EditorView): boolean {
    const font = getComputedStyle(view.contentDOM).font;
    if (font === this.font) return false;
    this.font = font;
    return true;
  }

  private decoration(view: EditorView, prefix: string): Decoration {
    let deco = this.widths.get(prefix);
    if (!deco) {
      const width = textWidth(prefix, this.font) ?? prefix.length * view.defaultCharacterWidth;
      const px = Math.round(width * 100) / 100;
      deco = Decoration.line({ attributes: { style: `padding-left: ${px}px; text-indent: -${px}px` } });
      this.widths.set(prefix, deco);
    }
    return deco;
  }

  private build(view: EditorView): DecorationSet {
    const { doc, tabSize } = view.state;
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = doc.lineAt(pos);
        const prefix = hangingPrefix(line.text, tabSize);
        if (prefix) builder.add(line.from, line.from, this.decoration(view, prefix));
        pos = line.to + 1;
      }
    }
    return builder.finish();
  }
}

/** Soft-wrapped lines keep the indentation of their list item, quote or indented line. */
export const hangingIndent = ViewPlugin.fromClass(HangingIndent, { decorations: (v) => v.decorations });
