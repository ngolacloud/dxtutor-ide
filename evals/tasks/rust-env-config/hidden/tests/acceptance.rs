use task::{Config, ConfigError};

#[test]
fn overrides_apply() {
    let mut c = Config::default();
    c.apply_env(&[("APP_PORT", "9000"), ("APP_HOST", "0.0.0.0"), ("APP_DEBUG", "1"), ("APP_WORKERS", "16"), ("PATH", "/bin")]).unwrap();
    assert_eq!(c, Config { host: "0.0.0.0".into(), port: 9000, debug: true, workers: 16 });
    c.apply_env(&[("APP_DEBUG", "false")]).unwrap();
    assert!(!c.debug);
}

#[test]
fn invalid_values_change_nothing() {
    let mut c = Config::default();
    let e = c.apply_env(&[("APP_HOST", "x"), ("APP_PORT", "70000")]).unwrap_err();
    assert_eq!(e, ConfigError { var: "APP_PORT".into(), value: "70000".into() });
    assert_eq!(c, Config::default(), "all or nothing");
    assert!(c.apply_env(&[("APP_WORKERS", "0")]).is_err());
    assert!(c.apply_env(&[("APP_WORKERS", "65")]).is_err());
    assert!(c.apply_env(&[("APP_DEBUG", "yes")]).is_err());
    assert_eq!(c, Config::default());
}
