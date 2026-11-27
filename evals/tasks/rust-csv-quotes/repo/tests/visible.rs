use task::split_csv_line;

#[test]
fn plain_fields() {
    assert_eq!(split_csv_line("a,b,c").unwrap(), vec!["a", "b", "c"]);
}
