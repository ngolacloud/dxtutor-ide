//! `dxt plugin …` — instalar, listar, remover, validar e criar plugins de curso.
//!
//! Usa o mesmo registo que a app desktop (`tutor_plugins::Store`), por isso um plugin
//! instalado aqui aparece no Learning Track da app, e vice-versa.

use std::path::Path;

use anyhow::{anyhow, bail, Result};
use tutor_plugins::{
    scaffold, validate_dir, Source, Store, Taken, OFFICIAL_ORG, OFFICIAL_REPO_PREFIX,
};

const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const HELP: &str = "\
dxt plugin — course plugins

  dxt plugin install <source>     install or update a plugin
  dxt plugin list                 list installed plugins
  dxt plugin remove <id>          uninstall a plugin
  dxt plugin validate [dir] [--strict]
                                  check a plugin folder (--strict: warnings fail too)
  dxt plugin new <id> <Name> <ext> [dir]
                                  create a new course plugin skeleton
  dxt plugin test [dir] [--only <unit-id-prefix>] [--keep-cluster]
                                  run every drill, and grade every challenge with its
                                  reference solution (must pass) and starter (must fail);
                                  live Kubernetes steps run in the course's practice cluster,
                                  which is deleted at the end unless it existed before
  dxt plugin prepare [dir]        download (network) and build once the dependencies of a
                                  course with `[build] prepare = true`, into its course cache;
                                  grading then runs offline against it

Sources:
  python                          official course (github.com/ngolacloud/dxtutor-course-python)
  owner/repo[@ref]                a GitHub repository, optionally at a tag or branch
  https://github.com/owner/repo   same, as a URL
  https://host/plugin.zip         a zip over HTTPS
  ./folder  |  ./plugin.zip       a local folder or zip (for course authors)

Plugins are stored in $DXTUTOR_PLUGINS_DIR or the user data folder; prepared course caches in
$DXTUTOR_COURSE_CACHE or the user data folder (dxtutor/course-cache), shared with the app.";

pub fn run(args: &[String]) -> Result<()> {
    let sub = args.first().map(String::as_str).unwrap_or("help");
    let rest = &args[args.len().min(1)..];
    match sub {
        "install" | "add" => install(rest),
        "list" | "ls" => list(),
        "remove" | "rm" | "uninstall" => remove(rest),
        "validate" | "check" => validate(rest),
        "new" | "init" => new(rest),
        "test" => test(rest),
        "prepare" => prepare(rest),
        "-h" | "--help" | "help" => {
            println!("{HELP}");
            Ok(())
        }
        other => bail!("unknown plugin command: {other}\n\n{HELP}"),
    }
}

fn store() -> Result<Store> {
    Store::open_default().map_err(|e| anyhow!(e))
}

fn install(args: &[String]) -> Result<()> {
    let spec = args
        .first()
        .ok_or_else(|| anyhow!("usage: dxt plugin install <source>"))?;
    let source = Source::parse(spec).map_err(|e| anyhow!(e))?;
    if let Some(url) = source.download_url() {
        println!("Downloading {url}");
    }
    let store = store()?;
    let out = store
        .install(&source, HOST_VERSION, &tutor_core::builtin_courses())
        .map_err(|e| anyhow!(e))?;
    for n in &out.notes {
        println!("  note: {n}");
    }
    for w in &out.warnings {
        println!("  warning: {w}");
    }
    match &out.replaced {
        Some(old) => println!("Updated {} {} → {}", out.entry.id, old, out.entry.version),
        None => println!("Installed {} {}", out.entry.id, out.entry.version),
    }
    println!(
        "  {} {} · courses: {}",
        out.language.icon,
        out.language.name,
        out.course_ids.join(", ")
    );
    println!("  in {}", store.root().join(&out.entry.id).display());
    Ok(())
}

fn list() -> Result<()> {
    let store = store()?;
    let items = store.list();
    if items.is_empty() {
        println!("No plugins installed. Try: dxt plugin install <language>  (from github.com/{OFFICIAL_ORG}/{OFFICIAL_REPO_PREFIX}<language>)");
        return Ok(());
    }
    for it in items {
        match (&it.manifest, &it.error) {
            (Some(m), _) => println!(
                "{:<14} {:<9} {} {:<12} {}",
                it.entry.id, it.entry.version, m.language.icon, m.language.name, it.entry.source
            ),
            (None, Some(e)) => println!("{:<14} {:<9} BROKEN: {e}", it.entry.id, it.entry.version),
            (None, None) => {}
        }
    }
    println!("\n{}", store.root().display());
    Ok(())
}

fn remove(args: &[String]) -> Result<()> {
    let id = args
        .first()
        .ok_or_else(|| anyhow!("usage: dxt plugin remove <id>"))?;
    let e = store()?.remove(id).map_err(|e| anyhow!(e))?;
    println!("Removed {} {}", e.id, e.version);
    Ok(())
}

fn validate(args: &[String]) -> Result<()> {
    let strict = args.iter().any(|a| a == "--strict");
    let dir = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .map(String::as_str)
        .unwrap_or(".");
    // Só os cursos embutidos ocupam ids aqui: o registo local de quem valida não interessa
    // ao CI de um repositório de cursos.
    let builtin = tutor_core::builtin_courses();
    let report = validate_dir(Path::new(dir), HOST_VERSION, &Taken::builtin(&builtin));
    for n in &report.notes {
        println!("note:    {n}");
    }
    for w in &report.warnings {
        println!("warning: {w}");
    }
    for e in &report.errors {
        println!("error:   {e}");
    }
    let steps: usize = report
        .courses
        .iter()
        .flat_map(|c| &c.units)
        .map(|u| u.steps.len())
        .sum();
    let units: usize = report.courses.iter().map(|c| c.units.len()).sum();
    if !report.ok() || (strict && !report.warnings.is_empty()) {
        bail!(
            "{} error(s), {} warning(s){}",
            report.errors.len(),
            report.warnings.len(),
            if strict { " (strict)" } else { "" }
        );
    }
    let m = report.manifest.expect("valid report has a manifest");
    println!(
        "OK  {} {} — {} course(s), {units} units, {steps} steps, {} warning(s)",
        m.id,
        m.version,
        report.courses.len(),
        report.warnings.len()
    );
    Ok(())
}

fn new(args: &[String]) -> Result<()> {
    let [id, name, ext, ..] = args else {
        bail!(
            "usage: dxt plugin new <id> <Name> <ext> [dir]   e.g. dxt plugin new kotlin Kotlin kt"
        );
    };
    let dir = args.get(3).cloned().unwrap_or_else(|| id.clone());
    let p = scaffold::NewPlugin {
        id,
        name,
        extension: ext,
        engine: HOST_VERSION,
    };
    let files = scaffold::create(Path::new(&dir), &p).map_err(|e| anyhow!(e))?;
    for f in &files {
        println!("  created {}", f.display());
    }
    println!("\nNext: edit courses/{id}.toml, then `dxt plugin validate {dir}`.");
    Ok(())
}

/// `dxt plugin test`: prova o conteúdo com o avaliador REAL (o mesmo do `submit_step`).
/// Cada drill tem de correr (saída 0); cada desafio tem de passar com o gabarito e falhar com
/// o starter (senão os testes ocultos não provam nada). Num passo de PROJECTO, o mesmo com
/// conjuntos de ficheiros: os da solução passam, os iniciais falham. É o que o CI de um curso deve correr.
fn test(args: &[String]) -> Result<()> {
    let mut dir = ".";
    let mut only: Option<&str> = None;
    let mut keep_cluster = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--only" => only = it.next().map(String::as_str),
            "--verbose" => VERBOSE.store(true, std::sync::atomic::Ordering::Relaxed),
            "--keep-cluster" => keep_cluster = true,
            s if !s.starts_with("--") => dir = s,
            _ => {}
        }
    }
    let builtin = tutor_core::builtin_courses();
    let report = validate_dir(Path::new(dir), HOST_VERSION, &Taken::builtin(&builtin));
    if !report.ok() {
        for e in &report.errors {
            println!("error:   {e}");
        }
        bail!("the plugin is not valid; fix it first (dxt plugin validate)");
    }
    // A course graded offline against a prepared cache: say so once, before any step fails. A
    // cluster course whose cache is not ready (or whose machine cannot run the practice cluster)
    // still tests its offline steps; its live steps are skipped with the reason.
    let mut live_skip: std::collections::BTreeMap<String, String> = Default::default();
    let mut live_clusters: Vec<(String, tutor_eval::kindbox::Sandbox, bool)> = Vec::new();
    for course in &report.courses {
        let Some(cache) = course
            .units
            .iter()
            .flat_map(|u| &u.steps)
            .find_map(|s| s.build.cache.as_ref())
        else {
            continue;
        };
        let root = tutor_eval::course_cache::root()
            .ok_or_else(|| anyhow!("cannot find the user data folder; set DXTUTOR_COURSE_CACHE"))?;
        match tutor_eval::course_cache::status(&root, cache)? {
            tutor_eval::course_cache::Status::Ready(m) => {
                println!(
                    "{} — graded offline against its prepared cache ({}, prepared with {})",
                    course.id,
                    root.join(&cache.key).display(),
                    m.tool
                );
                if let Some(kind) = cache.kind() {
                    let pkgs = tutor_eval::course_cache::cache_packages(kind, &cache.dependencies)?;
                    println!("  dependencies: {}", package_list(&pkgs));
                }
                if cache.kind() == Some(tutor_core::CacheKind::Cluster) {
                    let sb = tutor_eval::course_cache::layout(&root, &cache.key)?.sandbox();
                    let support = tutor_eval::kindbox::probe();
                    if support.ok {
                        let existed = tutor_eval::kindbox::status(&sb)
                            .map(|s| s.exists)
                            .unwrap_or(false);
                        live_clusters.push((course.id.clone(), sb, existed));
                    } else {
                        live_skip.insert(
                            course.id.clone(),
                            format!(
                                "{} {}",
                                support.reason.unwrap_or_default(),
                                support.fix.unwrap_or_default()
                            ),
                        );
                    }
                }
            }
            other if cache.kind() == Some(tutor_core::CacheKind::Cluster) => {
                live_skip.insert(
                    course.id.clone(),
                    format!(
                        "the practice cluster {} — run `dxt plugin prepare {dir}` to test the live steps",
                        if matches!(other, tutor_eval::course_cache::Status::Stale(_)) {
                            "changed since it was prepared"
                        } else {
                            "is not prepared"
                        }
                    ),
                );
            }
            other => bail!(
                "course `{}` {}: run `dxt plugin prepare {dir}` first (it downloads its dependencies once)",
                course.id,
                if matches!(other, tutor_eval::course_cache::Status::Stale(_)) {
                    "changed its dependencies since it was prepared"
                } else {
                    "has not been prepared"
                }
            ),
        }
    }
    // The practice clusters, created (or reused) once before the live steps, with the times.
    for (id, sb, existed) in &live_clusters {
        let v = tutor_eval::kindbox::versions(sb);
        println!(
            "{id} — live steps in the practice cluster {} ({} · node {} · {})",
            sb.name,
            v.get("kind").cloned().unwrap_or_default(),
            v.get("node").cloned().unwrap_or_default(),
            v.get("podman").cloned().unwrap_or_default()
        );
        let kubectl = tutor_eval::tool_runner::find_tool(tutor_core::toolcheck::Tool::Kubectl)
            .ok_or_else(|| anyhow!("kubectl is not installed"))?;
        let _lock = tutor_eval::kindbox::lock(sb)?;
        match tutor_eval::kindbox::ensure(sb, &kubectl) {
            Ok(e) if e.created => println!(
                "  cluster created in {:.1} s, step images loaded in {:.1} s{}",
                e.create_secs,
                e.load_secs,
                memory_note(sb)
            ),
            Ok(_) => println!(
                "  cluster reused (it existed before this run{}): it is kept",
                memory_note(sb)
            ),
            Err(err) => {
                live_skip.insert(
                    id.clone(),
                    format!("the practice cluster did not start: {err}"),
                );
            }
        }
        let _ = existed;
    }
    let mut skipped = Vec::<String>::new();
    let (mut passed, mut failed) = (0usize, Vec::<String>::new());
    for course in &report.courses {
        // O que avalia o curso, para o relatório dizer com que versão da ferramenta passou.
        let mut toolchain = tutor_eval::toolchain_version(&course.language)
            .map(|v| format!(" with {v}"))
            .unwrap_or_default();
        // Um curso de ferramentas (avaliado por verificações): a versão de cada ferramenta que os
        // seus comandos correm, ou o que instalar.
        let mut missing_tools = Vec::new();
        if tutor_core::toolcheck::graded_by_checks(&course.language) {
            let tools = tutor_core::toolcheck::course_tools(course);
            let mut found = Vec::new();
            for (tool, v) in tutor_eval::tool_runner::tool_versions(&tools) {
                match v {
                    Ok(v) => found.push(format!("{} ({v})", tool.binary())),
                    Err(why) => missing_tools.push(why),
                }
            }
            toolchain = if found.is_empty() {
                " by checks (structural only)".to_string()
            } else {
                format!(" by checks with {}", found.join(" and "))
            };
        }
        let support = match course.support_files.len() {
            0 => String::new(),
            n => format!(", {n} support files"),
        };
        if course.category.has_subject() {
            println!(
                "{} — {} `{}`, graded as {}{toolchain}{support}",
                course.id,
                course.category.as_str(),
                course.subject,
                course.language
            );
        } else {
            println!(
                "{} — graded as {}{toolchain}{support}",
                course.id, course.language
            );
        }
        for why in &missing_tools {
            println!("  ! {why}");
        }
        for unit in &course.units {
            if only.is_some_and(|p| !unit.id.starts_with(p)) {
                continue;
            }
            println!("{}", unit.id);
            for step in &unit.steps {
                let live = step
                    .project
                    .as_ref()
                    .is_some_and(tutor_core::livecheck::step_is_live);
                if live {
                    if let Some(why) = live_skip.get(&course.id) {
                        println!(
                            "  - {:<9} {} skipped (live): {why}",
                            kind_name(step.kind),
                            step.id
                        );
                        skipped.push(step.id.clone());
                        continue;
                    }
                }
                let t0 = std::time::Instant::now();
                let verdict = check_step(course, step);
                let took = if live {
                    format!(" [{:.0} s]", t0.elapsed().as_secs_f64())
                } else {
                    String::new()
                };
                match &verdict {
                    Ok(what) => {
                        passed += 1;
                        println!("  ✓ {:<9} {} {what}{took}", kind_name(step.kind), step.id);
                    }
                    Err(why) => {
                        println!("  ✗ {:<9} {} — {why}", kind_name(step.kind), step.id);
                        failed.push(format!("{}: {why}", step.id));
                    }
                }
            }
        }
    }
    // The clusters this run created are deleted (a cluster that existed before is the app's).
    for (id, sb, existed) in &live_clusters {
        if *existed || keep_cluster {
            continue;
        }
        let mem = memory_note(sb);
        let _lock = tutor_eval::kindbox::lock(sb)?;
        match tutor_eval::kindbox::delete_cluster(sb) {
            Ok(d) => println!(
                "{id} — practice cluster {} deleted in {:.1} s{mem}",
                sb.name, d.secs
            ),
            Err(e) => println!(
                "{id} — could not delete the practice cluster {}: {e}",
                sb.name
            ),
        }
    }
    if skipped.is_empty() {
        println!("\n{passed} ok, {} failed", failed.len());
    } else {
        println!(
            "\n{passed} ok, {} failed, {} skipped (live steps that could not run here)",
            failed.len(),
            skipped.len()
        );
    }
    if !failed.is_empty() {
        bail!("{} step(s) failed", failed.len());
    }
    Ok(())
}

/// `dxt plugin prepare`: the explicit, one-time network step of a course with `[build] prepare =
/// true` — the same commands the app shows in its approval dialog (`course_cache::plan`), run
/// into the shared course cache. Grading never touches the network.
fn prepare(args: &[String]) -> Result<()> {
    let dir = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .map(String::as_str)
        .unwrap_or(".");
    let builtin = tutor_core::builtin_courses();
    let report = validate_dir(Path::new(dir), HOST_VERSION, &Taken::builtin(&builtin));
    if !report.ok() {
        for e in &report.errors {
            println!("error:   {e}");
        }
        bail!("the plugin is not valid; fix it first (dxt plugin validate)");
    }
    let root = tutor_eval::course_cache::root()
        .ok_or_else(|| anyhow!("cannot find the user data folder; set DXTUTOR_COURSE_CACHE"))?;
    let mut any = false;
    for course in &report.courses {
        let Some(cache) = course
            .units
            .iter()
            .flat_map(|u| &u.steps)
            .find_map(|s| s.build.cache.as_ref())
        else {
            continue;
        };
        any = true;
        let plan = tutor_eval::course_cache::plan(&root, cache)?;
        let network = match plan.kind {
            tutor_core::CacheKind::Cargo => "cargo fetch",
            tutor_core::CacheKind::Pip => "pip install",
            tutor_core::CacheKind::Images => "podman pull, into the private sandbox",
            tutor_core::CacheKind::Cluster => "the kind download and podman pull",
        };
        println!(
            "{} — preparing (network: {network} only)\ndownloads: {}\n{}\n",
            course.id,
            package_list(&plan.packages),
            plan.command
        );
        let done = tutor_eval::course_cache::prepare(&plan)?;
        if !done.ok {
            println!("{}", done.output);
            bail!("preparing `{}` failed", course.id);
        }
        let m = done
            .marker
            .expect("a successful preparation writes its marker");
        println!(
            "OK  {} prepared in {} — download {:.1} s, offline steps {:.1} s ({})",
            course.id,
            plan.layout.dir.display(),
            m.fetch_secs,
            m.warm_secs,
            m.tool
        );
    }
    if !any {
        println!("Nothing to prepare: no course in {dir} has `[build] prepare = true`.");
    }
    Ok(())
}

/// ` · node memory 612 MiB` (what the practice cluster's node uses now), or nothing.
fn memory_note(sb: &tutor_eval::kindbox::Sandbox) -> String {
    tutor_eval::kindbox::memory_bytes(sb)
        .map(|b| format!(" · node memory {} MiB", b / (1024 * 1024)))
        .unwrap_or_default()
}

/// `Django 5.2.19 (PyPI), asgiref 3.12.1 (PyPI)` — the packages a preparation downloads.
fn package_list(pkgs: &[tutor_eval::course_cache::Package]) -> String {
    pkgs.iter()
        .map(|p| {
            let version = if p.version.is_empty() {
                String::new()
            } else {
                format!(" {}", p.version)
            };
            let source = if p.source.is_empty() {
                String::new()
            } else {
                format!(" ({})", p.source)
            };
            format!("{}{version}{source}", p.name)
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// `dxt plugin test --verbose`: print the grader's report of each project step's solution and
/// starter (for course authors).
static VERBOSE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn indent_report(s: &str) -> String {
    s.lines()
        .map(|l| format!("      {l}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn kind_name(k: tutor_core::StepKind) -> &'static str {
    match k {
        tutor_core::StepKind::Concept => "concept",
        tutor_core::StepKind::Drill => "drill",
        tutor_core::StepKind::Challenge => "challenge",
    }
}

/// Primeiras linhas de uma saída, para o relatório não afogar o terminal.
fn head(s: &str) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).take(6).collect();
    lines.join(" | ")
}

/// Prova um passo com o avaliador real, com os ficheiros de apoio do curso (`[support]`).
fn check_step(
    course: &tutor_core::Course,
    step: &tutor_core::Step,
) -> std::result::Result<String, String> {
    use tutor_core::StepKind;
    let language = course.language.as_str();
    if step.kind != StepKind::Concept && !tutor_eval::language_supported(language) {
        return Err(format!(
            "no evaluator for `{language}` (add a descriptor, see docs/plugins/README.md)"
        ));
    }
    match step.kind {
        StepKind::Concept => Ok(String::new()),
        StepKind::Drill => {
            let out = tutor_eval::run_course_program(
                language,
                &step.target,
                &step.dependencies,
                &course.support_files,
                &step.build,
            )
            .map_err(|e| format!("could not run: {e}"))?;
            if out.ok {
                Ok(String::new())
            } else {
                Err(format!(
                    "target program failed: {}",
                    head(&format!("{}{}", out.stdout, out.stderr))
                ))
            }
        }
        StepKind::Challenge if step.project.is_some() => {
            // Passo de projecto: a árvore da solução (gabarito por cima do starter) tem de
            // passar e a árvore inicial tem de falhar, com o mesmo avaliador do `submit_step`.
            let phase = course
                .phase(step, tutor_core::Level::Basico)
                .ok_or("project step did not build a phase")?;
            let project = step.project.as_ref().expect("guarded");
            let t0 = std::time::Instant::now();
            let good = tutor_eval::assess_project(&phase, &project.solution)
                .map_err(|e| format!("evaluator error: {e}"))?;
            if !good.correctness.passed {
                if VERBOSE.load(std::sync::atomic::Ordering::Relaxed) {
                    println!(
                        "    ── solution ──\n{}",
                        indent_report(&good.correctness.raw)
                    );
                }
                return Err(format!(
                    "reference solution files fail the tests: {}",
                    head(&good.correctness.raw)
                ));
            }
            let starter = tutor_eval::assess_project(&phase, &Default::default())
                .map_err(|e| format!("evaluator error: {e}"))?;
            if VERBOSE.load(std::sync::atomic::Ordering::Relaxed) {
                println!(
                    "    ── solution ──\n{}\n    ── starter ──\n{}",
                    indent_report(&good.correctness.raw),
                    indent_report(&starter.correctness.raw)
                );
            }
            if starter.correctness.passed {
                return Err("the starter files already pass the tests (they prove nothing)".into());
            }
            Ok(format!(
                "({} files, {:.1} s)",
                project.starter.len(),
                t0.elapsed().as_secs_f64()
            ))
        }
        StepKind::Challenge => {
            let phase = course
                .phase(step, tutor_core::Level::Basico)
                .ok_or("challenge without gabarito")?;
            let good = tutor_eval::assess(&phase, &phase.gabarito.solution)
                .map_err(|e| format!("evaluator error: {e}"))?;
            if !good.correctness.passed {
                return Err(format!(
                    "reference solution fails the tests: {}",
                    head(&good.correctness.raw)
                ));
            }
            let starter = tutor_eval::assess(&phase, &phase.starter)
                .map_err(|e| format!("evaluator error: {e}"))?;
            if starter.correctness.passed {
                return Err("the starter already passes the tests (they prove nothing)".into());
            }
            Ok(String::new())
        }
    }
}
