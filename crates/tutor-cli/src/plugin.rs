//! `dxt plugin …` — instalar, listar, remover, validar e criar plugins de curso.
//!
//! Usa o mesmo registo que a app desktop (`tutor_plugins::Store`), por isso um plugin
//! instalado aqui aparece no Learning Track da app, e vice-versa.

use std::path::Path;

use anyhow::{anyhow, bail, Result};
use tutor_plugins::{scaffold, validate_dir, Source, Store, Taken, OFFICIAL_ORG};

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

Sources:
  python                          official course (github.com/dxtutor-courses/python)
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
        println!("No plugins installed. Try: dxt plugin install <language>  (from github.com/{OFFICIAL_ORG})");
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
