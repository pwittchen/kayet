// Find / replace bar docked at the bottom of the editor, Firefox-style: one slim row with the
// find field, previous / next, match options, the match count and, for ⌘R, the replace field.

import { EditorState, Extension } from "@codemirror/state";
import { EditorView, Panel, ViewUpdate, runScopeHandlers } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from "@codemirror/search";

import { icons } from "./icons";

/** Matches counted before the count is shown as "1000+". */
const MAX_COUNT = 1000;

interface Range {
  from: number;
  to: number;
}

/** Up to `limit` matches of `query` in the document, and whether there are more. */
export function findMatches(state: EditorState, query: SearchQuery, limit = MAX_COUNT): { matches: Range[]; capped: boolean } {
  const matches: Range[] = [];
  if (!query.valid) return { matches, capped: false };
  const cursor = query.getCursor(state);
  for (let m = cursor.next(); !m.done; m = cursor.next()) {
    if (matches.length === limit) return { matches, capped: true };
    matches.push({ from: m.value.from, to: m.value.to });
  }
  return { matches, capped: false };
}

/** Status text: "3 of 12", "12 matches", "No matches", "Invalid pattern" or "" for no query. */
export function matchStatus(query: SearchQuery, total: number, current: number, capped: boolean): string {
  if (!query.search) return "";
  if (!query.valid) return "Invalid pattern";
  if (total === 0) return "No matches";
  const count = `${total.toLocaleString("en-US")}${capped ? "+" : ""}`;
  if (current > 0) return `${current.toLocaleString("en-US")} of ${count}`;
  return total === 1 && !capped ? "1 match" : `${count} matches`;
}

const panels = new WeakMap<EditorView, FindPanel>();
/** Whether the bar should show the replace field when it is (re)created. */
const replaceWanted = new WeakMap<EditorView, boolean>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function textField(name: string, placeholder: string): HTMLInputElement {
  const field = el("input", "find-field", { name, placeholder, "aria-label": placeholder, form: "" });
  field.type = "text";
  // WebKit's text checking would auto-capitalize / auto-correct what is typed.
  field.autocapitalize = "off";
  field.setAttribute("autocorrect", "off");
  field.spellcheck = false;
  return field;
}

function button(className: string, label: string, content: string, onClick: () => void): HTMLButtonElement {
  const btn = el("button", className, { type: "button", title: label, "aria-label": label });
  btn.innerHTML = content;
  // Keep the focus (and the typed text's selection) in the field.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", onClick);
  return btn;
}

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = false;
  private query: SearchQuery;
  private readonly searchField = textField("search", "Find");
  private readonly replaceField = textField("replace", "Replace with");
  private readonly caseToggle: HTMLButtonElement;
  private readonly regexpToggle: HTMLButtonElement;
  private readonly wordToggle: HTMLButtonElement;
  private readonly replaceGroup: HTMLElement;
  private readonly status = el("span", "find-status", { "aria-live": "polite" });
  private matches: Range[] = [];
  private capped = false;

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.searchField.setAttribute("main-field", "true");

    const toggle = (className: string, label: string, text: string) => {
      const btn = button(`find-toggle ${className}`, label, text, () => {
        btn.setAttribute("aria-pressed", String(btn.getAttribute("aria-pressed") !== "true"));
        this.commit();
      });
      return btn;
    };
    this.caseToggle = toggle("find-case", "Match Case", "Aa");
    this.regexpToggle = toggle("find-regexp", "Regular Expression", ".*");
    this.wordToggle = toggle("find-word", "Whole Words", "W");

    const find = el("div", "find-group");
    find.append(
      this.searchField,
      button("find-button find-icon", "Previous Match (⇧⌘G)", icons.chevronUp, () => findPrevious(view)),
      button("find-button find-icon", "Next Match (⌘G)", icons.chevronDown, () => findNext(view)),
    );
    const options = el("div", "find-group find-options");
    options.append(this.caseToggle, this.regexpToggle, this.wordToggle);
    this.replaceGroup = el("div", "find-group find-replace");
    this.replaceGroup.append(
      this.replaceField,
      button("find-button", "Replace", "Replace", () => replaceNext(view)),
      button("find-button", "Replace All (⌘↩)", "All", () => replaceAll(view)),
    );

    this.dom = el("div", "find-bar");
    this.dom.append(
      find,
      options,
      this.replaceGroup,
      this.status,
      button("find-button find-icon find-close", "Close (Esc)", icons.closeFile, () => closeSearchPanel(view)),
    );
    this.dom.addEventListener("keydown", (e) => this.keydown(e));
    this.searchField.addEventListener("input", () => this.searchInput());
    this.replaceField.addEventListener("input", () => this.commit());

    this.showQuery(this.query);
    this.setReplace(replaceWanted.get(view) ?? false);
    this.recount();
    panels.set(view, this);
  }

  mount(): void {
    this.searchField.select();
  }

  destroy(): void {
    panels.delete(this.view);
  }

  update(update: ViewUpdate): void {
    let queryChanged = false;
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.showQuery(effect.value);
          queryChanged = true;
        }
      }
    }
    if (queryChanged || update.docChanged) this.recount();
    else if (update.selectionSet) this.render();
  }

  /** Shows or hides the replace field (never shown for a read-only document). */
  setReplace(on: boolean): void {
    const show = on && !this.view.state.readOnly;
    this.replaceGroup.hidden = !show;
    this.dom.classList.toggle("replacing", show);
  }

  focusReplace(): void {
    if (this.replaceGroup.hidden) return;
    this.replaceField.focus();
    this.replaceField.select();
  }

  private showQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseToggle.setAttribute("aria-pressed", String(query.caseSensitive));
    this.regexpToggle.setAttribute("aria-pressed", String(query.regexp));
    this.wordToggle.setAttribute("aria-pressed", String(query.wholeWord));
  }

  private commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: this.caseToggle.getAttribute("aria-pressed") === "true",
      regexp: this.regexpToggle.getAttribute("aria-pressed") === "true",
      wholeWord: this.wordToggle.getAttribute("aria-pressed") === "true",
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    this.recount();
  }

  /** Searches as you type: jumps to the first match at or after the selection start. */
  private searchInput(): void {
    this.commit();
    if (!this.query.valid) return;
    const { from } = this.view.state.selection.main;
    const match = this.matches.find((m) => m.from >= from) ?? this.matches[0];
    if (!match) return;
    this.view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: "center" }),
      userEvent: "select.search",
    });
  }

  private keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, "search-panel")) {
      e.preventDefault();
    } else if (e.key === "Enter" && e.target === this.searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === "Enter" && e.target === this.replaceField) {
      e.preventDefault();
      (e.metaKey ? replaceAll : replaceNext)(this.view);
    }
  }

  private recount(): void {
    ({ matches: this.matches, capped: this.capped } = findMatches(this.view.state, this.query));
    this.render();
  }

  private render(): void {
    const { from, to } = this.view.state.selection.main;
    const current = this.matches.findIndex((m) => m.from === from && m.to === to) + 1;
    this.status.textContent = matchStatus(this.query, this.matches.length, current, this.capped);
    const failed = this.query.search !== "" && (!this.query.valid || this.matches.length === 0);
    this.searchField.classList.toggle("find-failed", failed);
  }
}

/** The search extension with the find bar at the bottom. */
export function findBar(): Extension {
  return search({ top: false, createPanel: (view) => new FindPanel(view) });
}

/** Opens (or focuses) the find bar; `replace` also shows and focuses the replace field. */
export function openFind(view: EditorView, replace: boolean): void {
  replaceWanted.set(view, replace);
  openSearchPanel(view);
  const panel = panels.get(view);
  panel?.setReplace(replace);
  if (replace) panel?.focusReplace();
}
