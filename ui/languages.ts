// Syntax highlighting languages for source code and data/config files, picked by file
// extension (or well-known file name). Grammars are loaded lazily, one chunk per mode.

import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { tags } from "@lezer/highlight";

type Loader = () => Promise<StreamParser<unknown>>;

const clike = () => import("@codemirror/legacy-modes/mode/clike");
const js = () => import("@codemirror/legacy-modes/mode/javascript");
const css = () => import("@codemirror/legacy-modes/mode/css");
const sql = () => import("@codemirror/legacy-modes/mode/sql");
const xml: Loader = async () => (await import("@codemirror/legacy-modes/mode/xml")).xml;
const html: Loader = async () => (await import("@codemirror/legacy-modes/mode/xml")).html;
const shell: Loader = async () => (await import("@codemirror/legacy-modes/mode/shell")).shell;
const properties: Loader = async () => (await import("@codemirror/legacy-modes/mode/properties")).properties;
const cmake: Loader = async () => (await import("@codemirror/legacy-modes/mode/cmake")).cmake;
const dockerfile: Loader = async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile;
const ruby: Loader = async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby;

const byExtension: Record<string, Loader> = {
  // C family
  c: async () => (await clike()).c,
  h: async () => (await clike()).c,
  cc: async () => (await clike()).cpp,
  cpp: async () => (await clike()).cpp,
  cxx: async () => (await clike()).cpp,
  hpp: async () => (await clike()).cpp,
  hh: async () => (await clike()).cpp,
  m: async () => (await clike()).objectiveC,
  mm: async () => (await clike()).objectiveCpp,
  java: async () => (await clike()).java,
  kt: async () => (await clike()).kotlin,
  kts: async () => (await clike()).kotlin,
  scala: async () => (await clike()).scala,
  cs: async () => (await clike()).csharp,
  dart: async () => (await clike()).dart,
  glsl: async () => (await clike()).shader,
  // Web
  js: async () => (await js()).javascript,
  jsx: async () => (await js()).javascript,
  mjs: async () => (await js()).javascript,
  cjs: async () => (await js()).javascript,
  ts: async () => (await js()).typescript,
  tsx: async () => (await js()).typescript,
  mts: async () => (await js()).typescript,
  cts: async () => (await js()).typescript,
  css: async () => (await css()).css,
  scss: async () => (await css()).sCSS,
  less: async () => (await css()).less,
  sass: async () => (await import("@codemirror/legacy-modes/mode/sass")).sass,
  html,
  htm: html,
  vue: html,
  svelte: html,
  // Other languages
  rs: async () => (await import("@codemirror/legacy-modes/mode/rust")).rust,
  go: async () => (await import("@codemirror/legacy-modes/mode/go")).go,
  py: async () => (await import("@codemirror/legacy-modes/mode/python")).python,
  pyi: async () => (await import("@codemirror/legacy-modes/mode/python")).python,
  rb: ruby,
  swift: async () => (await import("@codemirror/legacy-modes/mode/swift")).swift,
  lua: async () => (await import("@codemirror/legacy-modes/mode/lua")).lua,
  pl: async () => (await import("@codemirror/legacy-modes/mode/perl")).perl,
  pm: async () => (await import("@codemirror/legacy-modes/mode/perl")).perl,
  r: async () => (await import("@codemirror/legacy-modes/mode/r")).r,
  jl: async () => (await import("@codemirror/legacy-modes/mode/julia")).julia,
  hs: async () => (await import("@codemirror/legacy-modes/mode/haskell")).haskell,
  elm: async () => (await import("@codemirror/legacy-modes/mode/elm")).elm,
  erl: async () => (await import("@codemirror/legacy-modes/mode/erlang")).erlang,
  clj: async () => (await import("@codemirror/legacy-modes/mode/clojure")).clojure,
  cljs: async () => (await import("@codemirror/legacy-modes/mode/clojure")).clojure,
  edn: async () => (await import("@codemirror/legacy-modes/mode/clojure")).clojure,
  scm: async () => (await import("@codemirror/legacy-modes/mode/scheme")).scheme,
  ml: async () => (await import("@codemirror/legacy-modes/mode/mllike")).oCaml,
  fs: async () => (await import("@codemirror/legacy-modes/mode/mllike")).fSharp,
  groovy: async () => (await import("@codemirror/legacy-modes/mode/groovy")).groovy,
  gradle: async () => (await import("@codemirror/legacy-modes/mode/groovy")).groovy,
  d: async () => (await import("@codemirror/legacy-modes/mode/d")).d,
  ps1: async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell,
  tex: async () => (await import("@codemirror/legacy-modes/mode/stex")).stex,
  sql: async () => (await sql()).standardSQL,
  sh: shell,
  bash: shell,
  zsh: shell,
  fish: shell,
  diff: async () => (await import("@codemirror/legacy-modes/mode/diff")).diff,
  patch: async () => (await import("@codemirror/legacy-modes/mode/diff")).diff,
  proto: async () => (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf,
  cmake,
  // Data and configuration
  json: async () => (await js()).json,
  jsonc: async () => (await js()).json,
  json5: async () => (await js()).json,
  geojson: async () => (await js()).json,
  webmanifest: async () => (await js()).json,
  toml: async () => (await import("@codemirror/legacy-modes/mode/toml")).toml,
  yaml: async () => (await import("@codemirror/legacy-modes/mode/yaml")).yaml,
  yml: async () => (await import("@codemirror/legacy-modes/mode/yaml")).yaml,
  xml,
  svg: xml,
  plist: xml,
  xsd: xml,
  xsl: xml,
  xslt: xml,
  csproj: xml,
  ini: properties,
  cfg: properties,
  conf: properties,
  properties,
  env: properties,
  editorconfig: properties,
  gitconfig: properties,
  csv: async () => delimited(","),
  tsv: async () => delimited("\t"),
};

const byName: Record<string, Loader> = {
  dockerfile,
  containerfile: dockerfile,
  "cmakelists.txt": cmake,
  gemfile: ruby,
  rakefile: ruby,
  ".bashrc": shell,
  ".bash_profile": shell,
  ".zshrc": shell,
  ".zprofile": shell,
  ".profile": shell,
  ".env": properties,
  ".gitconfig": properties,
  ".gitignore": properties,
  ".editorconfig": properties,
  "nginx.conf": async () => (await import("@codemirror/legacy-modes/mode/nginx")).nginx,
};

function loaderFor(path: string | null): Loader | null {
  if (!path) return null;
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (byName[name]) return byName[name];
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return dockerfile;
  if (name.startsWith(".env.")) return properties;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (byExtension[name.slice(dot + 1)] ?? null) : null;
}

/** Whether the file is source code or a data/config file that gets syntax highlighting. */
export function isCode(path: string | null): boolean {
  return loaderFor(path) !== null;
}

const cache = new Map<Loader, Promise<StreamLanguage<unknown>>>();

/** The highlighting language for `path`, or null for plain text and Markdown. */
export async function codeLanguage(path: string | null): Promise<StreamLanguage<unknown> | null> {
  const loader = loaderFor(path);
  if (!loader) return null;
  let lang = cache.get(loader);
  if (!lang) {
    // Legacy JSON mode tags object keys as "property"; map it so they read as keys.
    lang = loader().then((parser) =>
      StreamLanguage.define({ ...parser, tokenTable: { property: tags.propertyName, ...parser.tokenTable } }),
    );
    cache.set(loader, lang);
  }
  return lang;
}

/** CSV / TSV: tints columns in rotation so rows are easy to follow. */
function delimited(separator: string): StreamParser<{ column: number; quoted: boolean }> {
  const tokens = ["variableName", "string", "number", "keyword", "typeName"];
  return {
    name: separator === "," ? "csv" : "tsv",
    startState: () => ({ column: 0, quoted: false }),
    token(stream, state) {
      if (stream.sol() && !state.quoted) state.column = 0;
      if (!state.quoted && stream.peek() === separator) {
        stream.next();
        state.column++;
        return "punctuation";
      }
      const style = tokens[state.column % tokens.length];
      while (!stream.eol()) {
        const ch = stream.peek();
        if (state.quoted) {
          stream.next();
          if (ch === '"') {
            if (stream.peek() === '"') stream.next(); // escaped quote
            else state.quoted = false;
          }
        } else if (ch === separator) {
          break;
        } else {
          stream.next();
          if (ch === '"') state.quoted = true;
        }
      }
      return style;
    },
  };
}
