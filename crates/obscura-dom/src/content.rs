//! Markdown for captured HTML, independent of the browser that captured it.

use crate::{parse_html, DomTree, NodeData, NodeId};

enum Block {
    Element(NodeId),
    Inline(Vec<NodeId>),
    Close(String),
}

/// Convert a serialized HTML snapshot to Markdown with HTML for structures
/// that Markdown cannot express faithfully. The caller retains the original
/// snapshot. Parsing the snapshot does not execute scripts or load resources.
pub fn structured_markdown(html: &str) -> String {
    render_markdown(html, |_, _, _| {})
}

/// Get the full rendition and its ordered section boundaries in UTF-8 bytes.
/// Adjacent slices of the rendition can be concatenated without losing content.
pub fn markdown_sections(html: &str) -> (String, Vec<(usize, u8, String)>) {
    let mut sections = Vec::new();
    let markdown = render_markdown(html, |offset, level, title| {
        sections.push((offset, level, title()));
    });
    (markdown, sections)
}

fn render_markdown(html: &str, mut heading: impl FnMut(usize, u8, &dyn Fn() -> String)) -> String {
    let tree = parse_html(html);
    let Some(body) = tree.query_selector("body").ok().flatten() else {
        return String::new();
    };
    let mut markdown = String::new();
    collect_metadata(&tree, &mut markdown);
    clean_body(&tree, body);

    let mut pending = Vec::new();
    schedule_blocks(&tree, body, &mut pending);
    while let Some(block) = pending.pop() {
        let id = match block {
            Block::Element(id) => id,
            Block::Close(tag) => {
                push_html(&mut markdown, &format!("</{tag}>"));
                continue;
            }
            Block::Inline(nodes) => {
                if !push_markdown_block(&tree, &nodes, "p", &mut markdown) {
                    let html = nodes.into_iter().fold(String::from("<div>"), |mut html, id| {
                        html.push_str(&tree.outer_html(id));
                        html
                    });
                    push_html(&mut markdown, &(html + "</div>"));
                }
                continue;
            }
        };
        let Some(node) = tree.borrow_node(id) else { continue };
        let Some(name) = node.as_element() else { continue };
        let tag = name.local.as_ref();
        if let [b'h', level @ b'1'..=b'6'] = tag.as_bytes() {
            heading(markdown.len(), level - b'0', &|| tree.text_content(id));
        }
        let has_attributes = node.attrs().is_some_and(|attrs| !attrs.is_empty());
        if is_container(tag) {
            if has_attributes || tag == "nav" {
                if let Some(opening) = tree.element_opening_tag(id) {
                    push_html(&mut markdown, &opening);
                    pending.push(Block::Close(tag.to_string()));
                }
            }
            schedule_blocks(&tree, id, &mut pending);
        } else if has_attributes || !matches!(tag, "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
            || !push_markdown_block(&tree, &tree.children(id), tag, &mut markdown)
        {
            push_html(&mut markdown, &tree.outer_html(id));
        }
    }

    markdown.trim_end().to_string()
}

fn collect_metadata(tree: &DomTree, out: &mut String) {
    for id in tree.descendants(tree.document()) {
        let Some(node) = tree.get_node(id) else { continue };
        let Some(name) = node.as_element() else { continue };
        if name.ns != ns!(html) {
            continue;
        }
        match name.local.as_ref() {
            "meta" if node.get_attribute("content").is_some()
                && (node.get_attribute("property").is_some()
                    || node.get_attribute("itemprop").is_some()
                    || node.get_attribute("name").is_some_and(|name| {
                        matches!(name, "author" | "date" | "description" | "keywords")
                            || name.starts_with("twitter:")
                    })) =>
            {
                let metadata = tree.new_node(node.data.clone());
                tree.with_node_mut(metadata, |node| {
                    node.attrs_mut().expect("element attributes").retain(|attr| {
                        attr.name.ns == ns!()
                            && matches!(attr.name.local.as_ref(), "property" | "itemprop" | "name" | "content")
                    });
                });
                push_html(out, &tree.outer_html(metadata));
            }
            "script" if node.get_attribute("src").is_none()
                && node.get_attribute("type").is_some_and(|kind| kind.eq_ignore_ascii_case("application/ld+json")) =>
            {
                let json = tree.text_content(id);
                if !json.trim().is_empty() && !json.to_ascii_lowercase().contains("</script") {
                    out.push_str("<script type=\"application/ld+json\">");
                    out.push_str(&json);
                    out.push_str("</script>\n\n");
                }
            }
            _ => {}
        }
    }
}

fn clean_body(tree: &DomTree, body: NodeId) {
    let mut preformatted = Vec::new();
    for id in tree.descendants(body) {
        if !tree.is_connected(id) {
            continue;
        }
        let Some(node) = tree.get_node(id) else { continue };
        let Some(name) = node.as_element() else {
            if !matches!(node.data, NodeData::Text { .. }) {
                tree.detach(id);
            }
            continue;
        };
        let tag = name.local.as_ref();
        if name.ns == ns!(svg)
            || matches!(tag, "script" | "style" | "iframe" | "embed" | "object" | "template" | "link" | "meta" | "base")
        {
            tree.detach(id);
        } else if (name.ns == ns!(html) && safe_html_tag(tag))
            || (name.ns == ns!(mathml) && safe_math_tag(tag))
        {
            if name.ns == ns!(html) && tag == "pre" {
                preformatted.push(id);
            }
            tree.with_node_mut(id, |node| {
                node.attrs_mut()
                    .expect("element attributes")
                    .retain(|attr| attr.name.ns == ns!() && keep_attribute(tag, attr.name.local.as_ref(), &attr.value));
            });
        } else {
            // Preserve text and supported markup in unknown wrappers.
            for child in tree.children(id) {
                tree.insert_before(id, child);
            }
            tree.detach(id);
        }
    }
    for pre in preformatted {
        // An HTML parser discards the first line feed after <pre>. Duplicate
        // a leading line feed in the captured DOM before re-serializing it.
        if let Some(first) = tree.with_node(pre, |node| node.first_child).flatten() {
            tree.with_node_mut(first, |node| {
                if let NodeData::Text { contents } = &mut node.data {
                    if contents.starts_with('\n') {
                        contents.insert(0, '\n');
                    }
                }
            });
        }
    }
}

fn safe_html_tag(tag: &str) -> bool {
    is_container(tag)
        || matches!(
            tag,
            "a" | "abbr" | "b" | "bdi" | "bdo" | "blockquote" | "br" | "caption" | "cite" | "code"
                | "col" | "colgroup" | "data" | "dd" | "del" | "details" | "dfn" | "dl" | "dt"
                | "em" | "figcaption" | "figure" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                | "hr" | "i" | "img" | "ins" | "kbd" | "li" | "mark" | "ol" | "p" | "pre"
                | "q" | "rp" | "rt" | "ruby" | "s" | "samp" | "small" | "span" | "strong"
                | "sub" | "summary" | "sup" | "table" | "tbody" | "td" | "tfoot" | "th" | "thead"
                | "time" | "tr" | "u" | "ul" | "var" | "wbr"
        )
}

fn safe_math_tag(tag: &str) -> bool {
    matches!(
        tag,
        "math" | "annotation" | "maction" | "menclose" | "merror" | "mfenced" | "mfrac"
            | "mi" | "mmultiscripts" | "mn" | "mo" | "mover" | "mpadded" | "mphantom"
            | "mprescripts" | "mroot" | "mrow" | "ms" | "mspace" | "msqrt" | "mstyle"
            | "msub" | "msubsup" | "msup" | "mtable" | "mtd" | "mtext" | "mtr"
            | "munder" | "munderover" | "none" | "semantics"
    )
}

fn keep_attribute(tag: &str, name: &str, value: &str) -> bool {
    match name {
        "id" | "lang" | "dir" | "title" | "role" | "aria-label" | "itemprop" | "itemscope" | "itemtype"
        | "itemid" | "itemref" => true,
        "href" => tag == "a" && safe_destination(value),
        "src" => tag == "img" && safe_destination(value),
        "alt" => tag == "img",
        "class" => tag == "code" && value.split_ascii_whitespace().any(|class| class.starts_with("language-")),
        "colspan" | "rowspan" | "headers" => matches!(tag, "th" | "td"),
        "scope" | "abbr" => tag == "th",
        "span" => matches!(tag, "col" | "colgroup"),
        "start" | "reversed" => tag == "ol",
        "value" => matches!(tag, "data" | "li"),
        "type" => matches!(tag, "ol" | "ul"),
        "open" => tag == "details",
        "datetime" => matches!(tag, "time" | "del" | "ins"),
        "cite" => matches!(tag, "blockquote" | "q" | "del" | "ins") && safe_destination(value),
        "display" | "displaystyle" | "mathvariant" | "stretchy" | "encoding" | "columnspan"
        | "columnalign" | "rowalign" => safe_math_tag(tag),
        _ => false,
    }
}

fn safe_destination(value: &str) -> bool {
    if value.chars().any(char::is_control) {
        return false;
    }
    let prefix = value.trim_start().split(['/', '?', '#']).next().unwrap_or("");
    match prefix.split_once(':') {
        Some((scheme, _)) => ["http", "https", "mailto", "tel"]
            .iter()
            .any(|allowed| scheme.eq_ignore_ascii_case(allowed)),
        None => true,
    }
}

fn is_container(tag: &str) -> bool {
    matches!(tag, "article" | "aside" | "div" | "footer" | "header" | "main" | "nav" | "section" | "address")
}

fn schedule_blocks(tree: &DomTree, parent: NodeId, pending: &mut Vec<Block>) {
    let mut ordered = Vec::new();
    let mut inline = Vec::new();
    let mut inline_has_content = false;
    for id in tree.children(parent) {
        let Some(node) = tree.borrow_node(id) else { continue };
        if node.as_element().is_some_and(|name| is_block(name.local.as_ref())) {
            if inline_has_content {
                ordered.push(Block::Inline(std::mem::take(&mut inline)));
            } else {
                inline.clear();
            }
            inline_has_content = false;
            ordered.push(Block::Element(id));
        } else {
            inline_has_content |= node.text_content_of_text_node().is_none_or(|text| !text.trim().is_empty());
            inline.push(id);
        }
    }
    if inline_has_content {
        ordered.push(Block::Inline(inline));
    }
    pending.extend(ordered.into_iter().rev());
}

fn is_block(tag: &str) -> bool {
    is_container(tag) || matches!(
        tag,
        "blockquote" | "details" | "dl" | "figure" | "h1" | "h2" | "h3" | "h4" | "h5"
            | "h6" | "hr" | "math" | "ol" | "p" | "pre" | "table" | "ul"
    )
}

fn push_markdown_block(tree: &DomTree, nodes: &[NodeId], tag: &str, out: &mut String) -> bool {
    let Some(inline) = markdown_inline(tree, nodes) else { return false };
    let text = inline.split_ascii_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() || text.starts_with(['-', '+', '#', '='])
        || text.trim_start_matches(|ch: char| ch.is_ascii_digit()).starts_with(['.', ')']) {
        return false;
    }
    if tag.starts_with('h') {
        let level = usize::from(tag.as_bytes()[1] - b'0');
        out.push_str(&"######"[..level]);
        out.push(' ');
    }
    out.push_str(&text);
    out.push_str("\n\n");
    true
}

fn markdown_inline(tree: &DomTree, ids: &[NodeId]) -> Option<String> {
    let mut result = String::new();
    for &id in ids {
        let node = tree.borrow_node(id)?;
        if let Some(text) = node.text_content_of_text_node() {
            if !plain_text(text) {
                return None;
            }
            result.push_str(text);
        } else if node.as_element().is_some_and(|name| name.ns == ns!(html) && name.local.as_ref() == "a")
            && node.attrs().is_some_and(|attrs| attrs.len() == 1)
        {
            let href = node.get_attribute("href")?;
            if href.is_empty() || !href.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-._~:/?#@%=+;,".contains(&byte)) {
                return None;
            }
            let children = tree.children(id);
            if !children.into_iter().all(|id| tree.with_node(id, |child| child.is_text()) == Some(true)) {
                return None;
            }
            let text = tree.text_content(id);
            if text.is_empty() || text != text.trim() || !plain_text(&text) {
                return None;
            }
            result.push('[');
            result.push_str(&text);
            result.push_str("](");
            result.push_str(href);
            result.push(')');
        } else {
            return None;
        }
    }
    Some(result)
}

fn plain_text(text: &str) -> bool {
    !text.contains(['\\', '`', '*', '_', '[', ']', '<', '>', '&', '~', '|', '#'])
}

fn push_html(out: &mut String, html: &str) {
    // A blank line terminates most Markdown HTML blocks. Encode line feeds
    // inside this block so the HTML parser restores them, including in code.
    for line in html.split_inclusive('\n') {
        if let Some(text) = line.strip_suffix('\n') {
            out.push_str(text);
            out.push_str("&#10;");
        } else {
            out.push_str(line);
        }
    }
    out.push_str("\n\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_simple_sections_as_markdown_and_preserves_fragment_targets() {
        let input = r##"<main><h1>Title</h1><p>Maximum 12.7 W.</p><h2 id="note">Note</h2><p><a href="#note">Details</a></p></main>"##;
        let result = structured_markdown(input);
        assert_eq!(
            result,
            "# Title\n\nMaximum 12.7 W.\n\n<h2 id=\"note\">Note</h2>\n\n[Details](#note)"
        );
    }

    #[test]
    fn keeps_section_attributes_without_copying_its_entire_html() {
        assert_eq!(
            structured_markdown(r#"<section id="sample"><h2>Example</h2><p>Paragraph.</p></section>"#),
            "<section id=\"sample\">\n\n## Example\n\nParagraph.\n\n</section>"
        );
    }

    #[test]
    fn keeps_nested_code_table_math_and_disclosure_structure() {
        let input = "<details open><summary>Example</summary><pre><code>one```\n\n  two</code></pre>\n\n+            <table><caption>Data</caption><thead><tr><th colspan=2>Results</th></tr></thead>+            <tbody><tr><td>Peak</td><td>12.7 W</td></tr></tbody></table>+            <ol start=4><li>Outer<ul><li>Nested</li></ul></li></ol>+            <math><msup><mi>V</mi><mn>2</mn></msup></math></details>";
        let result = structured_markdown(input);
        assert_eq!(result.lines().count(), 1);
        let dom = parse_html(&result);
        for (selector, text) in [
            ("details[open] > summary", "Example"),
            ("pre > code", "one```\n\n  two"),
            ("table caption", "Data"),
            ("table th[colspan='2']", "Results"),
            ("table td + td", "12.7 W"),
            ("ol[start='4'] > li > ul > li", "Nested"),
            ("math msup", "V2"),
        ] {
            assert_eq!(dom.text_content(dom.query_selector(selector).unwrap().unwrap()), text);
        }
    }

    #[test]
    fn reparsing_pre_keeps_its_first_leading_line_feed() {
        let converted = structured_markdown("<pre>\n\n  example\n</pre>");
        let dom = parse_html(&converted);
        let code = dom.query_selector("pre").unwrap().unwrap();
        assert_eq!(dom.text_content(code), "\n  example\n");
    }

    #[test]
    fn omits_active_markup_but_keeps_inert_metadata_and_human_text() {
        let input = r#"<meta http-equiv="refresh" content="0;url=https://example.com">
            <meta property="og:locale" content="en_GB" onload="run()">
            <script type="application/ld+json" onclick="run()">{"value":3}</script>
            <script>run()</script><details onclick="run()"><summary>Read</summary>
            <a href="jav&#x61;script:run()">Label</a>
            <svg><script>run()</script></svg><iframe src="/remote"></iframe>
            <custom-wrapper>kept</custom-wrapper></details>"#;
        let result = structured_markdown(input);
        assert!(result.contains("<meta property=\"og:locale\" content=\"en_GB\">"));
        assert!(result.contains("<script type=\"application/ld+json\">{\"value\":3}</script>"));
        assert!(result.contains("<a>Label</a>"));
        assert!(result.contains("kept"));
        for unexpected in ["http-equiv", "run()", "javascript:", "<svg", "<iframe", "<custom-wrapper"] {
            assert!(!result.contains(unexpected), "{unexpected}");
        }
    }
}
