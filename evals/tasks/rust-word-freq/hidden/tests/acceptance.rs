use task::{report, top_words};

#[test]
fn sorted_case_insensitive_without_punctuation() {
    let t = "The cat and the hat. The CAT's hat, isn't it? 42 cats; 42!";
    assert_eq!(
        top_words(t, 4),
        vec![
            ("the".to_string(), 3),
            ("42".to_string(), 2),
            ("hat".to_string(), 2),
            ("and".to_string(), 1),
        ]
    );
    assert_eq!(top_words("", 3), vec![]);
    assert_eq!(top_words("b a", 10), vec![("a".to_string(), 1), ("b".to_string(), 1)]);
}

#[test]
fn the_report_is_stable() {
    assert_eq!(report("b a b"), "b=2 a=1");
}
