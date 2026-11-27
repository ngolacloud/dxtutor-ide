use std::collections::HashMap;

/// The `n` most frequent words: lowercase letters, digits and apostrophes; by count, then alphabetically.
pub fn top_words(text: &str, n: usize) -> Vec<(String, usize)> {
    let mut m: HashMap<String, usize> = HashMap::new();
    for raw in text.split(|c: char| !(c.is_alphanumeric() || c == '\'')) {
        let w = raw.trim_matches('\'').to_lowercase();
        if !w.is_empty() {
            *m.entry(w).or_insert(0) += 1;
        }
    }
    let mut v: Vec<(String, usize)> = m.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v.truncate(n);
    v
}

/// The report line for the dashboard.
pub fn report(text: &str) -> String {
    top_words(text, usize::MAX).iter().map(|(w, n)| format!("{w}={n}")).collect::<Vec<_>>().join(" ")
}
