#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl Version {
    pub fn parse(s: &str) -> Option<Version> {
        let mut p = s.trim().split('.');
        let v = Version {
            major: p.next()?.parse().ok()?,
            minor: p.next()?.parse().ok()?,
            patch: p.next()?.parse().ok()?,
        };
        if p.next().is_some() {
            return None;
        }
        Some(v)
    }
}
