// Document outline for Go to Symbol: Markdown headings, or the definitions in source code
// found line by line with a few patterns (no language server, no syntax tree).

import type { Text } from "@codemirror/state";

export interface DocSymbol {
  name: string;
  /** What it is: "fn", "class", "H2"… */
  kind: string;
  /** 1-based line number. */
  line: number;
  /** Nesting depth: the heading level - 1, or the indentation level in code. */
  depth: number;
}

/** At most this many symbols are listed, so a huge generated file stays quick. */
const MAX_SYMBOLS = 5000;

type Pattern = [RegExp, string];

/** Definitions found in most languages; the name is the last capture group. */
const COMMON: Pattern[] = [
  // Rust
  [/^\s*(?:pub(?:\([\w:\s]+\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"\w+"\s+)?fn\s+([A-Za-z_]\w*)/, "fn"],
  [/^\s*(?:pub(?:\([\w:\s]+\))?\s+)?(?:unsafe\s+)?(struct|enum|trait|union|mod)\s+([A-Za-z_]\w*)/, "$1"],
  [/^\s*(?:unsafe\s+)?impl(?:\s*<[^>]*>)?\s+([\w:]+(?:<[^>]*>)?(?:\s+for\s+[\w:]+(?:<[^>]*>)?)?)/, "impl"],
  [/^\s*macro_rules!\s+([A-Za-z_]\w*)/, "macro"],
  // Go, Swift
  [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "func"],
  [/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/, "type"],
  [/^\s*(?:(?:public|private|internal|fileprivate|open|static|override|final|mutating|@\w+)\s+)*func\s+([A-Za-z_]\w*)/, "func"],
  [/^\s*(?:(?:public|private|internal|fileprivate|open|final|indirect)\s+)*(protocol|extension)\s+([A-Za-z_][\w.]*)/, "$1"],
  // JavaScript / TypeScript
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
  [/^\s*(?:export\s+)?(?:declare\s+)?(interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/, "$1"],
  [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/, "type"],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>)/, "function"],
  // Python, Ruby, Elixir-like
  [/^\s*(?:async\s+)?def\s+((?:self\.)?[A-Za-z_]\w*[?!]?)/, "def"],
  [/^\s*module\s+([A-Z][\w:]*)/, "module"],
  // Classes almost everywhere (Java, Kotlin, C#, Swift, Scala, Dart, PHP, Python, Ruby, TS…)
  [/^\s*(?:(?:export|default|public|private|protected|internal|abstract|final|sealed|static|open|data|partial|inner|case)\s+)*(class|struct|object|record|trait)\s+([A-Za-z_]\w*)/, "$1"],
  // Lua, shell, Elixir, Kotlin, PHP
  [/^\s*(?:local\s+)?function\s+([A-Za-z_][\w.:]*)/, "function"],
  [/^\s*(?:(?:public|private|protected|internal|override|suspend|inline|open)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/, "fun"],
  [/^\s*(?!(?:if|for|while|switch|catch|function|elif|until)\b)([A-Za-z_][\w-]*)\s*\(\)\s*\{/, "function"],
  [/^\s*defp?\s+([a-z_]\w*[?!]?)/, "def"],
];

/** Methods and functions in C-family languages: a return type, a name and an open parenthesis. */
const C_LIKE: Pattern[] = [
  [
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|inline|extern|const|unsafe|synchronized|native|sealed|partial|new)\s+)*(?!(?:return|else|new|throw|delete|case|goto|if|while|for|switch|catch|using|sizeof|typeof)\b)[A-Za-z_][\w:<>,.*&\[\]\s]*?[\s*&>]([A-Za-z_~]\w*)\s*\([^;]*$/,
    "fn",
  ],
];

/** Section headers of INI / TOML / .editorconfig files. */
const SECTIONS: Pattern[] = [[/^\s*\[\[?([^\]]+)\]\]?\s*(?:[#;].*)?$/, "section"]];

const C_LIKE_EXT = new Set(["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm", "java", "cs", "dart", "glsl", "scala", "groovy", "gradle", "d"]);
const SECTION_EXT = new Set(["toml", "ini", "cfg", "conf", "properties", "editorconfig", "gitconfig"]);

/** Longer lines (minified code, data) are not looked at. */
const MAX_LINE = 400;

/** Lines that only look like definitions: comments and control flow. */
const SKIP = /^\s*(?:\/\/|\/\*|\*|#(?!\[)|--|;|%|<!--)/;

function patternsFor(path: string | null): Pattern[] {
  const name = (path ?? "").slice((path ?? "").lastIndexOf("/") + 1).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (SECTION_EXT.has(ext) || name === ".editorconfig" || name === ".gitconfig") return SECTIONS;
  return C_LIKE_EXT.has(ext) ? [...COMMON, ...C_LIKE] : COMMON;
}

/** Markdown headings (ATX `#` style, not inside code fences). */
export function markdownSymbols(doc: Text): DocSymbol[] {
  const out: DocSymbol[] = [];
  let fence: string | null = null;
  for (let n = 1; n <= doc.lines && out.length < MAX_SYMBOLS; n++) {
    const text = doc.line(n).text;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
    if (heading && heading[2]) {
      const level = heading[1].length;
      out.push({ name: heading[2], kind: `H${level}`, line: n, depth: level - 1 });
    }
  }
  return out;
}

/** Definitions in source code (or sections of a config file), in document order. */
export function codeSymbols(doc: Text, path: string | null, tabSize = 4): DocSymbol[] {
  const patterns = patternsFor(path);
  const out: DocSymbol[] = [];
  const levels: number[] = [];
  for (let n = 1; n <= doc.lines && out.length < MAX_SYMBOLS; n++) {
    const text = doc.line(n).text;
    if (!text.trim() || text.length > MAX_LINE || SKIP.test(text)) continue;
    for (const [re, kind] of patterns) {
      const m = re.exec(text);
      if (!m) continue;
      const indent = /^[ \t]*/.exec(text)![0].replace(/\t/g, " ".repeat(tabSize)).length;
      // Depth: how many enclosing (less indented) symbols there are.
      while (levels.length && levels[levels.length - 1] >= indent) levels.pop();
      out.push({
        name: m[m.length - 1].trim().replace(/\s+/g, " "),
        kind: kind.startsWith("$") ? m[Number(kind.slice(1))] : kind,
        line: n,
        depth: levels.length,
      });
      levels.push(indent);
      break;
    }
  }
  return out;
}

/** The symbol at or before line `line` (1-based), as an index into `symbols`, or -1. */
export function symbolAt(symbols: DocSymbol[], line: number): number {
  let at = -1;
  for (const [i, s] of symbols.entries()) {
    if (s.line > line) break;
    at = i;
  }
  return at;
}
