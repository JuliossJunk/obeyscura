use std::io::Write;
use std::process::{Command, Output, Stdio};

fn run_content(format: &str, html: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_obscura"))
        .args(["content", "--format", format])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start content command");
    child.stdin.take().unwrap().write_all(html).expect("write HTML");
    child.wait_with_output().expect("get content result")
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
