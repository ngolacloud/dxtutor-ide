use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
pub struct ParseError;

/// Parses a duration from a config value.
pub fn parse_duration(s: &str) -> Result<Duration, ParseError> {
    let secs: u64 = s.trim().parse().map_err(|_| ParseError)?;
    Ok(Duration::from_secs(secs))
}
