//! Markdown rendering: `pulldown-cmark` → `ammonia`.
//!
//! Every top-level block is preceded by an empty `<span data-line="N">` anchor (0-based
//! source line) so the preview can approximately sync its scroll position with the editor.
//! Relative image and link targets are resolved against `base` into absolute file paths;
//! the frontend turns those into asset URLs / in-editor navigation.

use std::path::Path;
use std::sync::LazyLock;

use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, html};

static SANITIZER: LazyLock<ammonia::Builder<'static>> = LazyLock::new(|| {
    let mut b = ammonia::Builder::default();
    b.add_tags(["input", "span"])
        .add_tag_attributes("span", ["data-line"])
        .add_tag_attributes("code", ["class"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tag_attributes("th", ["style"])
        .add_tag_attributes("td", ["style"])
        .add_tag_attributes("div", ["id", "class"])
        .add_tag_attributes("sup", ["class"])
        .add_tag_attributes("li", ["id", "class"])
        .attribute_filter(|element, attribute, value| match (element, attribute) {
            ("input", "type") if value != "checkbox" => None,
            ("th" | "td", "style") if !value.starts_with("text-align:") => None,
            _ => Some(value.into()),
        })
        .set_tag_attribute_value("input", "disabled", "");
    b
});

pub fn render(text: &str, base: Option<&Path>) -> String {
    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES;

    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(text.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let line_of = |offset: usize| line_starts.partition_point(|&s| s <= offset) - 1;

    let mut events = Vec::new();
    let mut depth = 0usize;
    for (event, range) in Parser::new_ext(text, opts).into_offset_iter() {
        let top_level_block = depth == 0 && matches!(event, Event::Start(_) | Event::Rule);
        if top_level_block {
            let anchor = format!("<span data-line=\"{}\"></span>", line_of(range.start));
            events.push(Event::Html(anchor.into()));
        }
        let event = match event {
            Event::Start(tag) => {
                depth += 1;
                Event::Start(resolve_tag(tag, base))
            }
            Event::End(tag) => {
                depth = depth.saturating_sub(1);
                Event::End(tag)
            }
            other => other,
        };
        events.push(event);
    }

    let mut out = String::with_capacity(text.len() * 3 / 2);
    html::push_html(&mut out, events.into_iter());
    SANITIZER.clean(&out).to_string()
}

fn resolve_tag<'a>(tag: Tag<'a>, base: Option<&Path>) -> Tag<'a> {
    let Some(base) = base else { return tag };
    match tag {
        Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        } => Tag::Image {
            link_type,
            dest_url: resolve_url(dest_url, base),
            title,
            id,
        },
        Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        } => Tag::Link {
            link_type,
            dest_url: resolve_url(dest_url, base),
            title,
            id,
        },
        other => other,
    }
}

/// Turns a relative URL like `img/a%20b.png#x` into `/abs/base/img/a b.png#x`
/// (the HTML writer percent-encodes it again).
fn resolve_url<'a>(url: CowStr<'a>, base: &Path) -> CowStr<'a> {
    if !is_relative_path(&url) {
        return url;
    }
    let (path_part, suffix) = match url.find(['#', '?']) {
        Some(i) => url.split_at(i),
        None => (&*url, ""),
    };
    let resolved = crate::fs_ops::normalize(&base.join(percent_decode(path_part)));
    format!("{}{}", resolved.display(), suffix).into()
}

fn is_relative_path(url: &str) -> bool {
    if url.is_empty() || url.starts_with(['#', '/', '?']) {
        return false;
    }
    // Anything with a URL scheme (`https:`, `mailto:`, `data:` …) is not a path.
    let scheme_end = url.find(':');
    let first_sep = url.find(['/', '?', '#']);
    match (scheme_end, first_sep) {
        (Some(c), Some(s)) if c < s => false,
        (Some(_), None) => false,
        _ => true,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push(hi << 4 | lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn hex(b: u8) -> Option<u8> {
    (b as char).to_digit(16).map(|d| d as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_gfm_features() {
        let md = "# Title\n\n~~gone~~\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\nText[^1]\n\n[^1]: Note.\n";
        let html = render(md, None);
        assert!(html.contains("<h1>Title</h1>"), "{html}");
        assert!(html.contains("<del>gone</del>"));
        assert!(html.contains("type=\"checkbox\""));
        assert!(html.contains("checked"));
        assert!(html.contains("<table>"));
        assert!(html.contains("text-align: right"));
        assert!(html.contains("footnote-definition"));
    }

    #[test]
    fn adds_line_anchors_for_top_level_blocks() {
        let html = render("one\n\n## two\n\n- a\n- b\n", None);
        assert!(html.contains("data-line=\"0\""));
        assert!(html.contains("data-line=\"2\""));
        assert!(html.contains("data-line=\"4\""));
        assert!(!html.contains("data-line=\"5\""), "nested items get no anchor");
    }

    #[test]
    fn strips_scripts_and_handlers() {
        let html = render(
            "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))",
            None,
        );
        assert!(!html.contains("<script"));
        assert!(!html.contains("onerror"));
        assert!(!html.contains("javascript:"));
    }

    #[test]
    fn keeps_code_language_class() {
        let html = render("```rust\nfn main() {}\n```\n", None);
        assert!(html.contains("class=\"language-rust\""), "{html}");
    }

    #[test]
    fn resolves_relative_targets_against_base() {
        let base = Path::new("/notes/drafts");
        let html = render(
            "![i](img/a%20b.png) [n](../other.md#top) [w](https://example.com) [f](#frag)",
            Some(base),
        );
        assert!(html.contains("src=\"/notes/drafts/img/a%20b.png\""), "{html}");
        assert!(html.contains("href=\"/notes/other.md#top\""), "{html}");
        assert!(html.contains("href=\"https://example.com\""));
        assert!(html.contains("href=\"#frag\""));
    }

    #[test]
    fn relative_detection() {
        assert!(is_relative_path("a.md"));
        assert!(is_relative_path("dir/a:b.md"));
        assert!(!is_relative_path("https://x"));
        assert!(!is_relative_path("mailto:me@x"));
        assert!(!is_relative_path("/abs"));
        assert!(!is_relative_path("#x"));
    }
}
