//! RF-P05 (docs/v2/RF-DELONIX-PLANO.md F6.4): a hosted PairCode token expires when nobody
//! joins in time. Its own test binary: it sets the idle time through the environment.

#[test]
fn the_idle_time_comes_from_the_environment_and_defaults_to_30_minutes() {
    std::env::remove_var("DXTUTOR_PAIR_IDLE_SECS");
    assert_eq!(dxtutor_ide_lib::pair::host_idle().as_secs(), 30 * 60);
    std::env::set_var("DXTUTOR_PAIR_IDLE_SECS", "1");
    assert_eq!(dxtutor_ide_lib::pair::host_idle().as_secs(), 1);
    std::env::set_var("DXTUTOR_PAIR_IDLE_SECS", "zero");
    assert_eq!(dxtutor_ide_lib::pair::host_idle().as_secs(), 30 * 60);
}
