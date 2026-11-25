//! Markdown for captured HTML, independent of the browser that captured it.

use crate::{parse_html, DomTree, NodeData, NodeId};

/// Convert a serialized HTML snapshot to Markdown with HTML for structures
/// that Markdown cannot express faithfully. The caller retains the original
/// snapshot. Parsing the snapshot does not execute scripts or load resources.
pub fn structured_markdown(html: &str) -> String {
    let tree = parse_html(html);
    let Some(body) = tree.query_selector("body").ok().flatten() else {
        return String::new();
    };
    let mut markdown = String::new();
    collect_metadata(&tree, &mut markdown);
    clean_body(&tree, body);

    if block_children(&tree, body) {
        let mut pending = tree.children(body);
        pending.reverse();
        while let Some(id) = pending.pop() {
            let Some(node) = tree.borrow_node(id) else { continue };
            let Some(name) = node.as_element() else { continue };
            let tag = name.local.as_ref();
            let has_attributes = node.attrs().is_some_and(|attrs| !attrs.is_empty());
            if !has_attributes && is_container(tag) && block_children(&tree, id) {
                pending.extend(tree.children(id).into_iter().rev());
            } else if !has_attributes && matches!(tag, "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
                && plain_block(&tree, id, tag, &mut markdown)
            {
                continue;
            } else {
                push_html(&mut markdown, &tree.outer_html(id));
            }
        }
    } else {
        push_html(&mut markdown, &format!("<div>{}</div>", tree.inner_html(body)));
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

fn block_children(tree: &DomTree, id: NodeId) -> bool {
    tree.children(id).into_iter().all(|child| {
        tree.with_node(child, |node| match &node.data {
            NodeData::Text { contents } => contents.trim().is_empty(),
            NodeData::Element { name, .. } => {
                let tag = name.local.as_ref();
                is_container(tag) || matches!(
                    tag,
                    "blockquote" | "details" | "dl" | "figure" | "h1" | "h2" | "h3" | "h4" | "h5"
                        | "h6" | "hr" | "math" | "ol" | "p" | "pre" | "table" | "ul"
                )
            }
            _ => true,
        }).unwrap_or(true)
    })
}

fn plain_block(tree: &DomTree, id: NodeId, tag: &str, out: &mut String) -> bool {
    if !tree.children(id).into_iter().all(|child| tree.with_node(child, |node| node.is_text()) == Some(true)) {
        return false;
    }
    let text = tree.text_content(id).split_ascii_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return false;
    }
    if text.contains(['\\', '`', '*', '_', '[', ']', '<', '>', '&', '~', '|', '#'])
        || text.starts_with(['-', '+', '#', '='])
        || text.trim_start_matches(|ch: char| ch.is_ascii_digit()).starts_with(['.', ')'])
    {
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
            "# Title\n\nMaximum 12.7 W.\n\n<h2 id=\"note\">Note</h2>\n\n<p><a href=\"#note\">Details</a></p>"
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
