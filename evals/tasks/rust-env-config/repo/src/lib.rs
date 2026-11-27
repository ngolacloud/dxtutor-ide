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
