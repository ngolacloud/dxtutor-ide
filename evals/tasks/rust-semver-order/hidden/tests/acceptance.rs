use task::Version;

fn v(s: &str) -> Version {
    Version::parse(s).unwrap_or_else(|| panic!("{s}"))
}

#[test]
fn semver_precedence() {
    let order = [
        "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11",
        "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0",
    ];
    for w in order.windows(2) {
        assert!(v(w[0]) < v(w[1]), "{} < {}", w[0], w[1]);
    }
    let mut shuffled: Vec<Version> = order.iter().rev().map(|s| v(s)).collect();
    shuffled.sort();
    assert_eq!(shuffled, order.iter().map(|s| v(s)).collect::<Vec<_>>());
}

#[test]
fn build_metadata_is_ignored_and_bad_input_refused() {
    assert_eq!(v("1.0.0+build.5").cmp(&v("1.0.0")), std::cmp::Ordering::Equal);
    assert!(Version::parse("1.0").is_none());
    assert!(Version::parse("1.0.0-").is_none());
    assert!(Version::parse("a.b.c").is_none());
}
