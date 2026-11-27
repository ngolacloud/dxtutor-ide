use task::Config;

#[test]
fn defaults() {
    assert_eq!(Config::default().port, 8080);
}
