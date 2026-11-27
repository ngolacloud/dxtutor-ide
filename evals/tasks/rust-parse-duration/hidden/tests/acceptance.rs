use task::{parse_duration, ParseError};
use std::time::Duration;

#[test]
fn units_combine() {
    assert_eq!(parse_duration("1h30m"), Ok(Duration::from_secs(5400)));
    assert_eq!(parse_duration("45s"), Ok(Duration::from_secs(45)));
    assert_eq!(parse_duration("250ms"), Ok(Duration::from_millis(250)));
    assert_eq!(parse_duration("2h5s"), Ok(Duration::from_secs(7205)));
    assert_eq!(parse_duration("1m500ms"), Ok(Duration::from_millis(60_500)));
    assert_eq!(parse_duration("90"), Ok(Duration::from_secs(90)));
}

#[test]
fn bad_input_is_an_error() {
    for bad in ["", "h", "5x", "1h1h", "3m2m", "-5s", "1.5h"] {
        assert_eq!(parse_duration(bad), Err(ParseError), "{bad}");
    }
}
