use task::parse_duration;
use std::time::Duration;

#[test]
fn plain_seconds() {
    assert_eq!(parse_duration("90"), Ok(Duration::from_secs(90)));
}
