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
  dxt plugin test [dir] [--only <unit-id-prefix>]
                                  run every drill, and grade every challenge with its
                                  reference solution (must pass) and starter (must fail)

Sources:
  python                          official course (github.com/ngolacloud/dxtutor-course-python)
  owner/repo[@ref]                a GitHub repository, optionally at a tag or branch
  https://github.com/owner/repo   same, as a URL
  https://host/plugin.zip         a zip over HTTPS
  ./folder  |  ./plugin.zip       a local folder or zip (for course authors)

Plugins are stored in $DXTUTOR_PLUGINS_DIR or the user data folder.";

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
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--only" => only = it.next().map(String::as_str),
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
    let (mut passed, mut failed) = (0usize, Vec::<String>::new());
    for course in &report.courses {
        // O que avalia o curso, para o relatório dizer com que versão da ferramenta passou.
        let toolchain = tutor_eval::toolchain_version(&course.language)
            .map(|v| format!(" with {v}"))
            .unwrap_or_default();
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
        for unit in &course.units {
            if only.is_some_and(|p| !unit.id.starts_with(p)) {
                continue;
            }
            println!("{}", unit.id);
            for step in &unit.steps {
                let verdict = check_step(course, step);
                match &verdict {
                    Ok(what) => {
                        passed += 1;
                        println!("  ✓ {:<9} {} {what}", kind_name(step.kind), step.id);
                    }
                    Err(why) => {
                        println!("  ✗ {:<9} {} — {why}", kind_name(step.kind), step.id);
                        failed.push(format!("{}: {why}", step.id));
                    }
                }
            }
        }
    }
    println!("\n{passed} ok, {} failed", failed.len());
    if !failed.is_empty() {
        bail!("{} step(s) failed", failed.len());
    }
    Ok(())
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
            let out = tutor_eval::run_program_with_support(
                language,
                &step.target,
                &step.dependencies,
                &course.support_files,
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
            let good = tutor_eval::assess_project(&phase, &project.solution)
                .map_err(|e| format!("evaluator error: {e}"))?;
            if !good.correctness.passed {
                return Err(format!(
                    "reference solution files fail the tests: {}",
                    head(&good.correctness.raw)
                ));
            }
            let starter = tutor_eval::assess_project(&phase, &Default::default())
                .map_err(|e| format!("evaluator error: {e}"))?;
            if starter.correctness.passed {
                return Err("the starter files already pass the tests (they prove nothing)".into());
            }
            Ok(format!("({} files)", project.starter.len()))
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
