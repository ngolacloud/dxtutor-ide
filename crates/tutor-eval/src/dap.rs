//! Debug capability detection (section 5 — DAP).
//!
//! Honest by design: real step-through debugging (breakpoints, variable/stack inspection)
//! needs a Debug Adapter Protocol adapter on the host — `lldb-dap` (`lldb-vscode`), the ones
//! `dapc` drives over stdio — backed by an `lldb`/`gdb` engine. (`codelldb` was listed here but
//! `dapc` cannot drive it — it speaks DAP over TCP — so it is no longer offered: r23 F2.) When none is present, the IDE must
//! say so and fall back to the instrumentation tracer (Visualize), never pretend to have a
//! debugger. This module only *detects*; it starts nothing.

use std::path::PathBuf;

use serde::Serialize;

/// DAP adapters that speak the protocol a debugger UI drives.
const ADAPTERS: &[&str] = crate::dapc::STDIO_ADAPTERS;
/// Underlying debug engines a DAP adapter needs (and bare wrappers like `rust-lldb`).
const ENGINES: &[&str] = &["lldb", "gdb"];

/// What the host can really do for debugging, surfaced to the Run-and-Debug view.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCapability {
    /// True only when a usable DAP adapter is present — the one honest gate for offering
    /// real breakpoints.
    pub available: bool,
    /// The DAP adapter binary found, if any.
    pub adapter: Option<String>,
    /// The underlying debug engine found, if any (`lldb`/`gdb`).
    pub engine: Option<String>,
    /// A human-readable explanation of what is (or isn't) possible and the fallback.
    pub note: String,
    /// Recording and replay (rr) — r23 F2: why not, when not.
    pub time_travel: TimeTravel,
}

/// Can this host record a run and replay it backwards (rr)? `reason` is a code the UI words:
/// `ok`, `not-linux`, `no-rr`, `no-gdb` (rr replays through gdb), `perf-paranoid` (the kernel
/// hides the performance counters rr needs: `kernel.perf_event_paranoid` must be ≤ 1).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTravel {
    pub available: bool,
    pub reason: String,
    /// the kernel's `perf_event_paranoid` (Linux)
    pub perf_event_paranoid: Option<i32>,
}

/// The time-travel gate from what was found (pure, for the tests).
pub fn time_travel_from(linux: bool, rr: bool, gdb: bool, paranoid: Option<i32>) -> TimeTravel {
    let reason = if !linux {
        "not-linux"
    } else if !rr {
        "no-rr"
    } else if !gdb {
        "no-gdb"
    } else if paranoid.map(|p| p > 1).unwrap_or(true) {
        "perf-paranoid"
    } else {
        "ok"
    };
    TimeTravel {
        available: reason == "ok",
        reason: reason.into(),
        perf_event_paranoid: paranoid,
    }
}

fn perf_event_paranoid() -> Option<i32> {
    std::fs::read_to_string("/proc/sys/kernel/perf_event_paranoid")
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

pub fn detect_time_travel() -> TimeTravel {
    time_travel_from(
        cfg!(target_os = "linux"),
        on_path("rr").is_some(),
        on_path("gdb").is_some(),
        perf_event_paranoid(),
    )
}

/// Is `tool` an executable file on `PATH`? (A dependency-free `which`.)
fn on_path(tool: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(tool);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Detect the host's debug capability. Deterministic from `PATH`; never panics.
pub fn detect_debug_adapter() -> DebugCapability {
    let adapter = ADAPTERS
        .iter()
        .find(|a| on_path(a).is_some())
        .map(|a| a.to_string());
    let engine = ENGINES
        .iter()
        .find(|e| on_path(e).is_some())
        .map(|e| e.to_string());
    let available = adapter.is_some();

    let note = if let Some(a) = &adapter {
        format!(
            "DAP debugging available via `{a}` — real breakpoints and variable/stack inspection."
        )
    } else if let Some(e) = &engine {
        format!(
            "A debug engine (`{e}`) is installed, but no DAP adapter (lldb-dap) was \
             found — install one for step-debugging. Until then, step through with Visualize \
             (the instrumentation tracer)."
        )
    } else {
        "No DAP adapter or debug engine found. Step-through uses the instrumentation tracer \
         (Visualize); real breakpoints need lldb-dap plus lldb or gdb."
            .to_string()
    };

    DebugCapability {
        available,
        adapter,
        engine,
        note,
        time_travel: detect_time_travel(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_is_honest_and_total() {
        let cap = detect_debug_adapter();
        // The note always explains the situation (and never claims a debugger we lack).
        assert!(!cap.note.is_empty());
        // `available` is true only when an adapter was actually found.
        assert_eq!(cap.available, cap.adapter.is_some());
        // When unavailable, the note must point at the honest fallback.
        if !cap.available {
            assert!(
                cap.note.contains("Visualize") || cap.note.contains("tracer"),
                "note must name the fallback: {}",
                cap.note
            );
        }
    }

    #[test]
    fn time_travel_says_what_is_missing_first() {
        assert_eq!(
            time_travel_from(false, true, true, Some(1)).reason,
            "not-linux"
        );
        assert_eq!(time_travel_from(true, false, true, Some(1)).reason, "no-rr");
        assert_eq!(
            time_travel_from(true, true, false, Some(1)).reason,
            "no-gdb"
        );
        assert_eq!(
            time_travel_from(true, true, true, Some(4)).reason,
            "perf-paranoid"
        );
        assert_eq!(
            time_travel_from(true, true, true, None).reason,
            "perf-paranoid"
        );
        let ok = time_travel_from(true, true, true, Some(1));
        assert!(ok.available && ok.reason == "ok");
        // codelldb is not offered: dapc cannot drive it
        assert!(!ADAPTERS.contains(&"codelldb"));
    }

    #[test]
    fn on_path_finds_a_known_binary() {
        // `sh` is on PATH on any POSIX host the tests run on.
        assert!(on_path("sh").is_some());
        assert!(on_path("definitely-not-a-real-binary-xyz").is_none());
    }
}
