use task::Version;

#[test]
fn parses_a_release() {
    let v = Version::parse("1.2.3").unwrap();
    assert_eq!((v.major, v.minor, v.patch), (1, 2, 3));
}
