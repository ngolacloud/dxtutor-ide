//! A fake Prometheus for the tests of `metrics`, `deploy` and `review`.
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap_or(b'?'));
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A fake Prometheus: `answer(path, query, authorization)` → (status, JSON body). Serves until dropped.
pub fn fake(answer: impl Fn(&str, &str, &str) -> (u16, String) + Send + 'static) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    std::thread::spawn(move || {
        for s in l.incoming().flatten() {
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            r.read_line(&mut line).unwrap();
            let target = line.split_whitespace().nth(1).unwrap_or("/").to_string();
            let mut auth = String::new();
            loop {
                let mut h = String::new();
                if r.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
                    break;
                }
                if h.to_ascii_lowercase().starts_with("authorization:") {
                    auth = h[14..].trim().to_string();
                }
            }
            let (path, qs) = target.split_once('?').unwrap_or((&target, ""));
            let q = qs
                .split('&')
                .find_map(|kv| kv.strip_prefix("query="))
                .map(decode)
                .unwrap_or_default();
            let (code, body) = answer(path, &q, &auth);
            let mut s = s;
            let _ = write!(
                s,
                "HTTP/1.1 {code} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    url
}

pub fn vector(v: f64) -> String {
    format!("{{\"status\":\"success\",\"data\":{{\"resultType\":\"vector\",\"result\":[{{\"metric\":{{}},\"value\":[1,\"{v}\"]}}]}}}}")
}
pub const EMPTY: &str =
    "{\"status\":\"success\",\"data\":{\"resultType\":\"vector\",\"result\":[]}}";
pub const BUILD: &str = "{\"status\":\"success\",\"data\":{\"version\":\"3.16.0\"}}";
