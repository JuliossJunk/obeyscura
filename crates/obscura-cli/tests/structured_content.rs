use std::io::Write;
use std::process::{Command, Output, Stdio};

fn run_content(format: &str, html: &[u8]) -> Output {
    run_content_with(format, html, &[])
}

fn run_content_with(format: &str, html: &[u8], args: &[&str]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .args(["content", "--format", format])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start content command");
    child.stdin.take().unwrap().write_all(html).expect("write HTML");
    child.wait_with_output().expect("get content result")
}

#[test]
fn outline_pages_restore_every_section_from_the_same_snapshot() {
    let mut html = String::from("<p>Preamble</p>");
    for index in 0..25 {
        html.push_str(&format!("<h2>Раздел {index}</h2><p>Значение {index}</p>"));
    }
    let mut cursor = None::<String>;
    let mut restored = Vec::new();
    let mut expected_index = 0;
    let mut pages = 0;
    loop {
        let mut args = vec!["--max-bytes", "512"];
        if let Some(cursor) = &cursor {
            args.extend(["--cursor", cursor]);
        }
        let output = run_content_with("outline", html.as_bytes(), &args);
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(output.stdout.len() <= 512);
        pages += 1;
        let page: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let snapshot = page["snapshot"].as_str().unwrap();
        for entry in page["sections"].as_array().unwrap() {
            assert_eq!(entry["index"].as_u64(), Some(expected_index));
            expected_index += 1;
            let section = format!("{snapshot}:{}", entry["index"]);
            let output = run_content_with("section", html.as_bytes(), &["--cursor", &section]);
            assert!(output.status.success());
            restored.extend(output.stdout);
        }
        cursor = page["next_cursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            assert_eq!(page["total_sections"].as_u64(), Some(expected_index));
            let stale = run_content_with("section", b"<h1>Other</h1>", &["--cursor", &format!("{snapshot}:0")]);
            assert!(!stale.status.success());
            break;
        }
    }
    assert!(pages > 1);
    assert_eq!(expected_index, 26);
    assert_eq!(restored, run_content("markdown", html.as_bytes()).stdout);
}

#[test]
fn content_converts_captured_html_and_can_return_the_same_snapshot() {
    let html = b"<!DOCTYPE html>\r\n<h1>Experiment</h1><table><caption>Power</caption>\r\n<tr><td>12.7 W</td></tr></table>";
    let raw = run_content("html", html);
    assert!(raw.status.success());
    assert_eq!(raw.stdout.as_slice(), &html[..]);

    let markdown = run_content("markdown", html);
    assert!(markdown.status.success(), "{}", String::from_utf8_lossy(&markdown.stderr));
    let text = String::from_utf8(markdown.stdout).expect("UTF-8 Markdown");
    assert!(text.starts_with("# Experiment\n\n"));
    assert!(text.contains("<caption>Power</caption>"));
    assert!(text.contains("<td>12.7 W</td>"));
}
