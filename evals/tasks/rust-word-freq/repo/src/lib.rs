use std::collections::HashMap;

/// How many times each word appears.
pub fn word_counts(text: &str) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for w in text.split_whitespace() {
        *m.entry(w.to_string()).or_insert(0) += 1;
    }
    m
}

/// The report line for the dashboard.
pub fn report(text: &str) -> String {
    word_counts(text).iter().map(|(w, n)| format!("{w}={n}")).collect::<Vec<_>>().join(" ")
}
