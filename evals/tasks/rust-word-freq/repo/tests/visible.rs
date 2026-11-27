use task::word_counts;

#[test]
fn counts_words() {
    assert_eq!(word_counts("a b a")["a"], 2);
}
