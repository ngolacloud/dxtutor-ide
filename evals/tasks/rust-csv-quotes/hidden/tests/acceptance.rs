use task::{split_csv_line, CsvError};

#[test]
fn quoted_fields() {
    assert_eq!(
        split_csv_line(r#"42,"Smith, John","He said ""hi""""#).unwrap(),
        vec!["42", "Smith, John", r#"He said "hi""#]
    );
    assert_eq!(split_csv_line(r#""",x,"""#).unwrap(), vec!["", "x", ""]);
    assert_eq!(split_csv_line("a,,b").unwrap(), vec!["a", "", "b"]);
    assert_eq!(split_csv_line("").unwrap(), vec![""]);
}

#[test]
fn unterminated_quote() {
    assert_eq!(split_csv_line(r#"a,"b"#), Err(CsvError::UnterminatedQuote));
}
