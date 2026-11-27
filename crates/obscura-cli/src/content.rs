use anyhow::{bail, Context, Result};
use obscura_dom::{content::structured_markdown, snapshot::ContentSnapshot};

use crate::ContentFormat;

pub(crate) fn read(
    bytes: Vec<u8>,
    format: ContentFormat,
    cursor: Option<&str>,
    max_bytes: usize,
) -> Result<Vec<u8>> {
    if matches!(format, ContentFormat::Html | ContentFormat::Markdown) && cursor.is_some() {
        bail!("a cursor requires outline or section format");
    }
    match format {
        ContentFormat::Html => Ok(bytes),
        ContentFormat::Markdown => Ok(structured_markdown(std::str::from_utf8(&bytes)?).into_bytes()),
        ContentFormat::Outline => {
            let snapshot = ContentSnapshot::new(String::from_utf8(bytes)?);
            Ok(snapshot.outline(cursor, max_bytes)?.into_bytes())
        }
        ContentFormat::Section => {
            let cursor = cursor.context("section format requires --cursor")?;
            let snapshot = ContentSnapshot::new(String::from_utf8(bytes)?);
            Ok(snapshot.section(cursor)?.as_bytes().to_vec())
        }
    }
}
