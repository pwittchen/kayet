// Lightweight syntax highlighting for fenced code blocks in the preview.
// Loaded lazily, only once a rendered document contains a code block.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = {
  bash, c, cpp, css, diff, go, ini, java, javascript, json, kotlin, markdown,
  python, rust, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(languages)) hljs.registerLanguage(name, lang);
hljs.registerAliases(["sh", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["toml"], { languageName: "ini" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["js", "jsx", "mjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["kt"], { languageName: "kotlin" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });

export function highlightBlocks(blocks: Iterable<HTMLElement>): void {
  for (const code of blocks) {
    const lang = /language-([\w+#-]+)/.exec(code.className)?.[1];
    if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
  }
}
