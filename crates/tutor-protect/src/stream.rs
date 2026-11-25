//! Masking of a process's output as it streams (r23 F4a, X04): the terminal (`pty://data`), the
//! tasks that run in it, and a debugged program's output (`debug://output`). The same rules and
//! learned values as the redaction, applied to each chunk before it leaves the backend.
//!
//! A chunk boundary can split a secret. For a non-interactive stream, [`Masker::holding`] keeps a
//! short tail of an unfinished line (up to [`HOLD`] bytes, only when it could be a secret's start)
//! for the next chunk. An interactive terminal cannot wait — its echo comes a key at a time and a
//! prompt has no newline — so [`Masker::new`] masks each chunk as it is: a secret split across two
//! reads of the PTY can pass (a program usually writes a line in one write).

use crate::redact::current;

/// The most a masker holds back between chunks.
pub const HOLD: usize = 96;

#[derive(Default)]
pub struct Masker {
    tail: String,
    hold: bool,
}

impl Masker {
    /// Each chunk masked as it comes (an interactive terminal).
    pub fn new() -> Self {
        Masker::default()
    }

    /// Holds a possible secret's start until the next chunk (a non-interactive stream).
    pub fn holding() -> Self {
        Masker {
            tail: String::new(),
            hold: true,
        }
    }

    /// The masked text of `chunk` that can be shown now.
    pub fn push(&mut self, chunk: &str) -> String {
        let mut text = std::mem::take(&mut self.tail);
        text.push_str(chunk);
        // hold back the end of an unfinished last line if it may be the start of a secret
        let cut = match text.rfind('\n') {
            Some(i) => i + 1,
            None => 0,
        };
        let last = &text[cut..];
        if self.hold && !last.is_empty() && last.len() <= HOLD && may_continue(last) {
            self.tail = last.to_string();
            text.truncate(cut);
        }
        current().mask(&text)
    }

    /// What is left (the process ended).
    pub fn flush(&mut self) -> String {
        let t = std::mem::take(&mut self.tail);
        current().mask(&t)
    }
}

/// Could the end of this text be the beginning of a secret that the next chunk completes?
/// (a URL with credentials, a key prefix, a `NAME=` assignment.) Prompts and plain output are
/// shown at once.
fn may_continue(s: &str) -> bool {
    let w = s.rsplit(|c: char| c.is_whitespace()).next().unwrap_or("");
    if w.is_empty() {
        return false;
    }
    w.contains("://")
        || w.contains('=')
        || w.contains(':') && w.len() > 3
        || [
            "sk-",
            "ghp_",
            "gho_",
            "github_pat_",
            "AKIA",
            "xox",
            "AIza",
            "eyJ",
            "-----BEGIN",
        ]
        .iter()
        .any(|p| w.starts_with(p) || p.starts_with(w) && w.len() >= 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_across_chunks_and_shows_plain_text_at_once() {
        // an interactive terminal: a typed `export X=` shows at once (masked if it is a secret)
        let mut t = Masker::new();
        assert_eq!(t.push("export X="), "export X=");
        assert_eq!(
            t.push("token ghp_0123456789abcdefghijABCDEFGHIJ\r\n"),
            "token ••••\r\n"
        );
        let mut m = Masker::holding();
        assert_eq!(m.push("$ ls\nsrc  target\n$ "), "$ ls\nsrc  target\n$ ");
        // a URL with credentials split in two chunks
        let a = m.push("DATABASE_URL=postgres://app:s3cr");
        let b = m.push("3tpass@db:5432/app\n");
        assert_eq!(
            format!("{a}{b}"),
            "DATABASE_URL=postgres://app:••••@db:5432/app\n"
        );
        assert!(!a.contains("s3cr"));
        let c = m.push("token ghp_0123456789abcdefghij");
        let d = m.push("ABCDEFGHIJ done\n");
        assert!(!format!("{c}{d}").contains("0123456789"), "{c}{d}");
        assert_eq!(m.push("plain"), "plain");
        assert_eq!(m.flush(), "");
    }
}
