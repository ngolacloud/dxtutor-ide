#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub debug: bool,
    pub workers: u8,
}

impl Default for Config {
    fn default() -> Self {
        Config { host: "127.0.0.1".into(), port: 8080, debug: false, workers: 4 }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ConfigError {
    pub var: String,
    pub value: String,
}

impl Config {
    /// Applies `APP_*` overrides; all or nothing.
    pub fn apply_env(&mut self, vars: &[(&str, &str)]) -> Result<(), ConfigError> {
        let mut next = self.clone();
        for (k, v) in vars {
            let bad = || ConfigError { var: k.to_string(), value: v.to_string() };
            match *k {
                "APP_PORT" => next.port = v.parse().map_err(|_| bad())?,
                "APP_HOST" => next.host = v.to_string(),
                "APP_DEBUG" => {
                    next.debug = match *v {
                        "true" | "1" => true,
                        "false" | "0" => false,
                        _ => return Err(bad()),
                    }
                }
                "APP_WORKERS" => {
                    let n: u8 = v.parse().map_err(|_| bad())?;
                    if !(1..=64).contains(&n) {
                        return Err(bad());
                    }
                    next.workers = n;
                }
                _ => {}
            }
        }
        *self = next;
        Ok(())
    }
}
