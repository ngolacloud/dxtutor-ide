use task::top_words;

#[test]
fn counts_words() {
    assert_eq!(top_words("a b a", 1), vec![("a".to_string(), 2)]);
}
