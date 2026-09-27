// Word count and reading time shown in the title bar next to the document name.

/** Average silent reading speed used for the reading time estimate. */
const WORDS_PER_MINUTE = 200;

/** A run of non-whitespace containing at least one letter or digit (so Markdown markers like `#` or `-` don't count). */
const WORD = /[^\s\p{L}\p{N}]*[\p{L}\p{N}]\S*/gu;

export function countWords(text: string): number {
  let count = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(text)) count++;
  return count;
}

/** `1,234 words · 7 min read`; empty for a document without words. */
export function formatStats(words: number): string {
  if (words === 0) return "";
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return `${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"} · ${minutes} min read`;
}
