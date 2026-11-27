use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
pub struct ParseError;

/// Parses a duration from a config value: `90` (seconds) or units `h`, `m`, `s`, `ms` combined.
pub fn parse_duration(s: &str) -> Result<Duration, ParseError> {
    let s = s.trim();
    if s.is_empty() {
        return Err(ParseError);
    }
    if s.bytes().all(|b| b.is_ascii_digit()) {
        return s.parse().map(Duration::from_secs).map_err(|_| ParseError);
    }
    let mut total = Duration::ZERO;
    let mut seen: Vec<&str> = vec![];
    let mut rest = s;
    while !rest.is_empty() {
        let n = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
        if n == 0 {
            return Err(ParseError);
        }
        let value: u64 = rest[..n].parse().map_err(|_| ParseError)?;
        rest = &rest[n..];
        let unit = if rest.starts_with("ms") { "ms" } else if rest.starts_with('h') { "h" } else if rest.starts_with('m') { "m" } else if rest.starts_with('s') { "s" } else { return Err(ParseError) };
        if seen.contains(&unit) {
            return Err(ParseError);
        }
        seen.push(unit);
        rest = &rest[unit.len()..];
        total += match unit {
            "h" => Duration::from_secs(value * 3600),
            "m" => Duration::from_secs(value * 60),
            "s" => Duration::from_secs(value),
            _ => Duration::from_millis(value),
        };
    }
    Ok(total)
}
