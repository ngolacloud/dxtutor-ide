// Prevent an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // H1b: inside the OS sandbox the IDE's binary is the network bridge to the allowlist proxy
    if let Some(code) = tutor_agent::net_proxy::bridge_main() {
        std::process::exit(code);
    }
    // H6a: `dxtutor-ide agent -p "…"` runs the Co-Dev headless and exits (the window never opens)
    let args: Vec<String> = std::env::args().collect();
    if let Some(code) = dxtutor_ide_lib::headless::from_args(&args) {
        std::process::exit(code);
    }
    dxtutor_ide_lib::run()
}
