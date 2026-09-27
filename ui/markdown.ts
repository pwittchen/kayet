// Smart Markdown editing: list continuation, bold / italic toggles, link and image pasting.

import { EditorSelection, EditorState, Extension, Prec, StateCommand } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, pasteURLAsLink } from "@codemirror/lang-markdown";

/** Saves a pasted image next to the document; resolves to its path relative to it, or null. */
export type ImageSaver = (image: File) => Promise<string | null>;

/** Length of the run of `ch` (at most 3) ending at `pos` (backward) or starting at it. */
function markerRun(state: EditorState, pos: number, ch: string, backward: boolean): number {
  let n = 0;
  while (n < 3) {
    const at = backward ? pos - n - 1 : pos + n;
    if (at < 0 || at >= state.doc.length || state.sliceDoc(at, at + 1) !== ch) break;
    n++;
  }
  return n;
}

/** Whether a run of `run` markers carries the emphasis of `size` (1 italic, 2 bold; 3 is both). */
const carries = (run: number, size: number) => run === size || run === 3;

/**
 * Wraps each selection in `size` emphasis markers, or unwraps it when it is already wrapped
 * (markers just outside the selection or at its edges). An empty selection gets a marker pair
 * with the cursor inside.
 */
function toggleEmphasis(size: number): StateCommand {
  return ({ state, dispatch }) => {
    const change = state.changeByRange((range) => {
      for (const ch of ["*", "_"]) {
        const marker = ch.repeat(size);
        // Markers around the selection: **|text|**
        const before = markerRun(state, range.from, ch, true);
        const after = markerRun(state, range.to, ch, false);
        if (carries(before, size) && carries(after, size)) {
          return {
            changes: [
              { from: range.from - size, to: range.from },
              { from: range.to, to: range.to + size },
            ],
            range: EditorSelection.range(range.anchor - size, range.head - size),
          };
        }
        // Markers inside the selection: |**text**|
        const text = state.sliceDoc(range.from, range.to);
        if (
          text.length > 2 * size &&
          carries(markerRun(state, range.from, ch, false), size) &&
          carries(markerRun(state, range.to, ch, true), size) &&
          text.startsWith(marker) &&
          text.endsWith(marker)
        ) {
          return {
            changes: [
              { from: range.from, to: range.from + size },
              { from: range.to - size, to: range.to },
            ],
            range: EditorSelection.range(range.from, range.to - 2 * size),
          };
        }
      }
      const marker = "*".repeat(size);
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    });
    dispatch(state.update(change, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBold = toggleEmphasis(2);
export const toggleItalic = toggleEmphasis(1);

const imageTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/heic": "heic",
};

/** Extension of a pasted image file, or null if it is not an image kayet can save. */
export function imageExtension(type: string): string | null {
  return imageTypes[type] ?? null;
}

/** Link target for a relative path: kept bare unless it contains spaces or parentheses. */
export function linkTarget(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path}>` : path;
}

/** Pasting an image saves it next to the document and inserts a Markdown image for it. */
function pasteImage(save: ImageSaver): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const image = Array.from(event.clipboardData?.files ?? []).find((f) => imageExtension(f.type));
      if (!image) return false;
      event.preventDefault();
      void save(image).then((path) => {
        if (path === null) return;
        const { from, to } = view.state.selection.main;
        const insert = `![](${linkTarget(path)})`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          userEvent: "input.paste",
          scrollIntoView: true,
        });
      });
      return true;
    },
  });
}

/** Enter continues lists, block quotes and task lists; on an empty item it ends the list. */
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** Markdown-only editing helpers; no UI of their own. */
export function markdownEditing(save: ImageSaver): Extension {
  return [
    // Ahead of the default keymap, which binds Enter and Backspace too.
    Prec.high(
      keymap.of([
        { key: "Enter", run: continueMarkup },
        { key: "Backspace", run: deleteMarkupBackward },
        { key: "Mod-b", run: toggleBold },
        { key: "Mod-i", run: toggleItalic },
      ]),
    ),
    pasteURLAsLink,
    pasteImage(save),
  ];
}
