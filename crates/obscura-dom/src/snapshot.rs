use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::content::markdown_sections;
use crate::DomTree;

pub fn capture_html(dom: &DomTree) -> String {
    if let Ok(Some(root)) = dom.query_selector("html") {
        format!("<!DOCTYPE html>\n{}", dom.outer_html(root))
    } else {
        dom.inner_html(dom.document())
    }
}

pub struct ContentSnapshot {
    id: String,
    html: String,
    markdown: String,
    boundaries: Vec<(usize, u8, String)>,
}

#[derive(Serialize)]
struct OutlineEntry {
    index: usize,
    level: u8,
    title: String,
}

#[derive(Serialize)]
struct Outline<'a> {
    snapshot: &'a str,
    total_sections: usize,
    sections: Vec<OutlineEntry>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
struct Chunk<'a> {
    text: &'a str,
    next_cursor: Option<String>,
}

impl ContentSnapshot {
    pub fn new(html: String) -> Self {
        let id = format!("{:x}", Sha256::digest(html.as_bytes()));
        let (markdown, mut boundaries) = markdown_sections(&html);
        if boundaries.first().is_none_or(|section| section.0 != 0) {
            boundaries.insert(0, (0, 0, "Preamble".to_string()));
        }
        Self { id, html, markdown, boundaries }
    }

    fn cursor_suffix<'a>(&self, cursor: &'a str) -> Result<&'a str> {
        let (id, suffix) = cursor.split_once(':').context("invalid snapshot cursor")?;
        if id != self.id {
            bail!("cursor belongs to a different HTML snapshot");
        }
        Ok(suffix)
    }

    fn section_at(&self, index: usize) -> Result<&str> {
        let (start, _, _) = self.boundaries.get(index).context("section index out of range")?;
        let end = self.boundaries.get(index + 1).map_or(self.markdown.len(), |next| next.0);
        Ok(&self.markdown[*start..end])
    }

    pub fn section(&self, cursor: &str) -> Result<&str> {
        let index = self.cursor_suffix(cursor)?.parse().context("invalid section index")?;
        self.section_at(index)
    }

    pub fn outline(&self, cursor: Option<&str>, max_bytes: usize) -> Result<String> {
        let start = match cursor {
            Some(cursor) => self.cursor_suffix(cursor)?.parse().context("invalid section index")?,
            None => 0,
        };
        let total = self.boundaries.len();
        if start >= total {
            bail!("section index out of range");
        }
        let mut outline = Outline {
            snapshot: &self.id,
            total_sections: total,
            sections: Vec::new(),
            next_cursor: None,
        };
        let mut entries_bytes = 0;
        for (index, (_, level, title)) in self.boundaries.iter().enumerate().skip(start) {
            let entry = OutlineEntry {
                index,
                level: *level,
                title: title.split_whitespace().flat_map(|word| word.chars().chain([' ']))
                    .take(48).collect::<String>().trim_end().to_string(),
            };
            let next_cursor = (index + 1 < total).then(|| format!("{}:{}", self.id, index + 1));
            let envelope = Outline {
                snapshot: &self.id,
                total_sections: total,
                sections: Vec::new(),
                next_cursor,
            };
            let entry_bytes = serde_json::to_vec(&entry)?.len() + usize::from(index != start);
            if serde_json::to_vec(&envelope)?.len() + entries_bytes + entry_bytes > max_bytes {
                break;
            }
            entries_bytes += entry_bytes;
            outline.sections.push(entry);
            outline.next_cursor = envelope.next_cursor;
        }
        if outline.sections.is_empty() {
            bail!("outline byte budget cannot fit one entry");
        }
        Ok(serde_json::to_string(&outline)?)
    }

    pub fn section_chunk(&self, cursor: &str, max_bytes: usize) -> Result<String> {
        let suffix = self.cursor_suffix(cursor)?;
        let (index, offset) = suffix.split_once(':').unwrap_or((suffix, "0"));
        let index = index.parse::<usize>().context("invalid section index")?;
        let text = self.section_at(index)?;
        self.chunk(text, &index.to_string(), offset, max_bytes)
    }

    pub fn html_chunk(&self, cursor: &str, max_bytes: usize) -> Result<String> {
        let offset = self.cursor_suffix(cursor)?.strip_prefix("html:").context("invalid HTML cursor")?;
        self.chunk(&self.html, "html", offset, max_bytes)
    }

    fn chunk(&self, text: &str, target: &str, offset: &str, max_bytes: usize) -> Result<String> {
        let start = offset.parse::<usize>().context("invalid chunk offset")?;
        let remaining = text.get(start..).context("chunk offset is outside a UTF-8 boundary")?;
        let serialize = |length| {
            let end = start + length;
            let next_cursor = (end < text.len()).then(|| format!("{}:{target}:{end}", self.id));
            serde_json::to_string(&Chunk { text: &text[start..end], next_cursor })
        };
        let mut max_length = max_bytes.min(remaining.len());
        while !remaining.is_char_boundary(max_length) {
            max_length -= 1;
        }
        let candidate = serialize(max_length)?;
        if candidate.len() <= max_bytes {
            return Ok(candidate);
        }
        // With a continuation cursor the serialized size is monotone in the
        // chunk length. The final chunk was checked above before this search.
        let mut low = 0;
        let mut high = max_length;
        while low + 1 < high {
            let mid = low + (high - low) / 2;
            let mut boundary = mid;
            while !remaining.is_char_boundary(boundary) {
                boundary -= 1;
            }
            if serialize(boundary)?.len() <= max_bytes {
                low = mid;
            } else {
                high = mid;
            }
        }
        while !remaining.is_char_boundary(low) {
            low -= 1;
        }
        if low == 0 {
            bail!("chunk byte budget cannot fit the next character");
        }
        Ok(serialize(low)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn chunks_recover_multibyte_text_and_escaped_characters() {
        let html = format!("<h1>Heading</h1><pre>{}</pre>", "\nПример 🔬 \"".repeat(250));
        let snapshot = ContentSnapshot::new(html.clone());
        let outline: Value = serde_json::from_str(&snapshot.outline(None, 512).unwrap()).unwrap();
        let id = outline["snapshot"].as_str().unwrap();
        let section_cursor = format!("{id}:0");
        let markup = snapshot.section(&section_cursor).unwrap();
        for (initial, expected, read_html) in [
            (format!("{id}:html:0"), html.as_str(), true),
            (section_cursor, markup, false),
        ] {
            let mut actual = String::new();
            let mut cursor = initial;
            loop {
                let json = if read_html {
                    snapshot.html_chunk(&cursor, 512)
                } else {
                    snapshot.section_chunk(&cursor, 512)
                }.unwrap();
                assert!(json.len() <= 512);
                let chunk: Value = serde_json::from_str(&json).unwrap();
                actual.push_str(chunk["text"].as_str().unwrap());
                let Some(next) = chunk["next_cursor"].as_str() else { break };
                assert_ne!(next, cursor);
                cursor = next.to_string();
            }
            assert_eq!(actual, expected);
        }
    }
}
