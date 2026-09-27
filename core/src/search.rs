//! Workspace-wide text search.

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::workspace;

/// Upper bound for `search`, so a common word cannot flood the results.
pub const MAX_RESULTS: usize = 200;

/// Larger files (logs, dumps) are skipped.
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// A NUL byte within this many leading bytes marks a file as binary.
const BINARY_PROBE: usize = 8000;

/// Longest excerpt shown for a line, in characters.
const MAX_EXCERPT: usize = 160;

/// Characters kept before the match when a long line is cut.
const CONTEXT: usize = 24;

/// A line containing the query. Columns and ranges count UTF-16 code units, as the editor does.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Match {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    /// Start of the (first) match within the line.
    pub column: usize,
    pub length: usize,
    /// The line without leading indentation, or an excerpt around the match if it is long.
    pub text: String,
    /// The match within `text`.
    pub start: usize,
    pub end: usize,
}

/// Finds lines containing `query` literally in every workspace file (see `workspace::list_files`),
/// at most `limit`, one per line, in path order. Case is ignored unless the query has an
/// upper-case letter. Binary, non-UTF-8 and very large files are skipped.
pub fn search(root: &Path, query: &str, show_hidden: bool, limit: usize) -> Vec<Match> {
    let needle: Vec<char> = query.chars().collect();
    if needle.is_empty() {
        return Vec::new();
    }
    let ignore_case = !query.chars().any(char::is_uppercase);
    let folded = fold(query, ignore_case);
    let mut matches = Vec::new();
    for path in workspace::list_files(root, show_hidden, workspace::MAX_FILES) {
        let Some(text) = read_text(Path::new(&path)) else {
            continue;
        };
        if !fold(&text, ignore_case).contains(&folded) {
            continue;
        }
        for (i, line) in text.split('\n').enumerate() {
            let line = line.strip_suffix('\r').unwrap_or(line);
            if let Some(range) = find(line, &needle, ignore_case) {
                matches.push(excerpt(&path, i + 1, line, range));
                if matches.len() >= limit {
                    return matches;
                }
            }
        }
    }
    matches
}

/// The file's text, or None if it is too large, binary or not UTF-8.
fn read_text(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > MAX_FILE_SIZE {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes[..bytes.len().min(BINARY_PROBE)].contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Lower-cases `s` char by char (like `same`), so a folded `contains` never misses a match.
fn fold(s: &str, ignore_case: bool) -> String {
    if ignore_case {
        s.chars().flat_map(char::to_lowercase).collect()
    } else {
        s.to_owned()
    }
}

fn same(a: char, b: char, ignore_case: bool) -> bool {
    a == b || (ignore_case && a.to_lowercase().eq(b.to_lowercase()))
}

/// Byte range of the first occurrence of `needle` in `line`.
fn find(line: &str, needle: &[char], ignore_case: bool) -> Option<(usize, usize)> {
    line.char_indices().find_map(|(start, _)| {
        let mut hay = line[start..].chars();
        let mut end = start;
        needle
            .iter()
            .all(|&n| {
                hay.next().is_some_and(|h| {
                    end += h.len_utf8();
                    same(h, n, ignore_case)
                })
            })
            .then_some((start, end))
    })
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Builds the match for `line`, whose byte range `from..to` matched.
fn excerpt(path: &str, line_no: usize, line: &str, (from, to): (usize, usize)) -> Match {
    let indent = line.len() - line.trim_start().len();
    let mut start = indent.min(from);
    // Keep only a little context before the match on long lines.
    if line[start..].chars().count() > MAX_EXCERPT
        && let Some((i, _)) = line[start..from].char_indices().rev().nth(CONTEXT - 1)
    {
        start += i;
    }
    let end = line[start..]
        .char_indices()
        .nth(MAX_EXCERPT)
        .map_or(line.len(), |(i, _)| start + i)
        .max(to);
    let prefix = if start > indent { "…" } else { "" };
    let suffix = if end < line.len() { "…" } else { "" };
    let before = utf16_len(prefix) + utf16_len(&line[start..from]);
    let length = utf16_len(&line[from..to]);
    Match {
        path: path.to_owned(),
        line: line_no,
        column: utf16_len(&line[..from]),
        length,
        text: format!("{prefix}{}{suffix}", &line[start..end]),
        start: before,
        end: before + length,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (name, contents) in files {
            let path = dir.path().join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }
        dir
    }

    /// (relative path, line, text) of each match.
    fn hits(dir: &tempfile::TempDir, query: &str) -> Vec<(String, usize, String)> {
        search(dir.path(), query, false, MAX_RESULTS)
            .into_iter()
            .map(|m| {
                let rel = Path::new(&m.path).strip_prefix(dir.path()).unwrap();
                (rel.to_string_lossy().into_owned(), m.line, m.text)
            })
            .collect()
    }

    #[test]
    fn finds_lines_in_path_order_one_per_line() {
        let dir = workspace(&[
            ("b.md", b"nothing\r\n  a Todo here, todo there\r\n"),
            ("a/notes.txt", b"TODO first"),
            ("node_modules/x.js", b"todo"),
            (".hidden", b"todo"),
        ]);
        assert_eq!(
            hits(&dir, "todo"),
            [
                ("a/notes.txt".into(), 1, "TODO first".into()),
                ("b.md".into(), 2, "a Todo here, todo there".into()),
            ]
        );
    }

    #[test]
    fn upper_case_query_is_case_sensitive() {
        let dir = workspace(&[("a.md", b"todo\nTodo\nTODO")]);
        let lines = |q| hits(&dir, q).into_iter().map(|h| h.1).collect::<Vec<_>>();
        assert_eq!(lines("todo"), [1, 2, 3]);
        assert_eq!(lines("Todo"), [2]);
        assert_eq!(lines("Zażółć"), Vec::<usize>::new());
    }

    #[test]
    fn skips_binary_files_and_empty_queries() {
        let dir = workspace(&[("a.bin", b"todo\0"), ("b.md", b"todo")]);
        assert_eq!(hits(&dir, "todo").len(), 1);
        assert!(hits(&dir, "").is_empty());
    }

    #[test]
    fn stops_at_the_limit() {
        let dir = workspace(&[("a.md", b"x\nx\nx\nx")]);
        assert_eq!(search(dir.path(), "x", false, 3).len(), 3);
    }

    #[test]
    fn reports_utf16_positions() {
        let dir = workspace(&[("a.md", "\t🙂 zażółć GĘŚLĄ".as_bytes())]);
        let m = &search(dir.path(), "gęślą", false, 1)[0];
        // Tab (1) + emoji (2) + space (1) + "zażółć " (7).
        assert_eq!((m.column, m.length), (11, 5));
        assert_eq!(m.text, "🙂 zażółć GĘŚLĄ");
        assert_eq!((m.start, m.end), (10, 15));
    }

    #[test]
    fn cuts_long_lines_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(300), "b".repeat(300));
        let dir = workspace(&[("a.md", line.as_bytes())]);
        let m = &search(dir.path(), "needle", false, 1)[0];
        assert_eq!(m.column, 300);
        let chars: Vec<char> = m.text.chars().collect();
        assert_eq!(chars.len(), MAX_EXCERPT + 2);
        assert_eq!((chars[0], chars[chars.len() - 1]), ('…', '…'));
        let text: String = chars[m.start..m.end].iter().collect();
        assert_eq!(text, "needle");
    }
}
