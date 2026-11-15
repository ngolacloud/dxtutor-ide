use std::path::Path;

fn main() {
    // Re-embed the frontend whenever anything under ../ui changes. The UI is embedded at
    // build time (frontendDist="../ui", no dev server), but tauri_build does not reliably
    // emit rerun-if-changed for individual files inside frontendDist — so a plain
    // `cargo build` / `npm run tauri dev` after editing ui/bridge.js would ship the STALE
    // cached UI (the bug that made the desktop and the headless selftest disagree). Declaring
    // each file explicitly forces the build script (and thus the re-embed) to re-run.
    watch_dir(Path::new("../ui"));
    tauri_build::build();
}

/// Emit `cargo:rerun-if-changed` for every file under `dir`, recursively. Cargo watches a
/// bare directory only for entries added/removed, not for edits to files already in it, so
/// each file is listed individually.
fn watch_dir(dir: &Path) {
    // Watch the directory itself too, so added/removed files are also caught.
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            watch_dir(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}
