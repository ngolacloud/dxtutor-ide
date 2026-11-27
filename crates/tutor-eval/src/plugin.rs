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
//! # Optional: PROJECT steps (several files). The learner's whole tree and the hidden test
//! # files are written as they are (no preludes) into the work dir, then this runs.
//! # Extra placeholder: {main} → the project's main file. Without it, project steps in this
//! # language are refused with a clear error.
//! # project_test_cmd = "make test"
//!
//! # Optional: the command that prints the toolchain version, for `dxt plugin test`'s report.
//! # version_cmd = "cc --version"
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
use crate::course_cache::{python_env, PythonEnv};
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
    /// Shell script template to run the hidden tests of a **project** step (several files,
    /// written as they are into the work dir). Exit 0 ⇒ passed. Optional: without it the
    /// language does not grade project steps. Extra placeholder `{main}`.
    #[serde(default)]
    pub project_test_cmd: Option<String>,
    /// Shell command that prints the toolchain version (first line used), for reports such as
    /// `dxt plugin test`. Optional.
    #[serde(default)]
    pub version_cmd: Option<String>,

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
    ///
    /// The hint directories come FIRST: some installers put a *proxy* on the PATH that needs the
    /// real `$HOME` (swiftly's `swift` reads `~/.local/share/swiftly/config.json`), while the
    /// evaluator runs with `HOME` set to the work dir — so the real toolchain dir must win.
    fn host_path(&self) -> String {
        let mut dirs: Vec<PathBuf> = self.hint_dirs();
        if let Some(bin) = &self.host_bin {
            if let Some(found) = find_on_path(bin) {
                if let Some(parent) = found.parent() {
                    dirs.push(parent.to_path_buf());
                }
            }
        }
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
    /// the phase tests) into a fresh temp dir, then the course's read-only `support` files (see
    /// [`write_support`]). Returns the dir handle (kept alive by the caller).
    fn scaffold(
        &self,
        code: &str,
        tests: Option<&str>,
        support: &std::collections::BTreeMap<String, String>,
    ) -> Result<tempfile::TempDir> {
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
        let real = root.canonicalize().context("resolve plugin work dir")?;
        write_support(&real, support)?;
        Ok(dir)
    }

    /// Scaffold a **project** tree (the learner's files plus the hidden `tests`) into a fresh
    /// temp dir, each file at its relative path. Every path must pass
    /// [`tutor_core::safe_project_path`] (no `..`, no root, no `\\`), every file is created new
    /// (`create_new`: a test file can never overwrite a learner file, nor two entries the same
    /// file), and each parent dir is checked to stay inside the work dir. The course's `support`
    /// files come last, under the same rules (so they never replace a project file, nor the
    /// reverse).
    fn scaffold_tree(
        &self,
        tree: &std::collections::BTreeMap<String, String>,
        tests: &std::collections::BTreeMap<String, String>,
        support: &std::collections::BTreeMap<String, String>,
    ) -> Result<tempfile::TempDir> {
        let dir = tempfile::Builder::new()
            .prefix("dxtutor-project-")
            .tempdir()
            .context("create project work dir")?;
        let root = dir
            .path()
            .canonicalize()
            .context("resolve project work dir")?;
        for (rel, content) in tree.iter().chain(tests.iter()) {
            write_new_file(&root, rel, content, "project")?;
        }
        write_support(&root, support)?;
        Ok(dir)
    }

    /// The course environment of a run (`tutor_core::build`): a prepared Python course's venv
    /// and its timeout. A course cache this descriptor cannot use, or one not prepared yet, is
    /// refused before anything runs (`course_cache::NOT_PREPARED`).
    fn course_env(&self, build: &tutor_core::BuildEnv) -> Result<PythonEnv> {
        if let Some(cache) = &build.cache {
            if tutor_core::CacheKind::of(&self.plugin.id) != Some(tutor_core::CacheKind::Pip) {
                anyhow::bail!(
                    "course `{}`: a prepared course cache is not available for courses graded in `{}`",
                    cache.key,
                    self.plugin.id
                );
            }
        }
        python_env(build)
    }

    /// Run a shell `script` in `dir`, host or container depending on [`current_engine`]. A
    /// prepared course always runs on the host: its cache lives there.
    fn run_script(&self, dir: &Path, script: &str, env: &PythonEnv) -> Result<RunOutput> {
        match current_engine() {
            _ if env.cache.is_some() => self.run_host(dir, script, env),
            SandboxEngine::Host => self.run_host(dir, script, env),
            _ => self.run_container(dir, script),
        }
    }

    /// Host path: `sh -c "<script>"` with a minimal environment, own process group and a wall-clock
    /// timeout — the same cheap hardening the native runners use for toolchain invocations. In a
    /// prepared Python course the course venv comes first on the `PATH` (and pip has no index),
    /// with the course's timeout.
    fn run_host(&self, dir: &Path, script: &str, env: &PythonEnv) -> Result<RunOutput> {
        use std::process::Command;
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(script).current_dir(dir);
        cmd.env_clear();
        let path = self.plugin.host_path();
        cmd.env("PATH", &path);
        cmd.env("HOME", dir);
        cmd.env("LANG", "C");
        env.apply(&mut cmd, &path);
        let timeout = env.timeout.unwrap_or_else(|| self.plugin.host_timeout());
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
        self.run_program_with(code, &Default::default())
    }

    /// [`PluginRunner::run_program`] with a course's read-only `support` files next to the code.
    pub fn run_program_with(
        &self,
        code: &str,
        support: &std::collections::BTreeMap<String, String>,
    ) -> Result<RunOutput> {
        self.run_course_program(code, support, &Default::default())
    }

    /// [`PluginRunner::run_program_with`] for a drill of a course with a `[build]`: a prepared
    /// Python course runs in its course venv, with the course's timeout.
    pub fn run_course_program(
        &self,
        code: &str,
        support: &std::collections::BTreeMap<String, String>,
        build: &tutor_core::BuildEnv,
    ) -> Result<RunOutput> {
        let env = self.course_env(build)?;
        let dir = self.scaffold(code, None, support)?;
        let script = expand(&self.plugin.run_cmd, &self.plugin, "");
        self.run_script(dir.path(), &script, &env)
    }
}

impl LanguageRunner for PluginRunner {
    /// Correctness = run `test_cmd` over the student code + phase tests. **Exit 0 ⇒ passed.**
    fn check_correctness(&self, phase: &Phase, student_code: &str) -> Result<crate::Correctness> {
        let env = self.course_env(&phase.build)?;
        let dir = self.scaffold(student_code, Some(&phase.tests), &phase.support)?;
        let script = expand(&self.plugin.test_cmd, &self.plugin, &phase.entry);
        let out = self
            .run_script(dir.path(), &script, &env)
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

    /// Project correctness = write the learner's tree + the hidden test files, run
    /// `project_test_cmd`. **Exit 0 ⇒ passed.** No `project_test_cmd` ⇒ a clear error.
    fn check_project(
        &self,
        phase: &Phase,
        tree: &std::collections::BTreeMap<String, String>,
    ) -> Result<crate::Correctness> {
        let Some(template) = self.plugin.project_test_cmd.as_deref() else {
            anyhow::bail!(
                "project steps are not supported for `{}` yet (its descriptor has no project_test_cmd)",
                self.plugin.id
            );
        };
        let project = phase
            .project
            .as_ref()
            .with_context(|| format!("step `{}` is not a project step", phase.id))?;
        let env = self.course_env(&phase.build)?;
        let dir = self.scaffold_tree(tree, &project.tests, &phase.support)?;
        let script = expand(template, &self.plugin, &phase.entry).replace("{main}", &project.main);
        let out = self
            .run_script(dir.path(), &script, &env)
            .with_context(|| format!("run plugin `{}` project tests", self.plugin.id))?;
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

    /// Descriptors write the course's support files ([`write_support`]).
    fn grades_support_files(&self) -> bool {
        true
    }

    /// Diagnostics = run `diag_cmd` over the student code alone and parse `file:line:col: sev: msg`.
    /// No `diag_cmd` ⇒ no diagnostics.
    fn diagnostics(&self, student_code: &str) -> Result<Vec<Diagnostic>> {
        let diag_cmd = match &self.plugin.diag_cmd {
            Some(c) => c,
            None => return Ok(Vec::new()),
        };
        let dir = self.scaffold(student_code, None, &Default::default())?;
        let script = expand(diag_cmd, &self.plugin, "");
        let out = self
            .run_script(dir.path(), &script, &PythonEnv::default())
            .with_context(|| format!("run plugin `{}` diagnostics", self.plugin.id))?;
        let mut diags = parse_cc_diagnostics(&out.stderr);
        diags.extend(parse_cc_diagnostics(&out.stdout));
        Ok(diags)
    }
}

// ── Writing files into the work dir ───────────────────────────────────────────────

/// Create `rel` (a [`tutor_core::safe_project_path`]) under `root` with `content`: its parent
/// folders are created and checked to stay inside `root` (canonical), and the file must not
/// exist yet (`create_new`), so no entry ever replaces another.
fn write_new_file(root: &Path, rel: &str, content: &str, what: &str) -> Result<()> {
    use std::io::Write;
    if !tutor_core::safe_project_path(rel) {
        anyhow::bail!("unsafe {what} path `{rel}`");
    }
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create folder for {rel}"))?;
        let real = parent
            .canonicalize()
            .with_context(|| format!("resolve folder for {rel}"))?;
        if !real.starts_with(root) {
            anyhow::bail!("{what} path `{rel}` leaves the work dir");
        }
    }
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .with_context(|| format!("write {rel} (already exists or not a file path)"))?;
    f.write_all(content.as_bytes())
        .with_context(|| format!("write {rel}"))
}

/// Write a course's read-only **support** files (`tutor_core::support`) into the work dir
/// `root` (canonical), after the step's own files: the same path rules as a project tree, and a
/// clash with a file already written is an error, never an overwrite.
fn write_support(root: &Path, support: &std::collections::BTreeMap<String, String>) -> Result<()> {
    for (rel, content) in support {
        write_new_file(root, rel, content, "support")
            .with_context(|| format!("course support file `{rel}`"))?;
    }
    Ok(())
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

version_cmd = "cc --version"
timeout_secs = 30
"##;

/// The built-in **Python** descriptor (the official Python course, ADR-0005 Phase 3). Hidden tests
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
# Project steps: every `test*.py` from the work dir down (packages need an `__init__.py`).
# Fails on a failure, an error, or when no test ran — checked here, not left to unittest (only
# Python 3.12+ exits non-zero when nothing ran; older hosts would pass an empty suite).
# A project with a `manage.py` at its root is a Django project: Django's own test runner
# (`manage.py test`, which sets up the test database and discovers the same `test*.py`), with the
# same "no tests ran" check on its `Ran N tests` line.
project_test_cmd = '''python3 -B -c 'import os, re, subprocess, sys, unittest
if os.path.isfile("manage.py"):
    run = subprocess.run([sys.executable, "-B", "manage.py", "test", "--noinput"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    sys.stdout.write(run.stdout)
    ran = re.findall(r"^Ran (\d+) tests? in ", run.stdout, re.M)
    if run.returncode == 0 and (not ran or int(ran[-1]) == 0):
        print("no tests ran", file=sys.stderr)
        sys.exit(1)
    sys.exit(1 if run.returncode else 0)
suite = unittest.defaultTestLoader.discover(".", pattern="test*.py", top_level_dir=".")
result = unittest.TextTestRunner(verbosity=0).run(suite)
if result.testsRun == 0:
    print("no tests ran", file=sys.stderr)
sys.exit(0 if result.wasSuccessful() and result.testsRun > 0 else 1)' '''
diag_cmd = '''python3 -B -c 'import sys
try:
    compile(open("student.py").read(), "student.py", "exec")
except SyntaxError as e:
    print("student.py:%d:%d: error: %s" % (e.lineno or 0, e.offset or 0, e.msg))' '''

version_cmd = "python3 --version"
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

version_cmd = "g++ --version"
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
project_test_cmd = '''[ -f package.json ] || printf '{"type":"module"}' > package.json; set -- $(find . -name node_modules -prune -o -type f -name '*.test.ts' -print | sort); if [ $# -eq 0 ]; then echo 'no hidden *.test.ts files'; exit 1; fi; node --experimental-transform-types --no-warnings --test --test-reporter=spec "$@"'''
version_cmd = "node --version"
diag_cmd = '''if command -v tsc >/dev/null 2>&1; then tsc --noEmit --pretty false --strict --target es2022 --module nodenext --allowImportingTsExtensions --skipLibCheck {file} | grep -v -e TS2307 -e TS2580 -e TS2591 | sed -E 's/^([^(]+)\(([0-9]+),([0-9]+)\): error (TS[0-9]+): (.*)$/\1:\2:\3: error: \5 (\4)/'; fi'''

timeout_secs = 30
"##;

/// The built-in **SQL** descriptor (the official SQL course, SQLite dialect). The engine is the
/// SQLite inside Python's standard library (`sqlite3`), so it needs only `python3`, not the
/// `sqlite3` CLI.
///
/// - **Run** (drills): the `.sql` script runs statement by statement on a fresh in-memory database
///   in autocommit mode (explicit `BEGIN`/`COMMIT` work), printing each result set like the
///   `sqlite3` CLI with headers: `col1|col2`, then one `a|b` line per row, `NULL` for nulls. The
///   first error stops the run with its line number.
/// - **Tests** (challenges): standard-library `unittest`, after a prelude that reads the student's
///   SQL into `STUDENT_SQL` and offers `connect(setup)`, `query(setup)` → `(columns, rows)` for a
///   single statement, and `script(setup)` → the open connection after the whole script ran.
/// - **Diagnostics**: the first SQLite error, at the line of the statement that raised it.
const BUILTIN_SQL_TOML: &str = r##"
id = "sql"
aliases = ["sqlite"]
display_name = "SQL"
monaco_id = "sql"
extensions = ["sql"]
image = "python:3.12-alpine"
host_bin = "python3"
network = false

code_file = "student.sql"
test_file = "test_student.py"
test_prelude = '''
import sqlite3
import unittest

STUDENT_SQL = open("student.sql", encoding="utf-8").read()


def connect(setup=""):
    """A fresh in-memory database (autocommit mode) with the `setup` script already run."""
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.executescript(setup)
    return conn


def query(setup="", sql=None):
    """Run ONE statement (the student's SQL by default) after `setup`.
    Returns (column_names, rows) with rows as tuples."""
    conn = connect(setup)
    cur = conn.execute(STUDENT_SQL if sql is None else sql)
    cols = [d[0] for d in cur.description or []]
    rows = [tuple(r) for r in cur.fetchall()]
    conn.close()
    return cols, rows


def script(setup="", sql=None):
    """Run the whole script (the student's SQL by default) after `setup`; return the open
    connection so the test can inspect the resulting tables."""
    conn = connect(setup)
    conn.executescript(STUDENT_SQL if sql is None else sql)
    return conn


'''

run_cmd = '''python3 -B -c 'import sqlite3, sys
src = open("student.sql", encoding="utf-8").read()
conn = sqlite3.connect(":memory:", isolation_level=None)
buf, start = "", 1
for n, line in enumerate(src.splitlines(True), 1):
    if not buf.strip():
        start = n
    buf += line
    if sqlite3.complete_statement(buf):
        stmt, buf = buf.strip(), ""
        try:
            cur = conn.execute(stmt)
        except sqlite3.Error as e:
            sys.exit("Error on line %d: %s" % (start, e))
        if cur.description:
            print("|".join(d[0] for d in cur.description))
            for row in cur.fetchall():
                print("|".join("NULL" if v is None else str(v) for v in row))
rest = "\n".join(l for l in buf.splitlines() if not l.strip().startswith("--")).strip()
if rest:
    sys.exit("Error: incomplete statement (missing ;?): " + rest[:80])' '''
test_cmd = "python3 -B -m unittest -q test_student"
diag_cmd = '''python3 -B -c 'import sqlite3
src = open("student.sql", encoding="utf-8").read()
conn = sqlite3.connect(":memory:", isolation_level=None)
buf, start = "", 1
for n, line in enumerate(src.splitlines(True), 1):
    if not buf.strip():
        start = n
    buf += line
    if sqlite3.complete_statement(buf):
        stmt, buf = buf.strip(), ""
        try:
            conn.execute(stmt).fetchall()
        except sqlite3.Error as e:
            print("student.sql:%d:1: error: %s" % (start, e))
            break' '''

version_cmd = 'python3 -c "import sqlite3; print(\"SQLite\", sqlite3.sqlite_version)"'
timeout_secs = 30
"##;

/// The built-in **Java** descriptor (the official Java course, Java 21). Uses the single-file
/// *source launcher* (`java File.java` compiles in memory), so no build tool is involved.
///
/// - **Run** (drills): `Main.java` is a complete program; `java Main.java` runs its first class.
/// - **Tests** (challenges): the hidden tests are the body of `define()` in a test class, written
///   with a tiny harness:
///
///   ```java
///   test("adds small numbers", () -> equal(Calc.add(2, 3), 5));
///   test("rejects negatives", () -> assertThrows(IllegalArgumentException.class, () -> Calc.sqrt(-1)));
///   ```
///
///   `test_cmd` assembles one `Run.java`: every `import` line of the tests and of the student file,
///   hoisted and de-duplicated; the harness (whose first class holds `main`, as the launcher
///   requires); the tests; the closing braces; then the student's classes. Student code therefore
///   has no `main`-holding first class requirement and no `package` line. `check`/`equal` record a
///   failure and continue; an exception escaping a test fails it; no tests ⇒ failure.
/// - **Diagnostics**: `javac` on the student file, its `File.java:LINE: error: msg` lines reshaped
///   to the `file:line:col: sev: msg` form the parser reads (column 0 = unknown).
const BUILTIN_JAVA_TOML: &str = r##"
id = "java"
aliases = ["jdk"]
display_name = "Java"
monaco_id = "java"
extensions = ["java"]
image = "eclipse-temurin:21-jdk"
host_bin = "java"
host_path_hints = ["/usr/lib/jvm/*/bin", "~/.sdkman/candidates/java/current/bin", "/opt/homebrew/opt/openjdk/bin"]
network = false

code_file = "Main.java"
test_file = "DxtTests.java"
test_prelude = '''
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public class DxtMain {
    public static void main(String[] args) {
        DxtTests suite = new DxtTests();
        suite.define();
        for (DxtBase.Case c : suite.cases) {
            suite.current = c.name();
            try {
                c.body().run();
            } catch (Throwable e) {
                suite.fail("threw " + e);
            }
        }
        System.out.println(suite.cases.size() + " tests, " + suite.failures + " failures");
        System.exit(suite.failures > 0 || suite.cases.isEmpty() ? 1 : 0);
    }
}

abstract class DxtBase {
    interface Body {
        void run() throws Exception;
    }

    record Case(String name, Body body) {}

    final List<Case> cases = new ArrayList<>();
    String current = "";
    int failures = 0;

    void fail(String msg) {
        failures++;
        System.err.println("FAILED " + current + ": " + msg);
    }

    void test(String name, Body body) {
        cases.add(new Case(name, body));
    }

    void check(boolean cond) {
        check(cond, "check failed");
    }

    void check(boolean cond, String msg) {
        if (!cond) fail(msg);
    }

    void equal(Object actual, Object expected) {
        if (!Objects.deepEquals(actual, expected)) {
            fail("expected " + show(expected) + ", got " + show(actual));
        }
    }

    void near(double actual, double expected, double epsilon) {
        if (Math.abs(actual - expected) > epsilon) fail("expected " + expected + " ± " + epsilon + ", got " + actual);
    }

    void assertThrows(Class<? extends Throwable> type, Body body) {
        try {
            body.run();
        } catch (Throwable e) {
            if (!type.isInstance(e)) fail("expected " + type.getSimpleName() + ", got " + e);
            return;
        }
        fail("expected " + type.getSimpleName() + " to be thrown");
    }

    static String show(Object o) {
        if (o instanceof Object[] a) return java.util.Arrays.deepToString(a);
        if (o instanceof int[] a) return java.util.Arrays.toString(a);
        if (o instanceof long[] a) return java.util.Arrays.toString(a);
        if (o instanceof double[] a) return java.util.Arrays.toString(a);
        if (o instanceof char[] a) return java.util.Arrays.toString(a);
        if (o instanceof boolean[] a) return java.util.Arrays.toString(a);
        if (o instanceof String s) return '"' + s + '"';
        return String.valueOf(o);
    }
}

class DxtTests extends DxtBase {
    void define() {
'''

run_cmd  = "java -Xss16m {file}"
test_cmd = "{ grep -h '^import ' {test_file} {file} | sort -u; grep -v '^import ' {test_file}; printf '\\n    }\\n}\\n\\n'; grep -v '^import ' {file}; } > Run.java && java -Xss16m Run.java"
diag_cmd = "javac -Xlint:none -d .dxt-out {file} 2>&1 | sed -nE 's/^([^:]+[.]java):([0-9]+): (error|warning): (.*)$/\\1:\\2:0: \\3: \\4/p'"

version_cmd = "java -version"
timeout_secs = 60
"##;

/// The built-in **Kotlin** descriptor (the official Kotlin course, Kotlin 2.x on the JVM).
/// `kotlinc … -include-runtime -d x.jar && java -jar x.jar` — no Gradle.
///
/// - **Run** (drills): `Main.kt` is a complete program with `fun main()`.
/// - **Tests** (challenges): written as the body of an extension function on a harness class, so
///   `test("name") { equal(actual, expected) }`, `expect(cond)`, `near(a, b)` and
///   `assertThrows<IllegalArgumentException> { … }` resolve to **members** and can never clash
///   with the student's top-level functions nor shadow the stdlib `check`/`require`. `test_cmd`
///   assembles one `Run.kt`: all `import` lines hoisted and de-duplicated, the student's code, the
///   harness (with its own `main`), the tests, and the closing brace. Student code therefore has
///   no `main` and no `package` line.
/// - **Diagnostics**: `kotlinc` already prints `File.kt:LINE:COL: error: msg`.
///
/// `kotlinc` is found on the PATH, in `/snap/bin` (the snap) or in SDKMAN. A cold compile takes a
/// few seconds (a fresh compiler JVM each time); the C1-only JIT (`-XX:TieredStopAtLevel=1`)
/// roughly halves that for such short-lived JVMs. Hence also the longer timeout.
const BUILTIN_KOTLIN_TOML: &str = r##"
id = "kotlin"
aliases = ["kt"]
display_name = "Kotlin"
monaco_id = "kotlin"
extensions = ["kt", "kts"]
image = "zenika/kotlin:latest"
host_bin = "kotlinc"
host_path_hints = ["/snap/bin", "~/.sdkman/candidates/kotlin/current/bin", "/opt/homebrew/bin", "/usr/lib/jvm/*/bin"]
network = false

code_file = "Main.kt"
test_file = "DxtTests.kt"
test_prelude = '''
import kotlin.system.exitProcess

class DxtSuite {
    private val cases = mutableListOf<Pair<String, () -> Unit>>()
    private var current = ""
    var failures = 0

    fun fail(msg: String) {
        failures++
        System.err.println("FAILED $current: $msg")
    }

    fun test(name: String, body: () -> Unit) {
        cases += name to body
    }

    fun expect(cond: Boolean, msg: String = "expectation failed") {
        if (!cond) fail(msg)
    }

    fun equal(actual: Any?, expected: Any?) {
        if (!deepEq(actual, expected)) fail("expected ${show(expected)}, got ${show(actual)}")
    }

    fun near(actual: Double, expected: Double, epsilon: Double = 1e-9) {
        if (kotlin.math.abs(actual - expected) > epsilon) fail("expected $expected ± $epsilon, got $actual")
    }

    inline fun <reified T : Throwable> assertThrows(body: () -> Unit) {
        try {
            body()
        } catch (e: Throwable) {
            if (e !is T) fail("expected ${T::class.simpleName}, got $e")
            return
        }
        fail("expected ${T::class.simpleName} to be thrown")
    }

    private fun deepEq(a: Any?, b: Any?): Boolean = when {
        a is Array<*> && b is Array<*> -> a.contentDeepEquals(b)
        a is IntArray && b is IntArray -> a.contentEquals(b)
        a is LongArray && b is LongArray -> a.contentEquals(b)
        a is DoubleArray && b is DoubleArray -> a.contentEquals(b)
        a is CharArray && b is CharArray -> a.contentEquals(b)
        a is BooleanArray && b is BooleanArray -> a.contentEquals(b)
        else -> a == b
    }

    private fun show(v: Any?): String = when (v) {
        is Array<*> -> v.contentDeepToString()
        is IntArray -> v.contentToString()
        is LongArray -> v.contentToString()
        is DoubleArray -> v.contentToString()
        is CharArray -> v.contentToString()
        is BooleanArray -> v.contentToString()
        is String -> "\"$v\""
        else -> v.toString()
    }

    fun run(): Int {
        for ((name, body) in cases) {
            current = name
            try {
                body()
            } catch (e: Throwable) {
                fail("threw $e")
            }
        }
        println("${cases.size} tests, $failures failures")
        return if (failures > 0 || cases.isEmpty()) 1 else 0
    }
}

fun main() {
    val suite = DxtSuite()
    suite.dxtDefine()
    exitProcess(suite.run())
}

fun DxtSuite.dxtDefine() {
'''

run_cmd  = '''CO=$(for d in /snap/kotlin/current/lib "$(dirname "$(readlink -f "$(command -v kotlinc)")")/../lib"; do if [ -f "$d/kotlinx-coroutines-core-jvm.jar" ]; then echo "$d/kotlinx-coroutines-core-jvm.jar"; break; fi; done); kotlinc -J-XX:TieredStopAtLevel=1 -J-Xshare:auto -nowarn ${CO:+-cp "$CO"} {file} -include-runtime -d prog.jar 2>&1 && java -Xss16m -cp "prog.jar${CO:+:$CO}" MainKt'''
test_cmd = '''{ grep -h '^import ' {test_file} {file} | sort -u; grep -v '^import ' {file}; grep -v '^import ' {test_file}; printf '\n}\n'; } > Run.kt && CO=$(for d in /snap/kotlin/current/lib "$(dirname "$(readlink -f "$(command -v kotlinc)")")/../lib"; do if [ -f "$d/kotlinx-coroutines-core-jvm.jar" ]; then echo "$d/kotlinx-coroutines-core-jvm.jar"; break; fi; done); kotlinc -J-XX:TieredStopAtLevel=1 -J-Xshare:auto -nowarn ${CO:+-cp "$CO"} Run.kt -include-runtime -d run.jar 2>&1 && java -Xss16m -cp "run.jar${CO:+:$CO}" RunKt'''
diag_cmd = '''CO=$(for d in /snap/kotlin/current/lib "$(dirname "$(readlink -f "$(command -v kotlinc)")")/../lib"; do if [ -f "$d/kotlinx-coroutines-core-jvm.jar" ]; then echo "$d/kotlinx-coroutines-core-jvm.jar"; break; fi; done); kotlinc -J-XX:TieredStopAtLevel=1 -J-Xshare:auto -nowarn ${CO:+-cp "$CO"} {file} -d .dxt-out 2>&1'''

version_cmd = "kotlinc -version"
timeout_secs = 120
"##;

/// The built-in **C#** descriptor (the official C# course, C# 12 on .NET 8). Compiles with the
/// Roslyn compiler that ships inside the SDK (`dotnet <sdk>/Roslyn/bincore/csc.dll`) against the
/// `Microsoft.NETCore.App.Ref` reference assemblies, then runs with `dotnet prog.dll` — no MSBuild,
/// no project, no NuGet, about a second per compile. A generated `GlobalUsings.cs` mirrors the SDK's
/// implicit usings (System, Collections.Generic, IO, Linq, Threading, Threading.Tasks).
///
/// - **Run** (drills): `Program.cs` is a complete program (top-level statements are fine).
/// - **Tests** (challenges): the student's `Program.cs` holds only types (no top-level statements,
///   no `Main`); the hidden tests are the body of `Define()` in a partial harness class compiled as
///   a second file, so `Test("name", () => Equal(actual, expected))`, `Check`, `Near` and
///   `Throws<T>(() => …)` are members and never clash with the student's names. `async` test
///   lambdas bind to a `Func<Task>` overload and are awaited. Any `using` lines the tests start with
///   are hoisted to the top of the test file.
/// - **Diagnostics**: `csc` errors `File.cs(L,C): error CSxxxx: msg`, reshaped to
///   `file:line:col: error: msg (CSxxxx)`; "no entry point" (CS5001) is ignored.
const BUILTIN_CSHARP_TOML: &str = r##"
id = "csharp"
aliases = ["c#", "cs", "dotnet"]
display_name = "C#"
monaco_id = "csharp"
extensions = ["cs"]
image = "mcr.microsoft.com/dotnet/sdk:8.0"
host_bin = "dotnet"
host_path_hints = ["/usr/lib/dotnet", "/usr/share/dotnet", "~/.dotnet", "/usr/local/share/dotnet"]
network = false

code_file = "Program.cs"
test_file = "DxtTests.cs"
test_prelude = '''
public static class DxtProgram
{
    public static int Main()
    {
        var suite = new DxtSuite();
        suite.Define();
        return suite.RunAll();
    }
}

public partial class DxtSuite
{
    private readonly List<(string Name, Func<Task> Body)> _cases = new();
    private string _current = "";
    private int _failures;

    public void Fail(string msg)
    {
        _failures++;
        Console.Error.WriteLine($"FAILED {_current}: {msg}");
    }

    public void Test(string name, Action body) => _cases.Add((name, () => { body(); return Task.CompletedTask; }));
    public void Test(string name, Func<Task> body) => _cases.Add((name, body));

    public void Check(bool cond, string msg = "check failed")
    {
        if (!cond) Fail(msg);
    }

    public void Equal(object? actual, object? expected)
    {
        if (!DeepEqual(actual, expected)) Fail($"expected {Show(expected)}, got {Show(actual)}");
    }

    public void Near(double actual, double expected, double epsilon = 1e-9)
    {
        if (Math.Abs(actual - expected) > epsilon) Fail($"expected {expected} ± {epsilon}, got {actual}");
    }

    public void Throws<T>(Action body) where T : Exception
    {
        try { body(); }
        catch (Exception e)
        {
            if (e is not T) Fail($"expected {typeof(T).Name}, got {e.GetType().Name}: {e.Message}");
            return;
        }
        Fail($"expected {typeof(T).Name} to be thrown");
    }

    private static bool DeepEqual(object? a, object? b)
    {
        if (Equals(a, b)) return true;
        if (a is null || b is null || a is string || b is string) return false;
        if (a is System.Collections.IDictionary da && b is System.Collections.IDictionary db)
        {
            if (da.Count != db.Count) return false;
            foreach (System.Collections.DictionaryEntry e in da)
                if (!db.Contains(e.Key) || !DeepEqual(e.Value, db[e.Key])) return false;
            return true;
        }
        var setEquals = a.GetType().GetMethod("SetEquals");
        if (setEquals is not null && b.GetType().GetMethod("SetEquals") is not null)
            return (bool)setEquals.Invoke(a, new[] { b })!;
        if (a is System.Collections.IEnumerable ea && b is System.Collections.IEnumerable eb)
        {
            var la = ea.Cast<object?>().ToList();
            var lb = eb.Cast<object?>().ToList();
            return la.Count == lb.Count && la.Zip(lb).All(p => DeepEqual(p.First, p.Second));
        }
        return false;
    }

    private static string Show(object? v) => v switch
    {
        null => "null",
        string s => $"\"{s}\"",
        System.Collections.IDictionary d => "{" + string.Join(", ", Entries(d).Select(e => $"{Show(e.Key)}: {Show(e.Value)}")) + "}",
        System.Collections.IEnumerable e => "[" + string.Join(", ", e.Cast<object?>().Select(Show)) + "]",
        _ => v.ToString() ?? "",
    };

    // The non-generic IDictionary enumerator yields DictionaryEntry; Cast<DictionaryEntry>() would
    // use IEnumerable instead, which for Dictionary<K,V> yields KeyValuePair and throws.
    private static IEnumerable<System.Collections.DictionaryEntry> Entries(System.Collections.IDictionary d)
    {
        var it = d.GetEnumerator();
        while (it.MoveNext()) yield return it.Entry;
    }

    public int RunAll()
    {
        foreach (var (name, body) in _cases)
        {
            _current = name;
            try { body().GetAwaiter().GetResult(); }
            catch (Exception e) { Fail($"threw {e.GetType().Name}: {e.Message}"); }
        }
        Console.WriteLine($"{_cases.Count} tests, {_failures} failures");
        return _failures > 0 || _cases.Count == 0 ? 1 : 0;
    }
}

public partial class DxtSuite
{
    public void Define()
    {
'''

run_cmd  = '''ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")"); CSC=$(ls -d "$ROOT"/sdk/*/Roslyn/bincore/csc.dll | sort -V | tail -1); REF=$(ls -d "$ROOT"/packs/Microsoft.NETCore.App.Ref/*/ref/net*/ | sort -V | tail -1); FW=$(ls "$ROOT"/shared/Microsoft.NETCore.App | sort -V | tail -1); printf 'global using System;\nglobal using System.Collections.Generic;\nglobal using System.IO;\nglobal using System.Linq;\nglobal using System.Threading;\nglobal using System.Threading.Tasks;\n' > GlobalUsings.cs; printf '{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"%s"}}}' "$FW" > prog.runtimeconfig.json; dotnet "$CSC" -nologo -langversion:latest -nullable:enable -optimize+ -nowarn:CS8321 -out:prog.dll -target:exe $(for r in "$REF"*.dll; do printf -- '-r:%s ' "$r"; done) GlobalUsings.cs {file} && dotnet prog.dll'''
test_cmd = '''{ grep -h '^using ' {test_file}; grep -v '^using ' {test_file}; printf '\n    }\n}\n'; } > Tests.cs && ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")"); CSC=$(ls -d "$ROOT"/sdk/*/Roslyn/bincore/csc.dll | sort -V | tail -1); REF=$(ls -d "$ROOT"/packs/Microsoft.NETCore.App.Ref/*/ref/net*/ | sort -V | tail -1); FW=$(ls "$ROOT"/shared/Microsoft.NETCore.App | sort -V | tail -1); printf 'global using System;\nglobal using System.Collections.Generic;\nglobal using System.IO;\nglobal using System.Linq;\nglobal using System.Threading;\nglobal using System.Threading.Tasks;\n' > GlobalUsings.cs; printf '{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"%s"}}}' "$FW" > run.runtimeconfig.json; dotnet "$CSC" -nologo -langversion:latest -nullable:enable -optimize+ -nowarn:CS8321 -main:DxtProgram -out:run.dll -target:exe $(for r in "$REF"*.dll; do printf -- '-r:%s ' "$r"; done) GlobalUsings.cs {file} Tests.cs && dotnet run.dll'''
diag_cmd = '''ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")"); CSC=$(ls -d "$ROOT"/sdk/*/Roslyn/bincore/csc.dll | sort -V | tail -1); REF=$(ls -d "$ROOT"/packs/Microsoft.NETCore.App.Ref/*/ref/net*/ | sort -V | tail -1); printf 'global using System;\nglobal using System.Collections.Generic;\nglobal using System.IO;\nglobal using System.Linq;\nglobal using System.Threading;\nglobal using System.Threading.Tasks;\n' > GlobalUsings.cs; dotnet "$CSC" -nologo -langversion:latest -nullable:enable -out:diag.dll -target:exe $(for r in "$REF"*.dll; do printf -- '-r:%s ' "$r"; done) GlobalUsings.cs {file} 2>&1 | grep -v CS5001 | sed -nE 's/^([^(]+)[(]([0-9]+),([0-9]+)[)]: (error|warning) (CS[0-9]+): (.*)$/\1:\2:\3: \4: \6 (\5)/p' '''

version_cmd = "dotnet --version"
timeout_secs = 60
"##;

/// The built-in **Swift** descriptor (the official Swift course, Swift 6 language mode with strict
/// concurrency checking). `swiftc -O -swift-version 6`, no SwiftPM package.
///
/// - **Run** (drills): `main.swift` is a complete program (top-level code).
/// - **Tests** (challenges): the student's code is renamed to `Student.swift`, which in Swift may
///   hold only declarations (no top-level statements); a new `main.swift` holds the harness — a
///   `@MainActor` class whose `test`/`equal`/`expect`/`near`/`assertThrows` are members — the
///   top-level code that runs it (with `await`, so tests may be `async`), and the hidden tests
///   inside `extension DxtSuite { func define() { … } }`. Members win over the student's global
///   functions, so names never clash. A runtime trap (`fatalError`, out-of-bounds, a `!` on nil)
///   ends the process non-zero, which fails the run — the starter uses `fatalError`.
/// - **Diagnostics**: `swiftc -typecheck` already prints `file:line:col: error: msg`.
///
/// `swiftc` is found on the PATH or in swiftly's real toolchain folder: swiftly's own `swift` on
/// the PATH is a proxy that needs the real `$HOME`, which the evaluator replaces.
const BUILTIN_SWIFT_TOML: &str = r##"
id = "swift"
aliases = ["swiftlang"]
display_name = "Swift"
monaco_id = "swift"
extensions = ["swift"]
image = "swift:6.0"
host_bin = "swiftc"
host_path_hints = ["~/.local/share/swiftly/toolchains/*/usr/bin", "/opt/swift/usr/bin", "/usr/share/swift/usr/bin"]
network = false

code_file = "main.swift"
test_file = "DxtTests.swift"
test_prelude = '''
import Foundation

@MainActor
final class DxtSuite {
    private var cases: [(String, @MainActor () async throws -> Void)] = []
    private var current = ""
    var failures = 0

    func fail(_ msg: String) {
        failures += 1
        FileHandle.standardError.write("FAILED \(current): \(msg)\n".data(using: .utf8)!)
    }

    func test(_ name: String, _ body: @escaping @MainActor () async throws -> Void) {
        cases.append((name, body))
    }

    func equal<T: Equatable>(_ actual: T, _ expected: T) {
        if actual != expected { fail("expected \(expected), got \(actual)") }
    }

    func expect(_ cond: Bool, _ msg: String = "expectation failed") {
        if !cond { fail(msg) }
    }

    func near(_ actual: Double, _ expected: Double, _ epsilon: Double = 1e-9) {
        if abs(actual - expected) > epsilon { fail("expected \(expected) ± \(epsilon), got \(actual)") }
    }

    func assertThrows(_ body: () throws -> Void) {
        do { try body() } catch { return }
        fail("expected an error to be thrown")
    }

    func run() async -> Int32 {
        for (name, body) in cases {
            current = name
            do { try await body() } catch { fail("threw \(error)") }
        }
        print("\(cases.count) tests, \(failures) failures")
        return failures > 0 || cases.isEmpty ? 1 : 0
    }
}

let dxtSuite = DxtSuite()
dxtSuite.define()
exit(await dxtSuite.run())

extension DxtSuite {
    func define() {
'''

run_cmd  = "swiftc -O -swift-version 6 {file} -o prog 2>&1 && ./prog"
test_cmd = "mv {file} Student.swift && { cat {test_file}; printf '\\n    }\\n}\\n'; } > main.swift && swiftc -O -swift-version 6 Student.swift main.swift -o testbin 2>&1 && ./testbin"
diag_cmd = "swiftc -swift-version 6 -typecheck {file} 2>&1"

version_cmd = "swiftc --version"
timeout_secs = 120
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
        ("SQL", BUILTIN_SQL_TOML),
        ("Java", BUILTIN_JAVA_TOML),
        ("Kotlin", BUILTIN_KOTLIN_TOML),
        ("C#", BUILTIN_CSHARP_TOML),
        ("Swift", BUILTIN_SWIFT_TOML),
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
    run_course_program(
        language,
        code,
        deps,
        &Default::default(),
        &Default::default(),
    )
}

/// [`run_program`] with a course's read-only `support` files (`tutor_core::support`) written next
/// to the program. Only descriptor-graded languages write them: for the native Rust/Go runners a
/// non-empty `support` is an error, never silently dropped.
pub fn run_program_with_support(
    language: &str,
    code: &str,
    deps: &[String],
    support: &std::collections::BTreeMap<String, String>,
) -> Result<RunOutput> {
    run_course_program(language, code, deps, support, &Default::default())
}

/// The drill path of a course step: [`run_program_with_support`] plus the course's `[build]`
/// (`Step::build`): a Rust drill of a prepared course compiles offline against the course cache,
/// a Python one runs in the course venv, each with the course's timeout (`tutor_core::build`).
pub fn run_course_program(
    language: &str,
    code: &str,
    deps: &[String],
    support: &std::collections::BTreeMap<String, String>,
    build: &tutor_core::BuildEnv,
) -> Result<RunOutput> {
    let lang = language.trim().to_ascii_lowercase();
    // Um drill de um curso de ferramentas é um ficheiro YAML: «corrê-lo» é lê-lo (sem
    // ferramentas, sem rede). Os ficheiros de apoio não entram num drill YAML.
    if tutor_core::toolcheck::containerfile_language(&lang) {
        return Ok(crate::tool_runner::run_containerfile_program(code));
    }
    // Um drill do curso de Odoo (Learn P3c) é Python, XML ou CSV de um módulo: lê-se (sem Odoo).
    if tutor_core::toolcheck::odoo_language(&lang) {
        return Ok(crate::odoo_check::run_odoo_drill(code));
    }
    if tutor_core::toolcheck::graded_by_checks(&lang) {
        return Ok(crate::tool_runner::run_yaml_program(code));
    }
    let plugin = match lang.as_str() {
        "go" | "golang" | "rust" | "rs" => None,
        other => find_plugin(other),
    };
    if plugin.is_none() && !support.is_empty() {
        anyhow::bail!(
            "course support files are not supported for `{language}` (only descriptor-graded languages write them)"
        );
    }
    match (lang.as_str(), plugin) {
        ("go" | "golang", _) => crate::go_runner::run_go_program_with_deps(code, deps),
        (_, Some(p)) => PluginRunner::new(p).run_course_program(code, support, build),
        _ => crate::runner::run_rust_snippet_in(code, deps, build),
    }
}

/// The toolchain version a descriptor-graded language runs with — the first non-empty line its
/// `version_cmd` prints (stdout, else stderr), run on the host like a grading run. `None` without
/// a descriptor, without a `version_cmd`, off the host engine, or when the command fails.
pub fn toolchain_version(language: &str) -> Option<String> {
    let plugin = find_plugin(language)?;
    let cmd = plugin.version_cmd.clone()?;
    if current_engine() != SandboxEngine::Host || !plugin.host_available() {
        return None;
    }
    let dir = tempfile::Builder::new()
        .prefix("dxtutor-version-")
        .tempdir()
        .ok()?;
    let out = PluginRunner::new(plugin)
        .run_host(dir.path(), &cmd, &PythonEnv::default())
        .ok()?;
    if !out.ok {
        return None;
    }
    out.stdout
        .lines()
        .chain(out.stderr.lines())
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
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
pub(crate) fn find_on_path(bin: &str) -> Option<PathBuf> {
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
            project: None,
            support: Default::default(),
            build: Default::default(),
        }
    }

    #[test]
    fn builtin_c_plugin_parses() {
        let plugins = builtin_plugins();
        assert_eq!(
            plugins.len(),
            9,
            "the C, Python, C++, TypeScript, SQL, Java, Kotlin, C# and Swift built-ins"
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

    fn files(pairs: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// A Python project step across two modules of a package plus a read-only config module.
    fn python_project_phase() -> Phase {
        let mut phase = c_add_phase();
        phase.language = "python".into();
        phase.id = "py-project".into();
        phase.project = Some(tutor_core::ProjectFiles {
            main: "shop/cart.py".into(),
            starter: files(&[
                ("shop/__init__.py", ""),
                ("shop/config.py", "VAT = 0.14\n"),
                (
                    "shop/prices.py",
                    "def with_vat(amount):\n    raise NotImplementedError\n",
                ),
                (
                    "shop/cart.py",
                    "from shop.prices import with_vat\n\ndef total(items):\n    raise NotImplementedError\n",
                ),
            ]),
            readonly: vec!["shop/__init__.py".into(), "shop/config.py".into()],
            tests: files(&[(
                "test_shop.py",
                concat!(
                    "import unittest\n",
                    "from shop.cart import total\n",
                    "from shop.prices import with_vat\n",
                    "\n",
                    "class T(unittest.TestCase):\n",
                    "    def test_vat(self):\n",
                    "        self.assertAlmostEqual(with_vat(100), 114.0)\n",
                    "\n",
                    "    def test_total(self):\n",
                    "        self.assertAlmostEqual(total([(2, 50.0), (1, 100.0)]), 228.0)\n",
                ),
            )]),
            solution: files(&[
                (
                    "shop/prices.py",
                    "from shop.config import VAT\n\ndef with_vat(amount):\n    return round(amount * (1 + VAT), 2)\n",
                ),
                (
                    "shop/cart.py",
                    "from shop.prices import with_vat\n\ndef total(items):\n    return with_vat(sum(q * p for q, p in items))\n",
                ),
            ]),
            explanation: "Prices live in one module.".into(),
        });
        phase
    }

    /// Real end-to-end on the host's `python3` (skipped where it is missing): a project step with
    /// two learner modules and a read-only one. The solution files pass, the starter fails, a
    /// half-done tree fails, a single `code` maps to the main file, and a read-only or unknown
    /// file in a submission is refused before anything runs.
    #[test]
    fn python_project_step_grades_the_whole_tree_on_the_host() {
        let py = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "python")
            .unwrap();
        if !py.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let phase = python_project_phase();
        let project = phase.project.clone().unwrap();
        assert!(project.check().is_empty(), "{:?}", project.check());

        let good = crate::assess_project(&phase, &project.solution).unwrap();
        assert!(good.correctness.passed, "{}", good.correctness.raw);
        let starter = crate::assess_project(&phase, &files(&[])).unwrap();
        assert!(!starter.correctness.passed);
        assert!(
            starter.correctness.raw.contains("NotImplementedError"),
            "{}",
            starter.correctness.raw
        );
        // Only one of the two modules done: still fails.
        let half = files(&[(
            "shop/prices.py",
            project.solution["shop/prices.py"].as_str(),
        )]);
        assert!(
            !crate::assess_project(&phase, &half)
                .unwrap()
                .correctness
                .passed
        );
        // The single-`code` form grades the main file over the starter (prices.py still a stub).
        let single = crate::assess(&phase, &project.solution["shop/cart.py"]).unwrap();
        assert!(!single.correctness.passed);
        // A read-only file (where cheating would go) or an unknown one is refused.
        let ro = crate::assess_project(&phase, &files(&[("shop/config.py", "VAT = 1\n")]));
        assert!(ro.unwrap_err().to_string().contains("read-only"));
        let unknown = crate::assess_project(&phase, &files(&[("test_shop.py", "")]));
        assert!(unknown.unwrap_err().to_string().contains("not a file"));
        // Hidden tests that define no test case fail ("no tests ran"), they never pass by default.
        let mut empty = phase.clone();
        empty.project.as_mut().unwrap().tests = files(&[("test_shop.py", "# nothing\n")]);
        let none = crate::assess_project(&empty, &project.solution).unwrap();
        assert!(!none.correctness.passed, "{}", none.correctness.raw);
    }

    /// A Python project with a `manage.py` at its root is graded by Django's runner
    /// (`manage.py test --noinput`): its exit code decides, and a run whose `Ran N tests` line
    /// says 0 (or is missing) fails. A stand-in `manage.py` plays Django here (the real one runs
    /// in the Django course: `dxt plugin test courses/django`).
    #[test]
    fn a_django_project_is_graded_by_manage_py_test() {
        let py = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "python")
            .unwrap();
        if !py.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let manage = |ran: &str, code: i32| {
            format!(
                "import sys\nassert sys.argv[1:] == [\"test\", \"--noinput\"], sys.argv\nfrom app import ok\nprint(\"{ran}\", file=sys.stderr)\nsys.exit({code} if ok() else 1)\n"
            )
        };
        let phase_with = |manage_py: String| {
            let mut phase = c_add_phase();
            phase.language = "python".into();
            phase.id = "dj-project".into();
            phase.project = Some(tutor_core::ProjectFiles {
                main: "app/__init__.py".into(),
                starter: files(&[
                    ("manage.py", manage_py.as_str()),
                    ("app/__init__.py", "def ok():\n    return False\n"),
                ]),
                readonly: vec!["manage.py".into()],
                tests: files(&[("tests/__init__.py", "")]),
                solution: files(&[("app/__init__.py", "def ok():\n    return True\n")]),
                explanation: String::new(),
            });
            phase
        };
        let phase = phase_with(manage("Ran 3 tests in 0.010s", 0));
        let solution = phase.project.as_ref().unwrap().solution.clone();
        let good = crate::assess_project(&phase, &solution).unwrap();
        assert!(good.correctness.passed, "{}", good.correctness.raw);
        assert!(good.correctness.raw.contains("Ran 3 tests"));
        let bad = crate::assess_project(&phase, &files(&[])).unwrap();
        assert!(!bad.correctness.passed);
        // Django's runner exits 0 when it found nothing: that never passes.
        let none = phase_with(manage("Ran 0 tests in 0.000s", 0));
        let r = crate::assess_project(&none, &solution).unwrap();
        assert!(!r.correctness.passed);
        assert!(
            r.correctness.raw.contains("no tests ran"),
            "{}",
            r.correctness.raw
        );
        let silent = phase_with(manage("", 0));
        assert!(
            !crate::assess_project(&silent, &solution)
                .unwrap()
                .correctness
                .passed
        );
        // A failing run fails, whatever it printed.
        let failing = phase_with(manage("Ran 2 tests in 0.001s", 1));
        assert!(
            !crate::assess_project(&failing, &solution)
                .unwrap()
                .correctness
                .passed
        );
    }

    /// A prepared course cache only reaches the descriptor that can use it: a Python course's
    /// venv, never a cargo cache, and never in another descriptor.
    #[test]
    fn a_course_cache_reaches_only_the_python_descriptor() {
        let ts = PluginRunner::new(
            builtin_plugins()
                .into_iter()
                .find(|p| p.id == "typescript")
                .unwrap(),
        );
        let build = tutor_core::BuildEnv {
            cache: Some(tutor_core::CourseCache {
                key: "x".into(),
                language: "python".into(),
                dependencies: vec!["a==1 --hash=sha256:00".into()],
            }),
            timeout_secs: 0,
        };
        let e = ts
            .run_course_program("console.log(1)", &Default::default(), &build)
            .unwrap_err()
            .to_string();
        assert!(
            e.contains("not available for courses graded in `typescript`"),
            "{e}"
        );
    }

    #[test]
    fn project_scaffold_rejects_unsafe_paths_and_collisions() {
        let runner = PluginRunner::new(
            builtin_plugins()
                .into_iter()
                .find(|p| p.id == "python")
                .unwrap(),
        );
        for bad in ["../escape.py", "/abs.py", "a/../../b.py", "a\\b.py"] {
            let err = runner
                .scaffold_tree(&files(&[(bad, "x")]), &files(&[]), &files(&[]))
                .unwrap_err();
            assert!(err.to_string().contains("unsafe"), "{bad}: {err}");
        }
        // A test file can never overwrite a learner file.
        let err = runner
            .scaffold_tree(
                &files(&[("t.py", "learner")]),
                &files(&[("t.py", "test")]),
                &files(&[]),
            )
            .unwrap_err();
        assert!(format!("{err:#}").contains("already exists"), "{err:#}");
        // Nested folders are created inside the work dir.
        let dir = runner
            .scaffold_tree(
                &files(&[("a/b/c.py", "x")]),
                &files(&[("test_a.py", "y")]),
                &files(&[]),
            )
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a/b/c.py")).unwrap(),
            "x"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("test_a.py")).unwrap(),
            "y"
        );
    }

    #[test]
    fn project_steps_need_a_project_test_cmd() {
        let mut phase = python_project_phase();
        phase.language = "c".into();
        let err = crate::assess_project(&phase, &files(&[])).unwrap_err();
        assert!(err.to_string().contains("not supported for `c`"), "{err}");
        // A single-file phase is not a project.
        let err = crate::assess_project(&c_add_phase(), &files(&[])).unwrap_err();
        assert!(err.to_string().contains("not a project step"), "{err}");
        assert!(builtin_plugins()
            .iter()
            .find(|p| p.id == "python")
            .and_then(|p| p.project_test_cmd.as_deref())
            .is_some_and(|c| c.contains("discover")));
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

    fn support(
        pairs: &[(&str, &str)],
    ) -> std::sync::Arc<std::collections::BTreeMap<String, String>> {
        std::sync::Arc::new(files(pairs))
    }

    /// A tiny "library" that only exists as a course support file, under node_modules.
    const LIB: &[(&str, &str)] = &[
        (
            "node_modules/minilib/package.json",
            "{\"name\":\"minilib\",\"type\":\"module\",\"exports\":\"./index.js\"}",
        ),
        (
            "node_modules/minilib/index.js",
            "export const triple = (n) => n * 3;\n",
        ),
    ];

    /// Support files are written next to a single-file challenge, a drill and a project step,
    /// so the learner's code can import a library the registry does not have (real Node;
    /// skipped where it is missing).
    #[test]
    fn typescript_grades_with_course_support_files() {
        let ts = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "typescript")
            .unwrap();
        if !ts.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(ts);
        let mut phase = c_add_phase();
        phase.language = "typescript".into();
        phase.tests = "dxt.test(\"triples\", () => { dxt.equal(times3(2), 6); });\n".into();
        let code = "import { triple } from \"minilib\";\nexport const times3 = (n: number) => triple(n);\n";
        // Without the support files the import fails, so the step cannot pass.
        assert!(!runner.check_correctness(&phase, code).unwrap().passed);
        phase.support = support(LIB);
        let ok = runner.check_correctness(&phase, code).unwrap();
        assert!(ok.passed, "{}", ok.raw);

        let out = run_program_with_support(
            "typescript",
            "import { triple } from \"minilib\";\nconsole.log(triple(14));\n",
            &[],
            &files(LIB),
        )
        .unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");

        // A project step graded with `node --test` over the hidden *.test.ts files.
        phase.project = Some(tutor_core::ProjectFiles {
            main: "src/calc.ts".into(),
            starter: files(&[(
                "src/calc.ts",
                "export function nine(): number {\n  throw new Error(\"todo\");\n}\n",
            )]),
            tests: files(&[(
                "calc.test.ts",
                "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { nine } from \"./src/calc.ts\";\ntest(\"nine\", () => assert.equal(nine(), 9));\n",
            )]),
            solution: files(&[(
                "src/calc.ts",
                "import { triple } from \"minilib\";\nexport function nine(): number {\n  return triple(3);\n}\n",
            )]),
            ..Default::default()
        });
        let project = phase.project.clone().unwrap();
        let good = crate::assess_project(&phase, &project.solution).unwrap();
        assert!(good.correctness.passed, "{}", good.correctness.raw);
        let bad = crate::assess_project(&phase, &files(&[])).unwrap();
        assert!(!bad.correctness.passed, "{}", bad.correctness.raw);
        assert!(
            bad.correctness.raw.contains("todo"),
            "{}",
            bad.correctness.raw
        );

        // A project with no hidden test file fails instead of passing vacuously.
        let mut empty = phase.clone();
        empty.project.as_mut().unwrap().tests = files(&[("notes.txt", "x")]);
        let none = crate::assess_project(&empty, &project.solution).unwrap();
        assert!(!none.correctness.passed && none.correctness.raw.contains("no hidden"));

        assert!(toolchain_version("typescript").is_some_and(|v| v.starts_with('v')));
    }

    /// A support file never replaces a file of the step (nor the reverse), and the native runners
    /// refuse a step with support files instead of grading it without them.
    #[test]
    fn support_files_never_overwrite_and_native_runners_refuse_them() {
        let ts = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "typescript")
            .unwrap();
        let runner = PluginRunner::new(ts.clone());
        let clash = files(&[("student.ts", "// course copy")]);
        let err = runner
            .scaffold("// learner", None, &clash)
            .map(|_| ())
            .unwrap_err();
        assert!(
            format!("{err:#}").contains("course support file `student.ts`"),
            "{err:#}"
        );
        let unsafe_path = files(&[("../escape.js", "x")]);
        assert!(runner.scaffold("", None, &unsafe_path).is_err());
        let tree = files(&[("node_modules/minilib/index.js", "learner")]);
        let err = runner
            .scaffold_tree(&tree, &files(&[]), &files(LIB))
            .map(|_| ())
            .unwrap_err();
        assert!(format!("{err:#}").contains("already exists"), "{err:#}");

        let mut phase = c_add_phase();
        phase.language = "rust".into();
        phase.support = support(LIB);
        let refused = crate::assess(&phase, "pub fn add(a: i32, b: i32) -> i32 { a + b }")
            .map(|_| ())
            .unwrap_err();
        assert!(
            refused
                .to_string()
                .contains("support files are not supported"),
            "{refused}"
        );
        let drill =
            run_program_with_support("go", "package main\nfunc main() {}\n", &[], &files(LIB))
                .map(|_| ())
                .unwrap_err();
        assert!(
            drill
                .to_string()
                .contains("support files are not supported"),
            "{drill}"
        );
    }

    /// Real end-to-end with python3's SQLite (skipped where python3 is missing): a script runs and
    /// prints CLI-style results, a query challenge passes/fails, a script challenge is inspected,
    /// and an error is reported at its statement's line.
    #[test]
    fn sql_plugin_grades_runs_and_diagnoses_on_the_host() {
        let sql = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "sql")
            .unwrap();
        assert!(sql.matches("sqlite") && sql.matches("SQL"));
        if !sql.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let out = run_program(
            "sql",
            "-- a comment\nCREATE TABLE t(x INTEGER, y TEXT);\nINSERT INTO t VALUES (1, 'a'), (2, NULL);\nBEGIN;\nUPDATE t SET x = x * 10;\nCOMMIT;\nSELECT x, y\nFROM t ORDER BY x;\n",
            &[],
        )
        .unwrap();
        assert!(out.ok, "{out:?}");
        assert_eq!(out.stdout, "x|y\n10|a\n20|NULL\n");
        let err = run_program("sql", "SELECT 1;\n\nSELECT * FROM missing;\n", &[]).unwrap();
        assert!(!err.ok && err.stderr.contains("line 3"), "{err:?}");

        let runner = PluginRunner::new(sql);
        let mut phase = c_add_phase();
        phase.language = "sql".into();
        phase.tests = "SETUP = \"CREATE TABLE t(x); INSERT INTO t VALUES (3), (1), (2);\"\n\nclass T(unittest.TestCase):\n    def test_sorted(self):\n        cols, rows = query(SETUP)\n        self.assertEqual(cols, [\"x\"])\n        self.assertEqual(rows, [(1,), (2,), (3,)])\n".into();
        let ok = runner
            .check_correctness(&phase, "SELECT x FROM t ORDER BY x;\n")
            .unwrap();
        assert!(ok.passed, "{}", ok.raw);
        let bad = runner
            .check_correctness(&phase, "SELECT x FROM t;\n")
            .unwrap();
        assert!(!bad.passed);
        let starter = runner
            .check_correctness(&phase, "-- write your query here\n")
            .unwrap();
        assert!(!starter.passed);
        phase.tests = "class T(unittest.TestCase):\n    def test_table(self):\n        conn = script()\n        self.assertEqual(conn.execute(\"SELECT count(*) FROM p\").fetchone()[0], 2)\n".into();
        let ok = runner
            .check_correctness(&phase, "CREATE TABLE p(id INTEGER PRIMARY KEY);\nINSERT INTO p DEFAULT VALUES;\nINSERT INTO p DEFAULT VALUES;\n")
            .unwrap();
        assert!(ok.passed, "{}", ok.raw);
        let d = runner.diagnostics("SELECT 1;\nSELEC 2;\n").unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(2), "{d:?}");
    }

    /// Real end-to-end on the host's JDK (skipped where `java` is missing): imports from both files
    /// are hoisted, a public student class works, failures/throws/"no tests" fail, a program runs,
    /// and a compile error is reported at its line.
    #[test]
    fn java_plugin_grades_runs_and_diagnoses_on_the_host() {
        let java = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "java")
            .unwrap();
        assert!(java.matches("Java") && java.matches("java"));
        if !java.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(java);
        let mut phase = c_add_phase();
        phase.language = "java".into();
        phase.tests = "import java.util.Map;\ntest(\"adds\", () -> equal(Calc.add(2, 3), 5));\ntest(\"lists\", () -> equal(Calc.pair(1), List.of(1, 1)));\ntest(\"map\", () -> equal(Map.of(\"k\", 1).get(\"k\"), 1));\n".into();
        let good = "import java.util.List;\n\npublic class Calc {\n    static int add(int a, int b) { return a + b; }\n    static List<Integer> pair(int x) { return List.of(x, x); }\n}\n";
        let ok = runner.check_correctness(&phase, good).unwrap();
        assert!(
            ok.passed && ok.raw.contains("3 tests, 0 failures"),
            "{}",
            ok.raw
        );
        let bad = runner
            .check_correctness(&phase, &good.replace("a + b", "a - b"))
            .unwrap();
        assert!(
            !bad.passed && bad.raw.contains("FAILED adds"),
            "{}",
            bad.raw
        );
        let throws = runner
            .check_correctness(
                &phase,
                &good.replace(
                    "return a + b;",
                    "throw new UnsupportedOperationException(\"todo\");",
                ),
            )
            .unwrap();
        assert!(
            !throws.passed && throws.raw.contains("todo"),
            "{}",
            throws.raw
        );
        phase.tests = String::new();
        assert!(
            !runner.check_correctness(&phase, good).unwrap().passed,
            "no tests must not pass"
        );
        let out = run_program(
            "java",
            "public class Main {\n    public static void main(String[] args) {\n        System.out.println(6 * 7);\n    }\n}\n",
            &[],
        )
        .unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");
        let d = runner
            .diagnostics("class A {\n    int f() {\n        return x;\n    }\n}\n")
            .unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(3), "{d:?}");
    }

    /// Real end-to-end with `kotlinc` (found on the PATH or in /snap/bin, SDKMAN; skipped where it
    /// is missing): members-based harness, hoisted imports, failure/throw/"no tests", a program
    /// runs, and a compile error is reported at its line.
    #[test]
    fn kotlin_plugin_grades_runs_and_diagnoses_on_the_host() {
        let kt = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "kotlin")
            .unwrap();
        assert!(kt.matches("kt") && kt.matches("Kotlin"));
        if !kt.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(kt);
        let mut phase = c_add_phase();
        phase.language = "kotlin".into();
        // A student top-level `test` function must not clash with the harness's `test`.
        phase.tests = "import kotlin.math.max\ntest(\"adds\") { equal(add(2, 3), 5) }\ntest(\"data\") { equal(listOf(Point(1, 2)), listOf(Point(1, 2))); expect(max(1, 2) == 2) }\ntest(\"throws\") { assertThrows<IllegalArgumentException> { require(false) } }\n".into();
        let good = "import kotlin.math.abs\n\ndata class Point(val x: Int, val y: Int)\n\nfun add(a: Int, b: Int): Int = abs(a) + b\n\nfun test(): String = \"student helper\"\n";
        let ok = runner.check_correctness(&phase, good).unwrap();
        assert!(
            ok.passed && ok.raw.contains("3 tests, 0 failures"),
            "{}",
            ok.raw
        );
        let bad = runner
            .check_correctness(&phase, &good.replace("abs(a) + b", "a - b"))
            .unwrap();
        assert!(
            !bad.passed && bad.raw.contains("FAILED adds"),
            "{}",
            bad.raw
        );
        let throws = runner
            .check_correctness(
                &phase,
                &good.replace("abs(a) + b", "TODO(\"not implemented\")"),
            )
            .unwrap();
        assert!(
            !throws.passed && throws.raw.contains("not implemented"),
            "{}",
            throws.raw
        );
        let out = run_program(
            "kotlin",
            "import kotlinx.coroutines.*\n\nfun main() = runBlocking {\n    val a = async { delay(5); 6 }\n    println(a.await() * 7)\n}\n",
            &[],
        )
        .unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");
        let d = runner
            .diagnostics("fun f(): Int {\n    return 1\n}\nfun g(): Int = missing\n")
            .unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(4), "{d:?}");
    }

    /// Real end-to-end on the host's .NET SDK (skipped where `dotnet` is missing): Roslyn compile,
    /// member-based harness (a student `Test` method must not clash), async tests, deep equality of
    /// lists/dictionaries/sets/records, hoisted `using`, failure/throw/"no tests", a top-level
    /// program runs, and a compile error is reported at its line.
    #[test]
    fn csharp_plugin_grades_runs_and_diagnoses_on_the_host() {
        let cs = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "csharp")
            .unwrap();
        assert!(cs.matches("c#") && cs.matches("cs") && cs.matches("CSharp"));
        if !cs.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(cs);
        let mut phase = c_add_phase();
        phase.language = "csharp".into();
        phase.tests = "using System.Text;\nTest(\"adds\", () => Equal(Calc.Add(2, 3), 5));\nTest(\"collections\", () => {\n    Equal(Calc.Words(\"b a\"), new List<string> { \"a\", \"b\" });\n    Equal(new Dictionary<string, int> { [\"k\"] = 1 }, new Dictionary<string, int> { [\"k\"] = 1 });\n    Equal(new HashSet<int> { 2, 1 }, new HashSet<int> { 1, 2 });\n    Equal(new Point(1, 2), new Point(1, 2));\n    Check(new StringBuilder(\"x\").Length == 1);\n});\nTest(\"async\", async () => Equal(await Calc.LaterAsync(7), 7));\nTest(\"throws\", () => Throws<ArgumentException>(() => Calc.Sqrt(-1)));\n".into();
        let good = "public record Point(int X, int Y);\n\npublic static class Calc\n{\n    public static int Add(int a, int b) => a + b;\n    public static List<string> Words(string s) => s.Split(' ').OrderBy(w => w).ToList();\n    public static async Task<int> LaterAsync(int v) { await Task.Delay(5); return v; }\n    public static double Sqrt(double x) => x < 0 ? throw new ArgumentException(\"negative\") : Math.Sqrt(x);\n    public static string Test() => \"student helper\";\n}\n";
        let ok = runner.check_correctness(&phase, good).unwrap();
        assert!(
            ok.passed && ok.raw.contains("4 tests, 0 failures"),
            "{}",
            ok.raw
        );
        let bad = runner
            .check_correctness(&phase, &good.replace("=> a + b", "=> a - b"))
            .unwrap();
        assert!(
            !bad.passed && bad.raw.contains("FAILED adds"),
            "{}",
            bad.raw
        );
        // A failing dictionary comparison shows both dictionaries, not an InvalidCastException
        // from the message formatter (regression: Cast<DictionaryEntry> on Dictionary<K,V>).
        let mut dict_phase = phase.clone();
        dict_phase.tests = "Test(\"dict\", () => Equal(new Dictionary<string, int> { [\"a\"] = 1 }, new Dictionary<string, int> { [\"a\"] = 2 }));\n".into();
        let dict = runner.check_correctness(&dict_phase, good).unwrap();
        assert!(
            !dict.passed
                && dict.raw.contains("expected {\"a\": 2}, got {\"a\": 1}")
                && !dict.raw.contains("InvalidCastException"),
            "{}",
            dict.raw
        );
        let throws = runner
            .check_correctness(
                &phase,
                &good.replace(
                    "=> a + b;",
                    "=> throw new NotImplementedException(\"todo\");",
                ),
            )
            .unwrap();
        assert!(
            !throws.passed && throws.raw.contains("todo"),
            "{}",
            throws.raw
        );
        phase.tests = String::new();
        assert!(
            !runner.check_correctness(&phase, good).unwrap().passed,
            "no tests must not pass"
        );
        let out = run_program("c#", "var n = 6 * 7;\nConsole.WriteLine(n);\n", &[]).unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");
        let d = runner
            .diagnostics("public static class A\n{\n    public static int F() => missing;\n}\n")
            .unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(3), "{d:?}");
    }

    /// Real end-to-end with swiftc (found on the PATH or in swiftly's toolchain folder; skipped where
    /// it is missing): Swift 6 strict concurrency, member harness (a student global `test()` must
    /// not clash), async tests with an actor, failure, a `fatalError` starter, "no tests", a program
    /// runs, and a compile error is reported at its line.
    #[test]
    fn swift_plugin_grades_runs_and_diagnoses_on_the_host() {
        let sw = builtin_plugins()
            .into_iter()
            .find(|p| p.id == "swift")
            .unwrap();
        assert!(sw.matches("Swift"));
        if !sw.host_available() || current_engine() != SandboxEngine::Host {
            return;
        }
        let runner = PluginRunner::new(sw);
        let mut phase = c_add_phase();
        phase.language = "swift".into();
        phase.tests = "test(\"adds\") { self.equal(add(2, 3), 5) }\ntest(\"async\") {\n    let c = Counter()\n    await withTaskGroup(of: Void.self) { group in\n        for _ in 0..<50 { group.addTask { await c.increment() } }\n    }\n    self.equal(await c.value(), 50)\n}\n".into();
        let good = "func add(_ a: Int, _ b: Int) -> Int { a + b }\n\nactor Counter {\n    private var n = 0\n    func increment() { n += 1 }\n    func value() -> Int { n }\n}\n\nfunc test() -> String { \"student helper\" }\n";
        let ok = runner.check_correctness(&phase, good).unwrap();
        assert!(
            ok.passed && ok.raw.contains("2 tests, 0 failures"),
            "{}",
            ok.raw
        );
        let bad = runner
            .check_correctness(&phase, &good.replace("{ a + b }", "{ a - b }"))
            .unwrap();
        assert!(
            !bad.passed && bad.raw.contains("FAILED adds"),
            "{}",
            bad.raw
        );
        let starter = runner
            .check_correctness(
                &phase,
                &good.replace("{ a + b }", "{ fatalError(\"not implemented\") }"),
            )
            .unwrap();
        assert!(!starter.passed, "{}", starter.raw);
        phase.tests = String::new();
        assert!(
            !runner.check_correctness(&phase, good).unwrap().passed,
            "no tests must not pass"
        );
        let out = run_program("swift", "let n = 6 * 7\nprint(n)\n", &[]).unwrap();
        assert!(out.ok && out.stdout.trim() == "42", "{out:?}");
        let d = runner.diagnostics("let a = 1\nlet b = missing\n").unwrap();
        assert_eq!(d.first().map(|d| d.line), Some(2), "{d:?}");
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
        for l in ["cobol", "fortran", ""] {
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
