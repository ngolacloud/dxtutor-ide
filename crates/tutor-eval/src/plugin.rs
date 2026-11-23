//! Declarative **language plugins** — adding a language without writing Rust.
//!
//! # Why
//!
//! Until now each language was a hand-written [`LanguageRunner`]: [`crate::runner::RustRunner`],
//! [`crate::go_runner::GoRunner`], [`crate::js_runner::JsRunner`]. Adding a language meant
//! writing a Rust type and wiring a branch in [`crate::lang`]. That is a high bar for the
//! community: a teacher who wants to add C, Zig, Ruby or Kotlin should not have to compile the
//! tutor.
//!
//! This module turns a language into **data**: a [`LanguagePlugin`] descriptor (serde-deserialized
//! from TOML) says what image to use, what files to scaffold and which shell command templates run
//! the program, the tests and the diagnostics. A single generic [`PluginRunner`] interprets that
//! descriptor and implements [`LanguageRunner`] for it — reusing the exact same host/container
//! hardening the native runners use ([`crate::runner::run_guarded`] on the host,
//! [`crate::container::run_in_container`] in a sandbox).
//!
//! # The descriptor format
//!
//! A plugin is a TOML file. Minimal C example:
//!
//! ```toml
//! id = "c"
//! aliases = ["clang", "gcc"]
//! display_name = "C"
//! monaco_id = "c"
//! extensions = ["c", "h"]
//! image = "gcc:13"              # container image (used when the engine is not Host)
//! host_bin = "cc"              # host binary to probe for availability (optional)
//! network = false              # give the container network (for package managers)
//!
//! # File scaffolding. The student's code goes into `code_file`; the phase's tests go
//! # into `test_file` (optional), each optionally prefixed with a prelude.
//! code_file = "student.c"
//! test_file = "student_test.c"
//! code_prelude = ""
//! test_prelude = "#include \"student.c\"\n"   # the test translation unit pulls the student in
//!
//! # Command templates. Run as `sh -c "<script>"`, with the work dir as cwd. Placeholders:
//! #   {dir}  → the work directory ("." — cwd is already the work dir)
//! #   {file} → the code file name          {test_file} → the test file name
//! #   {entry}→ the phase entry-point name (the function the student must implement)
//! run_cmd  = "cc -O2 {file} -o prog && ./prog"          # run a COMPLETE program (drill)
//! test_cmd = "cc -O2 {test_file} -o testbin && ./testbin"  # CORRECTNESS: exit 0 == passed
//! diag_cmd = "cc -fsyntax-only {file}"                   # DIAGNOSTICS: file:line:col: sev: msg
//!
//! # Optional: persistent package caches (mounted only in the container path).
//! # [[cache_volumes]]
//! # name = "dxtutor-npm"
//! # target = "/root/.npm"
//! ```
//!
//! # The correctness protocol
//!
//! Deliberately simple and honest: **exit code 0 ⇒ passed**. `test_cmd` compiles the student code
//! together with the phase tests and runs them; a failing assertion must make the test binary exit
//! non-zero. No bespoke harness, no heuristic — the language's own tooling is the source of truth,
//! exactly like the native runners. The human-readable summary is derived from the exit code and a
//! light scan for a compile error (`error:` in the output).
//!
//! # Diagnostics
//!
//! `diag_cmd` compiles the student code alone; each `file:line:col: severity: message` line
//! (the GCC/Clang family's format) becomes a positional [`Diagnostic`].
//!
//! # Complexity probing
//!
//! Optional and **off by default** for plugins: a generic empirical complexity probe would need a
//! language-specific timing harness, which the native runners hand-write. A plugin therefore
//! reports no samples (so the estimate is simply absent) rather than faking one — keeping the
//! honesty principle. Native languages that want probing keep their dedicated runner.
//!
//! # Registry
//!
//! [`registry`] returns the built-in descriptors ([`builtin_plugins`]) plus any `*.toml` dropped in
//! the user plugin directory (`$XDG_CONFIG_HOME/dxtutor/plugins/` or `~/.config/dxtutor/plugins/`).
//! User plugins are searched first, so a drop-in can override a built-in id. [`find_plugin`] matches
//! a language string against each descriptor's `id`, `aliases` or `extensions`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;
use tutor_core::Phase;

use crate::complexity::Sample;
use crate::container::{current_engine, run_in_container, ContainerSpec, SandboxEngine};
use crate::lang::{Diagnostic, LanguageRunner, Severity};
use crate::runner::{run_guarded, RunOutput};

/// A persistent package cache mounted in the container path — `(name, /target)`.
#[derive(Debug, Clone, Deserialize)]
pub struct CacheVolume {
    pub name: String,
    pub target: String,
}

fn default_timeout_secs() -> u64 {
    60
}

/// A declarative language descriptor. Deserialized from a TOML plugin file; see the module header
/// for the full format and an example.
#[derive(Debug, Clone, Deserialize)]
pub struct LanguagePlugin {
    /// Canonical id (e.g. `"c"`). Primary match key for [`find_plugin`].
    pub id: String,
    /// Alternative names that also select this plugin (e.g. `["clang", "gcc"]`).
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Human-facing name for the UI (e.g. `"C"`).
    pub display_name: String,
    /// Monaco editor language id for syntax highlighting (e.g. `"c"`).
    #[serde(default)]
    pub monaco_id: String,
    /// File extensions handled (also usable as match keys), without the dot.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Container image used when the engine is not Host (e.g. `"gcc:13"`).
    pub image: String,
    /// Host binary probed for availability on the host path (e.g. `"cc"`). Optional.
    #[serde(default)]
    pub host_bin: Option<String>,
    /// Extra directories where `host_bin` may live outside the system `PATH` (`~/` and a `*`
    /// version segment are expanded, e.g. `"~/.nvm/versions/node/*/bin"`). Optional.
    #[serde(default)]
    pub host_path_hints: Vec<String>,
    /// Give the container network access (needed for package managers). Default `false`.
    #[serde(default)]
    pub network: bool,
    /// Persistent package caches (container path only).
    #[serde(default)]
    pub cache_volumes: Vec<CacheVolume>,

    /// File name the student's code is written to (e.g. `"student.c"`).
    pub code_file: String,
    /// File name the phase tests are written to (e.g. `"student_test.c"`). Optional: languages whose
    /// `test_cmd` embeds the tests differently may omit it.
    #[serde(default)]
    pub test_file: Option<String>,
    /// Text prepended to the student's code when scaffolding (imports, headers…).
    #[serde(default)]
    pub code_prelude: String,
    /// Text prepended to the phase tests when scaffolding (e.g. `#include "student.c"`).
    #[serde(default)]
    pub test_prelude: String,

    /// Shell script template to run a **complete** program (drill). See placeholders above.
    pub run_cmd: String,
    /// Shell script template to run the **tests** (correctness). Exit 0 ⇒ passed.
    pub test_cmd: String,
    /// Shell script template to produce **diagnostics**. Optional. `file:line:col: sev: msg`.
    #[serde(default)]
    pub diag_cmd: Option<String>,

    /// Wall-clock timeout (seconds) on the host path.
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    /// Wall-clock timeout (seconds) in the container path. Defaults to `4 ×` the host timeout (the
    /// first container run may pull images / warm caches). Optional.
    #[serde(default)]
    pub container_timeout_secs: Option<u64>,
}

impl LanguagePlugin {
    /// `true` if `language` (case-insensitive) matches this plugin's id, an alias or an extension.
    pub fn matches(&self, language: &str) -> bool {
        let want = language.trim().to_ascii_lowercase();
        if self.id.eq_ignore_ascii_case(&want) {
            return true;
        }
        if self.aliases.iter().any(|a| a.eq_ignore_ascii_case(&want)) {
            return true;
        }
        self.extensions
            .iter()
            .any(|e| e.eq_ignore_ascii_case(&want))
    }

    /// The effective host timeout.
    fn host_timeout(&self) -> Duration {
        Duration::from_secs(self.timeout_secs.max(1))
    }

    /// The effective container timeout (explicit, or `4 ×` the host timeout).
    fn container_timeout(&self) -> Duration {
        let secs = self
            .container_timeout_secs
            .unwrap_or_else(|| self.timeout_secs.saturating_mul(4).max(1));
        Duration::from_secs(secs.max(1))
    }

    /// `true` if this plugin can run on the host right now — i.e. `host_bin` is resolvable on the
    /// `PATH` or in one of the `host_path_hints` (or no `host_bin` was declared).
    pub fn host_available(&self) -> bool {
        match &self.host_bin {
            None => true,
            Some(bin) => bin_on_path(bin) || self.hint_dirs().iter().any(|d| d.join(bin).is_file()),
        }
    }

    /// The `host_path_hints` expanded: `~/` → home, and a `*` path segment → the directory with
    /// the highest version-like name (so `~/.nvm/versions/node/*/bin` picks the newest Node).
    fn hint_dirs(&self) -> Vec<PathBuf> {
        self.host_path_hints
            .iter()
            .filter_map(|h| expand_hint(h))
            .filter(|d| d.is_dir())
            .collect()
    }

    /// The `PATH` for a host run: the hardened base, plus the hint directories, plus the directory
    /// where `host_bin` was found on the caller's `PATH` (a toolchain installed in a user location
    /// — nvm, Volta, Homebrew — must still be reachable after `env_clear`).
    fn host_path(&self) -> String {
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Some(bin) = &self.host_bin {
            if let Some(found) = find_on_path(bin) {
                if let Some(parent) = found.parent() {
                    dirs.push(parent.to_path_buf());
                }
            }
        }
        dirs.extend(self.hint_dirs());
        let mut parts: Vec<String> = dirs.iter().map(|d| d.display().to_string()).collect();
        parts.push("/usr/local/bin:/usr/bin:/bin".to_string());
        parts.join(":")
    }
}

/// Expand one `host_path_hints` entry (see [`LanguagePlugin::hint_dirs`]).
fn expand_hint(hint: &str) -> Option<PathBuf> {
    let path = match hint.strip_prefix("~/") {
        Some(rest) => PathBuf::from(std::env::var_os("HOME")?).join(rest),
        None => PathBuf::from(hint),
    };
    let mut out = PathBuf::new();
    for comp in path.components() {
        if comp.as_os_str() == "*" {
            let mut names: Vec<String> = std::fs::read_dir(&out)
                .ok()?
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            names.sort_by_key(|n| version_key(n));
            out.push(names.pop()?);
        } else {
            out.push(comp);
        }
    }
    Some(out)
}

/// `v24.14.1` → `[24, 14, 1]`, so versions compare numerically (`v10` > `v9`).
fn version_key(name: &str) -> Vec<u64> {
    name.split(|c: char| !c.is_ascii_digit())
        .filter_map(|p| p.parse().ok())
        .collect()
}

/// Lightweight, UI-facing view of a registered language (for a future language picker).
#[derive(Debug, Clone)]
pub struct LanguageInfo {
    pub id: String,
    pub display_name: String,
    pub monaco_id: String,
    pub extensions: Vec<String>,
    /// `true` for a built-in descriptor, `false` for one loaded from the plugin directory.
    pub builtin: bool,
}

// ── Template expansion ───────────────────────────────────────────────────────────

/// Expand a command template's `{dir}`/`{file}`/`{test_file}`/`{entry}` placeholders. The work dir
/// is the process cwd in both host and container, so `{dir}` is `"."` and the file placeholders are
/// plain relative names — identical on both paths.
fn expand(template: &str, plugin: &LanguagePlugin, entry: &str) -> String {
    template
        .replace("{dir}", ".")
        .replace("{file}", &plugin.code_file)
        .replace("{test_file}", plugin.test_file.as_deref().unwrap_or(""))
        .replace("{entry}", entry)
}

// ── The generic runner ───────────────────────────────────────────────────────────

/// A [`LanguageRunner`] driven entirely by a [`LanguagePlugin`] descriptor.
#[derive(Debug, Clone)]
pub struct PluginRunner {
    plugin: LanguagePlugin,
}

impl PluginRunner {
    pub fn new(plugin: LanguagePlugin) -> Self {
        PluginRunner { plugin }
    }

    /// The descriptor this runner serves.
    pub fn plugin(&self) -> &LanguagePlugin {
        &self.plugin
    }

    /// Scaffold the student code (and, if `tests` is given and the plugin declares a `test_file`,
    /// the phase tests) into a fresh temp dir. Returns the dir handle (kept alive by the caller).
    fn scaffold(&self, code: &str, tests: Option<&str>) -> Result<tempfile::TempDir> {
        let dir = tempfile::Builder::new()
            .prefix("dxtutor-plugin-")
            .tempdir()
            .context("create plugin work dir")?;
        let root = dir.path();
        let code_body = format!("{}{}", self.plugin.code_prelude, code);
        std::fs::write(root.join(&self.plugin.code_file), code_body)
            .with_context(|| format!("write {}", self.plugin.code_file))?;
        if let (Some(tests), Some(test_file)) = (tests, self.plugin.test_file.as_deref()) {
            let test_body = format!("{}{}", self.plugin.test_prelude, tests);
            std::fs::write(root.join(test_file), test_body)
                .with_context(|| format!("write {test_file}"))?;
        }
        Ok(dir)
    }

    /// Run a shell `script` in `dir`, host or container depending on [`current_engine`].
    fn run_script(&self, dir: &Path, script: &str) -> Result<RunOutput> {
        match current_engine() {
            SandboxEngine::Host => self.run_host(dir, script),
            _ => self.run_container(dir, script),
        }
    }

    /// Host path: `sh -c "<script>"` with a minimal environment, own process group and a wall-clock
    /// timeout — the same cheap hardening the native runners use for toolchain invocations.
    fn run_host(&self, dir: &Path, script: &str) -> Result<RunOutput> {
        use std::process::Command;
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(script).current_dir(dir);
        cmd.env_clear();
        cmd.env("PATH", self.plugin.host_path());
        cmd.env("HOME", dir);
        cmd.env("LANG", "C");
        let timeout = self.plugin.host_timeout();
        let outcome = run_guarded(cmd, dir, "plugin", timeout, None)
            .with_context(|| format!("run plugin `{}` command on host", self.plugin.id))?;
        if outcome.timed_out {
            return Ok(RunOutput {
                ok: false,
                stdout: outcome.stdout,
                stderr: format!("exceeded wall-clock timeout ({}s)", timeout.as_secs()),
            });
        }
        let ok = outcome.status.map(|s| s.success()).unwrap_or(false);
        Ok(RunOutput {
            ok,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
        })
    }

    /// Container path: `sh -c "<script>"` inside the plugin image, mounting `dir` at `/work`, with
    /// the plugin's cache volumes and network setting.
    fn run_container(&self, dir: &Path, script: &str) -> Result<RunOutput> {
        let mut spec = ContainerSpec::new(
            self.plugin.image.clone(),
            dir,
            vec!["sh".into(), "-c".into(), script.into()],
        );
        spec.timeout = self.plugin.container_timeout();
        spec.network = self.plugin.network;
        spec.cache_volumes = self
            .plugin
            .cache_volumes
            .iter()
            .map(|c| (c.name.clone(), c.target.clone()))
            .collect();
        run_in_container(spec)
    }

    /// Run a **complete** program (with its own entry point) and return its output — the drill path,
    /// analogous to [`crate::runner::run_rust_snippet`] / [`crate::go_runner::run_go_program`].
    pub fn run_program(&self, code: &str) -> Result<RunOutput> {
        let dir = self.scaffold(code, None)?;
        let script = expand(&self.plugin.run_cmd, &self.plugin, "");
        self.run_script(dir.path(), &script)
    }
}

impl LanguageRunner for PluginRunner {
    /// Correctness = run `test_cmd` over the student code + phase tests. **Exit 0 ⇒ passed.**
    fn check_correctness(&self, phase: &Phase, student_code: &str) -> Result<crate::Correctness> {
        let dir = self.scaffold(student_code, Some(&phase.tests))?;
        let script = expand(&self.plugin.test_cmd, &self.plugin, &phase.entry);
        let out = self
            .run_script(dir.path(), &script)
            .with_context(|| format!("run plugin `{}` tests", self.plugin.id))?;

        let mut raw = String::new();
        raw.push_str(&out.stdout);
        raw.push_str(&out.stderr);
        let summary = summarize(&raw, out.ok);
        Ok(crate::Correctness {
            passed: out.ok,
            summary,
            raw,
        })
    }

    /// Complexity probing is not provided for declarative plugins (see the module header): we return
    /// no samples rather than fabricate an estimate.
    fn probe_complexity(&self, _phase: &Phase, _student_code: &str) -> Result<Vec<Sample>> {
        Ok(Vec::new())
    }

    /// Diagnostics = run `diag_cmd` over the student code alone and parse `file:line:col: sev: msg`.
    /// No `diag_cmd` ⇒ no diagnostics.
    fn diagnostics(&self, student_code: &str) -> Result<Vec<Diagnostic>> {
        let diag_cmd = match &self.plugin.diag_cmd {
            Some(c) => c,
            None => return Ok(Vec::new()),
        };
        let dir = self.scaffold(student_code, None)?;
        let script = expand(diag_cmd, &self.plugin, "");
        let out = self
            .run_script(dir.path(), &script)
            .with_context(|| format!("run plugin `{}` diagnostics", self.plugin.id))?;
        let mut diags = parse_cc_diagnostics(&out.stderr);
        diags.extend(parse_cc_diagnostics(&out.stdout));
        Ok(diags)
    }
}

// ── Output interpretation ─────────────────────────────────────────────────────────

/// Human-readable summary from the exit result and a light scan for a compile error.
fn summarize(raw: &str, passed: bool) -> String {
    if passed {
        return "testes passaram".to_string();
    }
    if raw.contains("error:") || raw.contains("error[") {
        return "não compilou (erro de compilação)".to_string();
    }
    "testes falharam".to_string()
}

/// Parse `path:line:col: severity: message` lines (the GCC/Clang family's format). Lines without
/// that shape are ignored. `error`/`fatal error` ⇒ [`Severity::Error`]; `warning` ⇒
/// [`Severity::Warning`]; notes are skipped.
fn parse_cc_diagnostics(text: &str) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        // Need at least "f:L:C: sev: msg" → four ':' separators before the message.
        let mut it = line.splitn(5, ':');
        let (_file, l, c, sev, msg) = match (it.next(), it.next(), it.next(), it.next(), it.next())
        {
            (Some(f), Some(l), Some(c), Some(s), Some(m)) if !f.is_empty() => (f, l, c, s, m),
            _ => continue,
        };
        let line_no = match l.trim().parse::<u32>() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let col_no = c.trim().parse::<u32>().unwrap_or(0);
        let severity = match sev.trim() {
            "error" | "fatal error" => Severity::Error,
            "warning" => Severity::Warning,
            _ => continue,
        };
        let message = msg.trim().to_string();
        if message.is_empty() {
            continue;
        }
        out.push(Diagnostic {
            line: line_no,
            col: col_no,
            severity,
            message,
        });
    }
    out
}

// ── Registry ───────────────────────────────────────────────────────────────────────

/// The built-in **C** descriptor, embedded as TOML so the declarative path is exercised even for
/// the shipped plugins. C needs only a host C compiler (`cc`), which virtually every machine has.
const BUILTIN_C_TOML: &str = r##"
id = "c"
aliases = ["clang", "gcc"]
display_name = "C"
monaco_id = "c"
extensions = ["c", "h"]
image = "gcc:13"
host_bin = "cc"
network = false

code_file = "student.c"
test_file = "student_test.c"
test_prelude = "#include \"student.c\"\n"

run_cmd  = "cc -O2 -std=c11 {file} -o prog && ./prog"
test_cmd = "cc -O2 -std=c11 {test_file} -o testbin && ./testbin"
diag_cmd = "cc -std=c11 -fsyntax-only {file}"

timeout_secs = 30
"##;

/// The built-in **Python** descriptor (the official Python course, ADR-0004 Phase 3). Hidden tests
/// are standard-library `unittest` cases — no pytest dependency — run with `python3 -m unittest`,
/// which exits non-zero on any failure or error (and on "no tests ran"). Diagnostics compile the
/// student file and print a `SyntaxError` in the `file:line:col: error: msg` shape the parser reads.
const BUILTIN_PYTHON_TOML: &str = r##"
id = "python"
aliases = ["py", "python3"]
display_name = "Python"
monaco_id = "python"
extensions = ["py"]
image = "python:3.12-alpine"
host_bin = "python3"
network = false

code_file = "student.py"
test_file = "test_student.py"
test_prelude = "import unittest\nfrom student import *\n\n"

run_cmd  = "python3 -B {file}"
test_cmd = "python3 -B -m unittest -q test_student"
diag_cmd = '''python3 -B -c 'import sys
try:
    compile(open("student.py").read(), "student.py", "exec")
except SyntaxError as e:
    print("student.py:%d:%d: error: %s" % (e.lineno or 0, e.offset or 0, e.msg))' '''

timeout_secs = 30
"##;

/// The built-in **C++** descriptor (the official C++ course). There is no test framework to
/// install: the test prelude ships a tiny one. Hidden tests are written as
///
/// ```cpp
/// TEST(adds_small_numbers) { CHECK_EQ(add(2, 3), 5); CHECK(add(-1, 1) == 0); }
/// ```
///
/// Each `TEST` registers itself at static-initialisation time, and the prelude's `main` runs them
/// all (an uncaught exception fails that test), prints a summary and exits non-zero on any failure
/// — or when no test ran. The student file is `#include`d, so challenge code must not define
/// `main`. Links `-pthread` (threads units), and `-lsqlite3` only when the code includes
/// `sqlite3.h` (database units: needs the SQLite development files — on the host, or in a
/// container image that has them; the stock `gcc:13` image does not).
const BUILTIN_CPP_TOML: &str = r##"
id = "cpp"
aliases = ["c++", "cxx"]
display_name = "C++"
monaco_id = "cpp"
extensions = ["cpp", "cc", "cxx", "hpp"]
image = "gcc:13"
host_bin = "g++"
network = false

code_file = "student.cpp"
test_file = "student_test.cpp"
test_prelude = '''
#include "student.cpp"
#include <exception>
#include <iostream>
#include <utility>
#include <vector>
namespace dxt {
inline int failures = 0;
inline const char* current = "";
using TestFn = void (*)();
inline std::vector<std::pair<const char*, TestFn>>& registry() {
    static std::vector<std::pair<const char*, TestFn>> tests;
    return tests;
}
struct Register {
    Register(const char* name, TestFn fn) { registry().emplace_back(name, fn); }
};
}  // namespace dxt
#define TEST(name)                                               \
    static void dxt_test_##name();                               \
    static dxt::Register dxt_register_##name(#name, dxt_test_##name); \
    static void dxt_test_##name()
#define CHECK(cond)                                                                  \
    do {                                                                             \
        if (!(cond)) {                                                               \
            std::cerr << "FAILED " << dxt::current << ": " #cond " (line " << __LINE__ \
                      << ")\n";                                                      \
            ++dxt::failures;                                                         \
        }                                                                            \
    } while (0)
#define CHECK_EQ(a, b)                                                                     \
    do {                                                                                   \
        const auto& dxt_a = (a);                                                           \
        const auto& dxt_b = (b);                                                           \
        if (!(dxt_a == dxt_b)) {                                                           \
            std::cerr << "FAILED " << dxt::current << ": " #a " == " #b " (line " << __LINE__ \
                      << ")\n";                                                            \
            ++dxt::failures;                                                               \
        }                                                                                  \
    } while (0)
int main() {
    for (auto& [name, fn] : dxt::registry()) {
        dxt::current = name;
        try {
            fn();
        } catch (const std::exception& e) {
            std::cerr << "FAILED " << name << ": threw " << e.what() << "\n";
            ++dxt::failures;
        } catch (...) {
            std::cerr << "FAILED " << name << ": threw an exception\n";
            ++dxt::failures;
        }
    }
    std::cout << dxt::registry().size() << " tests, " << dxt::failures << " failures\n";
    return (dxt::failures || dxt::registry().empty()) ? 1 : 0;
}
'''

run_cmd  = "g++ -std=c++20 -O2 -pthread {file} -o prog $(grep -qs sqlite3.h {file} && echo -lsqlite3) && ./prog"
test_cmd = "g++ -std=c++20 -O2 -pthread {test_file} -o testbin $(grep -qs sqlite3.h {file} {test_file} && echo -lsqlite3) && ./testbin"
diag_cmd = "g++ -std=c++20 -fsyntax-only {file}"

timeout_secs = 60
"##;

/// The built-in **TypeScript** descriptor (the official TypeScript course). Runs on Node.js ≥ 22.18
/// with its built-in type stripping (`--experimental-transform-types` also covers `enum` and
/// `namespace`), so grading needs no `tsc`. The student file and the tests are concatenated into
/// one ES module, after a tiny harness: hidden tests are written as
///
/// ```ts
/// dxt.test("adds small numbers", () => { dxt.equal(add(2, 3), 5); dxt.check(add(-1, 1) === 0); });
/// ```
///
/// (`dxt.equal` is a deep equality that understands arrays, objects, `Map` and `Set`; tests may be
/// `async`; `dxt.throws(fn)` expects an exception.) Diagnostics use `tsc` only when it is
/// installed, ignoring the errors that come solely from missing Node type definitions.
const BUILTIN_TS_TOML: &str = r##"
id = "typescript"
aliases = ["ts"]
display_name = "TypeScript"
monaco_id = "typescript"
extensions = ["ts", "mts"]
image = "node:22-alpine"
host_bin = "node"
host_path_hints = ["~/.nvm/versions/node/*/bin", "~/.volta/bin", "~/.local/share/fnm/aliases/default/bin", "/opt/homebrew/bin"]
network = false

code_file = "student.ts"
test_file = "student.test.ts"
test_prelude = '''

// ── dxtutor test harness ───────────────────────────────────────────────────────────────
const dxt = (() => {
  type Fn = () => void | Promise<void>;
  const tests: Array<[string, Fn]> = [];
  let failures = 0;
  let current = "";
  const show = (v: unknown): string => {
    try {
      return JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x)) ?? String(v);
    } catch {
      return String(v);
    }
  };
  const deepEqual = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
      return true;
    }
    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false;
      for (const v of a) if (!b.has(v)) return false;
      return true;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  };
  const fail = (msg: string) => {
    failures++;
    console.error(`FAILED ${current}: ${msg}`);
  };
  setTimeout(async () => {
    for (const [name, fn] of tests) {
      current = name;
      try {
        await fn();
      } catch (e) {
        fail(`threw ${e instanceof Error ? e.message : show(e)}`);
      }
    }
    console.log(`${tests.length} tests, ${failures} failures`);
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode =
      failures || tests.length === 0 ? 1 : 0;
  }, 0);
  return {
    test(name: string, fn: Fn) {
      tests.push([name, fn]);
    },
    check(cond: unknown, msg = "check failed") {
      if (!cond) fail(msg);
    },
    equal(actual: unknown, expected: unknown) {
      if (!deepEqual(actual, expected)) fail(`expected ${show(expected)}, got ${show(actual)}`);
    },
    throws(fn: () => unknown, msg = "expected an exception") {
      try {
        fn();
      } catch {
        return;
      }
      fail(msg);
    },
  };
})();
// ── end of harness ─────────────────────────────────────────────────────────────────────
'''

run_cmd  = "printf '{\"type\":\"module\"}' > package.json && node --experimental-transform-types --no-warnings {file}"
test_cmd = "printf '{\"type\":\"module\"}' > package.json && cat {file} {test_file} > run.ts && node --experimental-transform-types --no-warnings run.ts"
diag_cmd = '''if command -v tsc >/dev/null 2>&1; then tsc --noEmit --pretty false --strict --target es2022 --module nodenext --allowImportingTsExtensions --skipLibCheck {file} | grep -v -e TS2307 -e TS2580 -e TS2591 | sed -E 's/^([^(]+)\(([0-9]+),([0-9]+)\): error (TS[0-9]+): (.*)$/\1:\2:\3: error: \5 (\4)/'; fi'''

timeout_secs = 30
"##;

/// Parse and return the built-in descriptors. Panics only on a programmer error (a malformed
/// embedded TOML), which a unit test guards against.
pub fn builtin_plugins() -> Vec<LanguagePlugin> {
    let mut out = Vec::new();
    for (name, raw) in [
        ("C", BUILTIN_C_TOML),
        ("Python", BUILTIN_PYTHON_TOML),
        ("C++", BUILTIN_CPP_TOML),
        ("TypeScript", BUILTIN_TS_TOML),
    ] {
        match toml::from_str::<LanguagePlugin>(raw) {
            Ok(p) => out.push(p),
            // Never crash the evaluator over a built-in; a test catches this in CI.
            Err(e) => eprintln!("[dxtutor] built-in {name} plugin failed to parse: {e}"),
        }
    }
    out
}

/// Run a **complete** program in any supported language — the drill path. Native runners for Rust
/// and Go (with their extra dependency lines), a registered declarative plugin for everything else
/// (Python, C, user drop-ins), and Rust as the historical fallback.
pub fn run_program(language: &str, code: &str, deps: &[String]) -> Result<RunOutput> {
    match language.trim().to_ascii_lowercase().as_str() {
        "go" | "golang" => crate::go_runner::run_go_program_with_deps(code, deps),
        "rust" | "rs" => crate::runner::run_rust_snippet_with_deps(code, deps),
        other => match find_plugin(other) {
            Some(p) => PluginRunner::new(p).run_program(code),
            None => crate::runner::run_rust_snippet_with_deps(code, deps),
        },
    }
}

/// The user plugin directory: `$XDG_CONFIG_HOME/dxtutor/plugins/` if set, else
/// `~/.config/dxtutor/plugins/`. `None` if neither base is resolvable.
pub fn plugin_dir() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg).join("dxtutor/plugins"));
        }
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config/dxtutor/plugins"))
}

/// Load every `*.toml` descriptor in `dir`. Unreadable or malformed files are skipped with a note
/// on stderr — one bad drop-in never breaks the registry.
pub fn load_plugin_dir(dir: &Path) -> Vec<LanguagePlugin> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out, // absent dir is the normal case
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(text) => match toml::from_str::<LanguagePlugin>(&text) {
                Ok(p) => out.push(p),
                Err(e) => eprintln!("[dxtutor] skipping plugin {}: {e}", path.display()),
            },
            Err(e) => eprintln!("[dxtutor] cannot read plugin {}: {e}", path.display()),
        }
    }
    out
}

/// The full registry: user plugins first (so a drop-in can override a built-in id), then the
/// built-ins. Computed once and cached.
pub fn registry() -> &'static [LanguagePlugin] {
    static REGISTRY: OnceLock<Vec<LanguagePlugin>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut plugins = Vec::new();
        if let Some(dir) = plugin_dir() {
            plugins.extend(load_plugin_dir(&dir));
        }
        plugins.extend(builtin_plugins());
        plugins
    })
}

/// Find a registered plugin matching `language` by id, alias or extension. User plugins win over
/// built-ins (registry order).
pub fn find_plugin(language: &str) -> Option<LanguagePlugin> {
    registry().iter().find(|p| p.matches(language)).cloned()
}

/// All registered languages, for a future frontend picker. Built-ins are flagged via the count of
/// user plugins loaded first.
pub fn available_languages() -> Vec<LanguageInfo> {
    let user_count = plugin_dir().map(|d| load_plugin_dir(&d).len()).unwrap_or(0);
    registry()
        .iter()
        .enumerate()
        .map(|(i, p)| LanguageInfo {
            id: p.id.clone(),
            display_name: p.display_name.clone(),
            monaco_id: p.monaco_id.clone(),
            extensions: p.extensions.clone(),
            builtin: i >= user_count,
        })
        .collect()
}

/// `true` if `bin` resolves on the `PATH` (absolute path tested directly).
fn bin_on_path(bin: &str) -> bool {
    find_on_path(bin).is_some()
}

/// Where `bin` resolves on the caller's `PATH` (or itself, if absolute and present).
fn find_on_path(bin: &str) -> Option<PathBuf> {
    let p = Path::new(bin);
    if p.is_absolute() {
        return p.is_file().then(|| p.to_path_buf());
    }
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(bin))
        .find(|f| f.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_core::{Gabarito, Level};

    /// Build a minimal C phase for the gated proof below.
    fn c_add_phase() -> Phase {
        Phase {
            id: "c-add".into(),
            title: "Soma em C".into(),
            level: Level::Basico,
            language: "c".into(),
            instructions: "Implementa `int add(int a, int b)`.".into(),
            entry: "add".into(),
            starter: "int add(int a, int b) { return 0; }".into(),
            // Correctness test: a C `main` that asserts; non-zero exit on failure.
            tests: "#include <assert.h>\nint main(void){ assert(add(2,3)==5); assert(add(-1,1)==0); return 0; }\n".into(),
            gabarito: Gabarito {
                solution: "int add(int a, int b) { return a + b; }".into(),
                time: "O(1)".into(),
                space: "O(1)".into(),
                justification: "Soma aritmética directa.".into(),
            },
            probe: None,
            hints: Vec::new(),
            dependencies: Vec::new(),
        }
    }

    #[test]
    fn builtin_c_plugin_parses() {
        let plugins = builtin_plugins();
        assert_eq!(
            plugins.len(),
            4,
            "the C, Python, C++ and TypeScript built-ins"
        );
        let c = &plugins[0];
        assert_eq!(c.id, "c");
        assert!(c.matches("C"));
        assert!(c.matches("gcc"));
        assert!(c.matches("h"), "extension should match");
        assert_eq!(c.test_file.as_deref(), Some("student_test.c"));
        assert!(c.run_cmd.contains("{file}"));
    }

    #[test]
    fn builtin_python_plugin_parses() {
        let py = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "python")
            .expect("python");
        assert!(py.matches("py") && py.matches("python3"));
        assert_eq!(py.code_file, "student.py");
        assert!(py.test_prelude.contains("from student import *"));
        assert!(py.diag_cmd.as_deref().unwrap_or("").contains("SyntaxError"));
    }

    /// Real end-to-end on the host's `python3` (skipped where it is missing): the reference solution
    /// passes the hidden unittest cases, a wrong one fails, a program runs, and a syntax error is
    /// reported at its line.
    #[test]
    fn python_plugin_grades_runs_and_diagnoses_on_the_host() {
        let py = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "python")
            .unwrap();
        if !py.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(py);
        let mut phase = c_add_phase();
        phase.language = "python".into();
        phase.entry = "add".into();
        phase.tests = "class T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n".into();
        let ok = runner
            .check_correctness(&phase, "def add(a, b):\n    return a + b\n")
            .unwrap();
        assert!(ok.passed, "{}", ok.raw);
        let bad = runner
            .check_correctness(&phase, "def add(a, b):\n    return a - b\n")
            .unwrap();
        assert!(!bad.passed);
        let starter = runner
            .check_correctness(&phase, "def add(a, b):\n    raise NotImplementedError\n")
            .unwrap();
        assert!(!starter.passed);
        let out = run_program("python", "print('hi', 6 * 7)\n", &[]).unwrap();
        assert!(out.ok && out.stdout.trim() == "hi 42", "{out:?}");
        let d = runner.diagnostics("x = 1\ndef f(:\n    pass\n").unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(2), "{d:?}");
    }

    /// Real end-to-end on the host's `g++` (skipped where it is missing): the mini test harness
    /// passes a correct solution, fails a wrong one, fails a throwing one, fails "no tests", and a
    /// compile error is reported at its line.
    #[test]
    fn cpp_plugin_grades_runs_and_diagnoses_on_the_host() {
        let cpp = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "cpp")
            .unwrap();
        assert!(cpp.matches("c++") && cpp.matches("cpp"));
        if !cpp.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(cpp);
        let mut phase = c_add_phase();
        phase.language = "cpp".into();
        phase.tests = "TEST(adds) { CHECK_EQ(add(2, 3), 5); CHECK(add(-1, 1) == 0); }\n".into();
        let ok = runner
            .check_correctness(&phase, "int add(int a, int b) { return a + b; }\n")
            .unwrap();
        assert!(ok.passed, "{}", ok.raw);
        assert!(ok.raw.contains("1 tests, 0 failures"), "{}", ok.raw);
        let bad = runner
            .check_correctness(&phase, "int add(int a, int b) { return a - b; }\n")
            .unwrap();
        assert!(
            !bad.passed && bad.raw.contains("FAILED adds"),
            "{}",
            bad.raw
        );
        let throws = runner
            .check_correctness(
                &phase,
                "#include <stdexcept>\nint add(int, int) { throw std::logic_error(\"todo\"); }\n",
            )
            .unwrap();
        assert!(
            !throws.passed && throws.raw.contains("threw todo"),
            "{}",
            throws.raw
        );
        phase.tests = String::new();
        let none = runner
            .check_correctness(&phase, "int add(int a, int b) { return a + b; }\n")
            .unwrap();
        assert!(!none.passed, "no tests must not pass");
        let out = run_program(
            "c++",
            "#include <iostream>\nint main() { std::cout << 6 * 7 << \"\\n\"; }\n",
            &[],
        )
        .unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");
        let d = runner.diagnostics("int f() {\n  return x;\n}\n").unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(2), "{d:?}");
    }

    /// Real end-to-end on Node.js (found on the PATH or through the nvm/Volta hints; skipped where
    /// it is missing): async tests, deep equality, `enum`, failure, throw and "no tests".
    #[test]
    fn typescript_plugin_grades_and_runs_on_the_host() {
        let ts = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "typescript")
            .unwrap();
        assert!(ts.matches("ts") && !ts.matches("javascript"));
        if !ts.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(ts);
        let mut phase = c_add_phase();
        phase.language = "typescript".into();
        phase.tests = "dxt.test(\"adds\", async () => {\n  dxt.equal(add(2, 3), 5);\n  dxt.equal(new Map([[\"k\", [1]]]), new Map([[\"k\", [1]]]));\n});\n".into();
        let good = "enum Op { Plus }\nexport function add(a: number, b: number): number {\n  return Op.Plus === 0 ? a + b : 0;\n}\n";
        let ok = runner.check_correctness(&phase, good).unwrap();
        assert!(
            ok.passed && ok.raw.contains("1 tests, 0 failures"),
            "{}",
            ok.raw
        );
        let bad = runner
            .check_correctness(
                &phase,
                "export function add(a: number, b: number): number { return a - b; }\n",
            )
            .unwrap();
        assert!(
            !bad.passed && bad.raw.contains("FAILED adds"),
            "{}",
            bad.raw
        );
        let throws = runner
            .check_correctness(&phase, "export function add(a: number, b: number): number { throw new Error(\"todo\"); }\n")
            .unwrap();
        assert!(
            !throws.passed && throws.raw.contains("threw todo"),
            "{}",
            throws.raw
        );
        phase.tests = String::new();
        assert!(
            !runner.check_correctness(&phase, good).unwrap().passed,
            "no tests must not pass"
        );
        let out = run_program("ts", "const n: number = 6 * 7;\nconsole.log(n);\n", &[]).unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");
    }

    #[test]
    fn expand_hint_picks_the_newest_version() {
        let dir = tempfile::tempdir().unwrap();
        for v in ["v9.1.0", "v10.0.0", "v24.14.1"] {
            std::fs::create_dir_all(dir.path().join(v).join("bin")).unwrap();
        }
        let got = expand_hint(&format!("{}/*/bin", dir.path().display())).unwrap();
        assert!(got.ends_with("v24.14.1/bin"), "{got:?}");
    }

    #[test]
    fn language_supported_knows_native_and_descriptor_languages_only() {
        for l in ["rust", "Go", "javascript", "python", "py", "c"] {
            assert!(crate::language_supported(l), "{l}");
        }
        for l in ["kotlin", "swift", ""] {
            assert!(!crate::language_supported(l), "{l}");
        }
    }

    #[test]
    fn registry_exposes_c() {
        assert!(find_plugin("c").is_some());
        assert!(find_plugin("clang").is_some());
        assert!(
            find_plugin("brainfuck").is_none(),
            "unknown language has no plugin"
        );
        let langs = available_languages();
        assert!(langs.iter().any(|l| l.id == "c" && l.display_name == "C"));
    }

    #[test]
    fn load_plugin_dir_reads_dropins_and_skips_junk() {
        let dir = tempfile::tempdir().expect("tempdir");
        // A valid drop-in descriptor for a new language (Python), minus any Rust.
        std::fs::write(
            dir.path().join("python.toml"),
            "id = \"python\"\n\
             aliases = [\"py\", \"python3\"]\n\
             display_name = \"Python\"\n\
             monaco_id = \"python\"\n\
             extensions = [\"py\"]\n\
             image = \"python:3.12-slim\"\n\
             host_bin = \"python3\"\n\
             code_file = \"student.py\"\n\
             run_cmd = \"python3 {file}\"\n\
             test_cmd = \"python3 {file}\"\n",
        )
        .unwrap();
        // A malformed file (missing required keys) must be skipped, not fatal.
        std::fs::write(dir.path().join("broken.toml"), "id = \"x\"\n").unwrap();
        // A non-TOML file is ignored.
        std::fs::write(dir.path().join("notes.txt"), "ignore me").unwrap();

        let loaded = load_plugin_dir(dir.path());
        assert_eq!(loaded.len(), 1, "only the valid drop-in loads: {loaded:?}");
        let py = &loaded[0];
        assert_eq!(py.id, "python");
        assert!(py.matches("py"), "alias matches");
        assert!(py.matches("python3"));
        assert_eq!(py.code_file, "student.py");
    }

    #[test]
    fn expand_fills_placeholders() {
        let c = &builtin_plugins()[0];
        let s = expand(
            "run {file} test {test_file} entry {entry} dir {dir}",
            c,
            "add",
        );
        assert_eq!(s, "run student.c test student_test.c entry add dir .");
    }

    #[test]
    fn parse_cc_diagnostics_reads_gcc_format() {
        let text = "student.c:3:10: error: 'x' undeclared (first use in this function)\n\
                    student.c:5:2: warning: unused variable 'y' [-Wunused-variable]\n\
                    student.c:5:2: note: each undeclared identifier is reported only once\n";
        let diags = parse_cc_diagnostics(text);
        assert_eq!(diags.len(), 2, "error + warning, note skipped: {diags:?}");
        assert_eq!(diags[0].line, 3);
        assert_eq!(diags[0].col, 10);
        assert_eq!(diags[0].severity, Severity::Error);
        assert!(diags[0].message.contains("undeclared"));
        assert_eq!(diags[1].severity, Severity::Warning);
    }

    /// End-to-end proof that a brand-new language — **C** — works purely through the declarative
    /// plugin, with no Rust runner of its own. **Gate**: Host engine + a host C compiler (`cc`).
    /// Run with:
    ///
    /// ```text
    /// cargo test -p tutor-eval plugin::tests::c_via_plugin_runs_and_tests -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "requires a host C compiler (cc) on PATH"]
    fn c_via_plugin_runs_and_tests() {
        let plugin = find_plugin("c").expect("C plugin is registered");
        if current_engine() != SandboxEngine::Host {
            eprintln!("skip: engine != Host");
            return;
        }
        let runner = PluginRunner::new(plugin.clone());
        if !plugin.host_available() {
            eprintln!("skip: no host C compiler (cc) on PATH");
            return;
        }

        // 1) A complete program runs via run_cmd.
        let out = runner
            .run_program(
                "#include <stdio.h>\nint main(void){ printf(\"ola do C\\n\"); return 0; }\n",
            )
            .expect("running a complete C program should not fail the sandbox");
        assert!(
            out.ok,
            "C program should compile and run; stderr:\n{}",
            out.stderr
        );
        assert!(
            out.stdout.contains("ola do C"),
            "stdout should contain the printed line, got:\n{}",
            out.stdout
        );

        // 2) Correctness (exit 0 == passed) via test_cmd: the right solution passes.
        let phase = c_add_phase();
        let good = runner
            .check_correctness(&phase, "int add(int a, int b) { return a + b; }")
            .expect("correctness run should not fail the sandbox");
        assert!(
            good.passed,
            "correct solution should pass; raw:\n{}",
            good.raw
        );

        // 3) …and a wrong solution fails.
        let bad = runner
            .check_correctness(&phase, "int add(int a, int b) { return a - b; }")
            .expect("correctness run should not fail the sandbox");
        assert!(!bad.passed, "wrong solution must fail");

        // 4) Diagnostics parse a real compile error.
        let diags = runner
            .diagnostics("int add(int a, int b) { return a + ; }")
            .expect("diagnostics run should not fail the sandbox");
        assert!(
            diags.iter().any(|d| d.severity == Severity::Error),
            "a syntax error should yield an error diagnostic, got: {diags:?}"
        );
    }
}
