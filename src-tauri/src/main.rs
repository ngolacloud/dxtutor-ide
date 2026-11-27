// Prevent an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // H1b: inside the OS sandbox the IDE's binary is the network bridge to the allowlist proxy
    if let Some(code) = tutor_agent::net_proxy::bridge_main() {
        std::process::exit(code);
    }
    dxtutor_ide_lib::run()
}
