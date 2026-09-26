// CodeMirror 6 setup: no gutter, soft wrap, centered readable column, subtle Markdown.

import { Compartment, EditorState, Extension, RangeSetBuilder, Text } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  drawSelection,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { HighlightStyle, Language, LanguageSupport, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { SearchQuery, highlightSelectionMatches, openSearchPanel, search, searchKeymap, setSearchQuery } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

export interface EditorSettings {
  fontFamily: "system" | "mono";
  fontSize: number;
  lineHeight: number;
  softWrap: boolean;
  maxLineWidth: number;
}

/** How the document is highlighted: as Markdown, as a code language, or not at all. */
export type Syntax = "markdown" | Language | null;

export interface EditorCallbacks {
  onChange: () => void;
  onScroll: () => void;
  onType: () => void;
}

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", opacity: "0.6" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.92em", color: "var(--code-text)" },
  { tag: t.quote, color: "var(--text-muted)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: "var(--text-muted)", opacity: "0.7" },
]);

/** Source code and data files: a few muted hues on top of the regular text color. */
const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--hl-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: "var(--hl-string)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.variableName), t.attributeName], color: "var(--hl-number)" },
  {
    tag: [t.typeName, t.className, t.definition(t.variableName), t.function(t.variableName), t.propertyName, t.tagName, t.heading, t.labelName],
    color: "var(--hl-title)",
  },
  { tag: [t.comment, t.meta, t.processingInstruction, t.deleted], color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "var(--text-muted)" },
  { tag: t.invalid, textDecoration: "underline wavy", textDecorationColor: "var(--hl-number)" },
]);

/**
 * Typewriter scrolling: after typing or keyboard navigation, scroll so the cursor sits in
 * the vertical center. Pointer selections are left alone so clicking/dragging never jumps.
 */
const typewriter = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged && !tr.selection) return null;
  if (tr.isUserEvent("select.pointer")) return null;
  return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) };
});

const focusLine = Decoration.line({ class: "cm-focus-paragraph" });

/** Line range of the paragraph (run of non-blank lines) around `pos`; a blank line stands alone. */
function paragraphAt(doc: Text, pos: number): { first: number; last: number } {
  const line = doc.lineAt(pos).number;
  const blank = (n: number) => doc.line(n).text.trim() === "";
  if (blank(line)) return { first: line, last: line };
  let first = line;
  let last = line;
  while (first > 1 && !blank(first - 1)) first--;
  while (last < doc.lines && !blank(last + 1)) last++;
  return { first, last };
}

function focusDecorations(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  const first = paragraphAt(doc, selection.main.from).first;
  const last = paragraphAt(doc, selection.main.to).last;
  const builder = new RangeSetBuilder<Decoration>();
  // Only lines in the viewport need the class; everything else is dimmed by CSS.
  for (const { from, to } of view.visibleRanges) {
    const start = Math.max(first, doc.lineAt(from).number);
    const end = Math.min(last, doc.lineAt(to).number);
    for (let n = start; n <= end; n++) {
      const pos = doc.line(n).from;
      builder.add(pos, pos, focusLine);
    }
  }
  return builder.finish();
}

/** Focus-paragraph mode: marks the paragraph under the cursor so the rest can be dimmed. */
const focusParagraph = [
  EditorView.editorAttributes.of({ class: "cm-focus-mode" }),
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = focusDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = focusDecorations(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
];

const zenMode = [typewriter, focusParagraph];

/** Detects the file's line separator so saving writes back what was found. */
function detectLineSeparator(text: string): string {
  const crlf = text.indexOf("\r\n");
  if (crlf !== -1) return "\r\n";
  if (text.includes("\r")) return "\r";
  return "\n";
}

export class Editor {
  readonly view: EditorView;
  private readonly language = new Compartment();
  private readonly wrap = new Compartment();
  private readonly lineSep = new Compartment();
  private readonly look = new Compartment();
  private readonly zen = new Compartment();
  private zenOn = false;
  private settings: EditorSettings;
  private zoom = 0;

  constructor(parent: HTMLElement, settings: EditorSettings, private readonly cb: EditorCallbacks) {
    this.settings = settings;
    this.view = new EditorView({ parent, state: this.createState("", null) });
    this.view.scrollDOM.addEventListener("scroll", () => this.cb.onScroll(), { passive: true });
    this.view.contentDOM.addEventListener("keydown", (e) => {
      if (!e.metaKey && !e.ctrlKey && !["Shift", "Alt", "Control", "Meta", "CapsLock"].includes(e.key)) {
        this.cb.onType();
      }
    });
    this.view.contentDOM.setAttribute("spellcheck", "true");
  }

  private createState(text: string, syntax: Syntax): EditorState {
    const extensions: Extension[] = [
      this.lineSep.of(EditorState.lineSeparator.of(detectLineSeparator(text))),
      history(),
      // Slower blink than the 1200ms default.
      drawSelection({ cursorBlinkRate: 2000 }),
      highlightSpecialChars(),
      indentOnInput(),
      search({ top: true }),
      highlightSelectionMatches(),
      EditorState.allowMultipleSelections.of(false),
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
      this.language.of(this.languageFor(syntax)),
      this.wrap.of(this.settings.softWrap ? EditorView.lineWrapping : []),
      this.look.of(this.lookExtension()),
      this.zen.of(this.zenOn ? zenMode : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.cb.onChange();
      }),
      EditorView.contentAttributes.of({ "aria-label": "Editor" }),
    ];
    return EditorState.create({ doc: text, extensions });
  }

  private languageFor(syntax: Syntax): Extension {
    if (syntax === "markdown") {
      // Bare GFM language: skips the embedded HTML/JS/CSS grammars and autocompletion.
      return [new LanguageSupport(markdownLanguage), syntaxHighlighting(markdownHighlight)];
    }
    return syntax ? [new LanguageSupport(syntax), syntaxHighlighting(codeHighlight)] : [];
  }

  private lookExtension(): Extension {
    const s = this.settings;
    const size = Math.max(9, Math.min(40, s.fontSize + this.zoom));
    document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
    return EditorView.theme({
      "&": { fontSize: `${size}px` },
      ".cm-content": {
        fontFamily: s.fontFamily === "mono" ? "var(--font-mono)" : "var(--font-ui)",
        lineHeight: String(s.lineHeight),
        // The readable column excludes the horizontal padding (48px each side).
        maxWidth: s.softWrap ? `calc(${s.maxLineWidth}ch + 96px)` : "none",
      },
    });
  }

  /** Replaces the document; resets undo history. */
  load(text: string, syntax: Syntax): void {
    this.view.setState(this.createState(text, syntax));
    this.view.scrollDOM.scrollTop = 0;
  }

  /** Replaces the text while keeping history, the cursor and the scroll position. */
  replaceText(text: string): void {
    const state = this.view.state;
    const sep = detectLineSeparator(text);
    if (sep !== state.lineBreak) {
      const head = Math.min(state.selection.main.head, text.length);
      this.view.dispatch({
        changes: { from: 0, to: state.doc.length, insert: text },
        selection: { anchor: head },
        effects: this.lineSep.reconfigure(EditorState.lineSeparator.of(sep)),
      });
      return;
    }
    // Only replace the changed middle so unchanged text (and the view on it) stays put.
    const old = state.sliceDoc();
    const max = Math.min(old.length, text.length);
    let start = 0;
    while (start < max && old.charCodeAt(start) === text.charCodeAt(start)) start++;
    let end = 0;
    while (
      end < max - start &&
      old.charCodeAt(old.length - 1 - end) === text.charCodeAt(text.length - 1 - end)
    ) {
      end++;
    }
    if (start === old.length && start === text.length) return;
    this.view.dispatch({
      changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
    });
  }

  setSyntax(syntax: Syntax): void {
    this.view.dispatch({ effects: this.language.reconfigure(this.languageFor(syntax)) });
  }

  /** Zen mode: keeps the cursor line vertically centered and dims all but the current paragraph. */
  setZen(on: boolean): void {
    this.zenOn = on;
    this.view.dispatch({ effects: this.zen.reconfigure(on ? zenMode : []) });
    if (on) this.centerCursor();
  }

  centerCursor(): void {
    // Wait for the padding change to be laid out before centering.
    requestAnimationFrame(() => {
      const head = this.view.state.selection.main.head;
      this.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    });
  }

  applySettings(settings: EditorSettings): void {
    this.settings = settings;
    this.view.dispatch({
      effects: [
        this.wrap.reconfigure(settings.softWrap ? EditorView.lineWrapping : []),
        this.look.reconfigure(this.lookExtension()),
      ],
    });
  }

  setZoom(step: number | "reset"): void {
    this.zoom = step === "reset" ? 0 : Math.max(-6, Math.min(24, this.zoom + step));
    this.view.dispatch({ effects: this.look.reconfigure(this.lookExtension()) });
  }

  get doc(): Text {
    return this.view.state.doc;
  }

  text(): string {
    return this.view.state.sliceDoc();
  }

  focus(): void {
    this.view.focus();
  }

  undo(): void {
    undo(this.view);
  }

  redo(): void {
    redo(this.view);
  }

  find(): void {
    openSearchPanel(this.view);
  }

  replace(): void {
    openSearchPanel(this.view);
    const selected = this.view.state.sliceDoc(
      this.view.state.selection.main.from,
      this.view.state.selection.main.to,
    );
    if (selected && !selected.includes("\n")) {
      this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: selected })) });
    }
    requestAnimationFrame(() => {
      const field = this.view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
      field?.focus();
      field?.select();
    });
  }

  /** Source line (0-based, fractional) at the top of the viewport, for scroll sync. */
  topLine(): number {
    const view = this.view;
    const padding = parseFloat(getComputedStyle(view.contentDOM).paddingTop) || 0;
    const height = Math.max(0, view.scrollDOM.scrollTop - padding);
    const block = view.lineBlockAtHeight(height);
    const line = view.state.doc.lineAt(block.from).number - 1;
    const fraction = block.height > 0 ? (height - block.top) / block.height : 0;
    return line + Math.max(0, Math.min(1, fraction));
  }

  /** Whether the editor is scrolled to (or near) the very end. */
  atBottom(): boolean {
    const s = this.view.scrollDOM;
    return s.scrollTop > 0 && s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
  }
}
