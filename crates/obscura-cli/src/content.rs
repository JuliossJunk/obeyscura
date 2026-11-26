use anyhow::{bail, Context, Result};
use obscura_dom::content::{markdown_sections, structured_markdown};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::ContentFormat;

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

pub(crate) fn read(
    bytes: Vec<u8>,
    format: ContentFormat,
    cursor: Option<&str>,
    max_bytes: usize,
) -> Result<Vec<u8>> {
    if matches!(format, ContentFormat::Html | ContentFormat::Markdown) {
        if cursor.is_some() {
            bail!("a cursor requires outline or section format");
        }
        return match format {
            ContentFormat::Html => Ok(bytes),
            _ => Ok(structured_markdown(std::str::from_utf8(&bytes)?).into_bytes()),
        };
    }

    let snapshot = format!("{:x}", Sha256::digest(&bytes));
    let start = match cursor {
        Some(cursor) => {
            let (expected, index) = cursor.split_once(':').context("invalid snapshot cursor")?;
            if expected != snapshot {
                bail!("cursor belongs to a different HTML snapshot");
            }
            index.parse::<usize>().context("invalid section index")?
        }
        None if matches!(format, ContentFormat::Section) => bail!("section format requires --cursor"),
        None => 0,
    };

    let (markdown, mut boundaries) = markdown_sections(std::str::from_utf8(&bytes)?);
    if boundaries.first().is_none_or(|section| section.0 != 0) {
        boundaries.insert(0, (0, 0, "Preamble".to_string()));
    }
    let (offset, _, _) = boundaries.get(start).context("section index out of range")?;
    if matches!(format, ContentFormat::Section) {
        let end = boundaries.get(start + 1).map_or(markdown.len(), |next| next.0);
        return Ok(markdown.as_bytes()[*offset..end].to_vec());
    }

    let total = boundaries.len();
    let mut outline = Outline {
        snapshot: &snapshot,
        total_sections: total,
        sections: Vec::new(),
        next_cursor: None,
    };
    let mut entries_bytes = 0;
    for (index, (_, level, title)) in boundaries.into_iter().enumerate().skip(start) {
        let entry = OutlineEntry {
            index,
            level,
            title: title.split_whitespace().flat_map(|word| word.chars().chain([' ']))
                .take(48).collect::<String>().trim_end().to_string(),
        };
        let next_cursor = (index + 1 < total).then(|| format!("{snapshot}:{}", index + 1));
        let envelope = Outline {
            snapshot: &snapshot,
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
    Ok(serde_json::to_vec(&outline)?)
}
