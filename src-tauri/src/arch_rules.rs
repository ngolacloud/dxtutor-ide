//! The architect's rules and ADRs, edited from the Studio (RF-A01/A04, docs/v2/RF-DELONIX-PLANO.md
//! F5.2/F5.5). The rules live in `.dxtutor/architecture.toml` (`tutor_agent::conformance`); the
//! Studio reads them, edits them as a form and writes them back here — validated, and only by the
//! architect when the project names its people (`.dxtutor/team.json`, F5.7). An ADR is accepted
//! by the architect too: its status line becomes `accepted` and who approved it is written under
//! it. Then the IDE proposes the architect's commit of exactly those files.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tutor_agent::conformance::{self, Rules, RULES_FILE};

/// The rules as the Studio shows them.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RulesDoc {
    /// The file exists.
    pub exists: bool,
    pub rules: Rules,
    /// The file does not parse: the form starts empty and saving replaces it.
    pub error: Option<String>,
    /// The person at the keyboard may change the rules and accept ADRs.
    pub can_edit: bool,
    /// Why not — or that the project names no people, so anyone may (advisory).
    pub note: String,
}

/// One ADR of the project.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Adr {
    /// Relative to the project.
    pub path: String,
    /// `ADR-0006`, `0003`… (what an exception's `adr` names).
    pub id: String,
    pub title: String,
    /// The word of its status line, lowercase (`proposed`, `aceite`…), or empty.
    pub status: String,
    pub accepted: bool,
}

const ARCHITECT: &[&str] = &["architect"];

fn who_may(root: &Path) -> (bool, String) {
    match crate::roles::my_roles(root) {
        None => (
            true,
            "No people in .dxtutor/team.json: anyone here may change the rules (advisory — the \
             real guard is CODEOWNERS on the git server)."
                .into(),
        ),
        Some(r) if r.iter().any(|x| x == "architect") => (true, String::new()),
        Some(_) => (
            false,
            "Only the architect changes the rules and accepts ADRs (.dxtutor/team.json).".into(),
        ),
    }
}

/// The project's rules (an empty set when there is no file).
pub fn load(root: &Path) -> RulesDoc {
    let (exists, rules, error) = match Rules::load(root) {
        Ok(Some(r)) => (true, r, None),
        Ok(None) => (false, Rules::default(), None),
        Err(e) => (true, Rules::default(), Some(e)),
    };
    let (can_edit, note) = who_may(root);
    RulesDoc {
        exists,
        rules,
        error,
        can_edit,
        note,
    }
}

/// Trims names and paths and drops empty entries (what a form leaves behind).
fn normalize(mut r: Rules) -> Rules {
    let clean = |v: &mut Vec<String>| {
        for s in v.iter_mut() {
            *s = s.trim().to_string();
        }
        v.retain(|s| !s.is_empty());
    };
    for l in &mut r.layers {
        l.name = l.name.trim().to_string();
        clean(&mut l.paths);
        clean(&mut l.imports);
        if let Some(u) = &mut l.may_use {
            clean(u);
        }
    }
    clean(&mut r.libraries.forbidden);
    clean(&mut r.libraries.approved);
    for n in &mut r.naming {
        clean(&mut n.paths);
        n.pattern = n.pattern.trim().to_string();
    }
    r.naming
        .retain(|n| !(n.paths.is_empty() && n.pattern.is_empty()));
    for e in &mut r.exceptions {
        e.adr = e.adr.trim().to_string();
        e.rule = e.rule.trim().to_string();
    }
    r.exceptions
        .retain(|e| !(e.adr.is_empty() && e.rule.is_empty()));
    r
}

/// Writes the rules (the architect only; refused with every problem when they do not hold).
pub fn save(root: &Path, rules: Rules) -> Result<RulesDoc, String> {
    crate::roles::require(root, ARCHITECT, "alterar as regras do arquitecto")?;
    let rules = normalize(rules);
    let problems = conformance::validate(&rules);
    if !problems.is_empty() {
        return Err(problems.join("\n"));
    }
    let text = conformance::to_toml(&rules)?;
    let path = root.join(RULES_FILE);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("{RULES_FILE}: {e}"))?;
    Ok(load(root))
}

fn parse_adr(rel: &str, text: &str) -> Adr {
    let file = rel.rsplit('/').next().unwrap_or(rel);
    let title = text
        .lines()
        .find_map(|l| l.strip_prefix("# "))
        .unwrap_or(file)
        .trim()
        .to_string();
    let status = conformance::adr_status(text);
    Adr {
        path: rel.to_string(),
        id: conformance::adr_id(file),
        accepted: matches!(status.as_str(), "accepted" | "aceite"),
        title,
        status,
    }
}

/// The project's ADRs (`docs/adr/`, `docs/decisions/` and the `ADR*` files of
/// `docs/architecture/`), by path.
pub fn adrs(root: &Path) -> Vec<Adr> {
    let mut out = Vec::new();
    for dir in ["docs/adr", "docs/decisions", "docs/architecture"] {
        let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
            continue;
        };
        for e in entries.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().to_string();
            let rel = format!("{dir}/{name}");
            if !name.ends_with(".md") || !crate::roles::is_adr(&rel) {
                continue;
            }
            if let Ok(t) = std::fs::read_to_string(e.path()) {
                out.push(parse_adr(&rel, &t));
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

fn git_config(root: &Path, key: &str) -> String {
    Command::new("git")
        .args(["config", key])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Today as `YYYY-MM-DD` (UTC; civil date from the days since 1970, H. Hinnant's algorithm).
pub fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    civil(secs.div_euclid(86_400))
}

fn civil(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// A path of the project the architect's actions may touch: the rules file or an ADR, inside it.
fn architect_file(rel: &str) -> Result<(), String> {
    if rel.split(['/', '\\']).any(|s| s == "..") || rel.starts_with('/') {
        return Err(format!("{rel}: fora da pasta do projecto"));
    }
    if rel == RULES_FILE || (crate::roles::is_adr(rel) && rel.ends_with(".md")) {
        Ok(())
    } else {
        Err(format!("{rel}: não é o ficheiro de regras nem um ADR"))
    }
}

/// Accepts the ADR at `rel` (the architect only). Already accepted: nothing changes.
pub fn accept_adr(root: &Path, rel: &str) -> Result<Adr, String> {
    architect_file(rel)?;
    if rel == RULES_FILE {
        return Err(format!("{rel}: não é um ADR"));
    }
    crate::roles::require(root, ARCHITECT, "aceitar um ADR")?;
    let path = root.join(rel);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{rel}: {e}"))?;
    let adr = parse_adr(rel, &text);
    if adr.accepted {
        return Ok(adr);
    }
    let name = git_config(root, "user.name");
    let email = git_config(root, "user.email");
    let who =
        match (name.is_empty(), email.is_empty()) {
            (false, false) => format!("{name} <{email}>"),
            (false, true) => name,
            (true, false) => email,
            (true, true) => return Err(
                "sem identidade git (git config user.name): quem aceita o ADR fica escrito nele"
                    .into(),
            ),
        };
    let next = conformance::accept_adr_text(&text, &who, &today());
    std::fs::write(&path, &next).map_err(|e| format!("{rel}: {e}"))?;
    Ok(parse_adr(rel, &next))
}

/// The architect's commit of exactly `paths` (the rules file and ADRs): other staged changes stay
/// staged and out of it. Returns the new commit's short hash.
pub fn commit(root: &Path, paths: &[String], message: &str) -> Result<String, String> {
    if paths.is_empty() {
        return Err("nada para commitar".into());
    }
    for p in paths {
        architect_file(p)?;
    }
    if message.trim().is_empty() {
        return Err("a mensagem do commit está vazia".into());
    }
    crate::roles::require(root, ARCHITECT, "commitar as regras e os ADR")?;
    tutor_eval::git::require_identity(root)?;
    let run = |args: &[&str]| -> Result<String, String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .map_err(|e| format!("could not start git: {e}"))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    };
    let mut add = vec!["add", "--"];
    add.extend(paths.iter().map(String::as_str));
    run(&add)?;
    let mut ci = vec!["commit", "--only", "-m", message, "--"];
    ci.extend(paths.iter().map(String::as_str));
    run(&ci)?;
    run(&["rev-parse", "--short", "HEAD"])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(d: &Path, args: &[&str]) -> String {
        let o = Command::new("git")
            .args(args)
            .current_dir(d)
            .output()
            .unwrap();
        assert!(
            o.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    fn repo(email: &str) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q", "-b", "main"]);
        git(d.path(), &["config", "user.email", email]);
        git(d.path(), &["config", "user.name", "Ana"]);
        d
    }

    fn team(d: &Path) {
        std::fs::create_dir_all(d.join(".dxtutor")).unwrap();
        std::fs::write(
            d.join(".dxtutor/team.json"),
            r#"{"people": [{"email": "ana@x.pt", "roles": ["architect"]}, {"email": "rui@x.pt", "roles": ["developer"]}]}"#,
        )
        .unwrap();
    }

    fn layers() -> Rules {
        Rules {
            layers: vec![
                conformance::Layer {
                    name: " domain ".into(),
                    paths: vec!["src/domain/**".into(), " ".into()],
                    may_use: Some(vec![]),
                    imports: vec![],
                },
                conformance::Layer {
                    name: "app".into(),
                    paths: vec!["src/app/**".into()],
                    may_use: Some(vec!["domain".into()]),
                    imports: vec![],
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn the_architect_saves_the_rules_validated_and_a_developer_cannot() {
        let d = repo("ana@x.pt");
        let doc = load(d.path());
        assert!(!doc.exists && doc.can_edit && doc.note.contains("No people"));
        team(d.path());
        assert!(load(d.path()).can_edit && load(d.path()).note.is_empty());
        let saved = save(d.path(), layers()).unwrap();
        assert!(saved.exists && saved.error.is_none());
        assert_eq!(saved.rules.layers[0].name, "domain", "trimmed");
        assert_eq!(
            saved.rules.layers[0].paths,
            ["src/domain/**"],
            "empty paths dropped"
        );
        // the conformance check reads what was written
        let v = conformance::check(&saved.rules, "src/domain/a.rs", "use crate::app::x;\n");
        assert_eq!(v[0].rule, "layer:domain->app");
        // invalid rules are refused with what is wrong
        let mut bad = layers();
        bad.layers[1].may_use = Some(vec!["infra".into()]);
        assert!(save(d.path(), bad)
            .unwrap_err()
            .contains("«infra», which is not a layer"));
        // a developer at the keyboard cannot change them
        git(d.path(), &["config", "user.email", "rui@x.pt"]);
        let doc = load(d.path());
        assert!(!doc.can_edit && doc.note.contains("Only the architect"));
        assert!(save(d.path(), layers()).unwrap_err().contains("Arquitecto"));
        // a broken file is reported, and the form starts empty
        std::fs::write(d.path().join(RULES_FILE), "layers = 3").unwrap();
        let doc = load(d.path());
        assert!(doc.exists && doc.error.is_some() && doc.rules.layers.is_empty());
    }

    #[test]
    fn the_adrs_are_listed_and_only_the_architect_accepts_one() {
        let d = repo("rui@x.pt");
        std::fs::create_dir_all(d.path().join("docs/architecture")).unwrap();
        std::fs::create_dir_all(d.path().join("docs/adr")).unwrap();
        std::fs::write(
            d.path().join("docs/architecture/ADR-0007-queue.md"),
            "# ADR-0007 — Queue\n\nStatus: proposed\n",
        )
        .unwrap();
        std::fs::write(
            d.path().join("docs/architecture/ARCHITECTURE.md"),
            "# Overview\n",
        )
        .unwrap();
        std::fs::write(
            d.path().join("docs/adr/0003-db.md"),
            "# DB\n\n- **Estado:** aceite\n",
        )
        .unwrap();
        let list = adrs(d.path());
        assert_eq!(
            list.iter()
                .map(|a| (a.id.as_str(), a.status.as_str(), a.accepted))
                .collect::<Vec<_>>(),
            [("0003", "aceite", true), ("ADR-0007", "proposed", false)]
        );
        assert_eq!(list[1].title, "ADR-0007 — Queue");
        team(d.path());
        let rel = "docs/architecture/ADR-0007-queue.md";
        assert!(accept_adr(d.path(), rel)
            .unwrap_err()
            .contains("Arquitecto"));
        git(d.path(), &["config", "user.email", "ana@x.pt"]);
        let a = accept_adr(d.path(), rel).unwrap();
        assert!(a.accepted && a.status == "accepted");
        let text = std::fs::read_to_string(d.path().join(rel)).unwrap();
        assert!(text.contains("Approved by: Ana <ana@x.pt> ("), "{text}");
        assert!(conformance::adr_accepted(d.path(), "ADR-0007"));
        // again: nothing changes; other files are refused
        assert_eq!(accept_adr(d.path(), rel).unwrap(), a);
        assert_eq!(std::fs::read_to_string(d.path().join(rel)).unwrap(), text);
        assert!(accept_adr(d.path(), "docs/architecture/ARCHITECTURE.md")
            .unwrap_err()
            .contains("não é"));
        assert!(accept_adr(d.path(), "../x/docs/adr/1.md")
            .unwrap_err()
            .contains("fora"));
    }

    #[test]
    fn the_architects_commit_takes_only_the_rules_and_the_adrs() {
        let d = repo("ana@x.pt");
        team(d.path());
        std::fs::write(d.path().join("README.md"), "x\n").unwrap();
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-qm", "init"]);
        save(d.path(), layers()).unwrap();
        // something else is staged: it stays staged and out of the commit
        std::fs::write(d.path().join("README.md"), "y\n").unwrap();
        git(d.path(), &["add", "README.md"]);
        let h = commit(
            d.path(),
            &[RULES_FILE.to_string()],
            "docs(arch): the architect's rules",
        )
        .unwrap();
        assert_eq!(git(d.path(), &["rev-parse", "--short", "HEAD"]), h);
        assert_eq!(
            git(d.path(), &["show", "--name-only", "--format=", "HEAD"]),
            RULES_FILE
        );
        assert_eq!(
            git(d.path(), &["diff", "--cached", "--name-only"]),
            "README.md"
        );
        assert!(commit(d.path(), &["src/lib.rs".into()], "x")
            .unwrap_err()
            .contains("não é"));
        assert!(commit(d.path(), &[RULES_FILE.into()], " ")
            .unwrap_err()
            .contains("vazia"));
        git(d.path(), &["config", "user.email", "rui@x.pt"]);
        assert!(commit(d.path(), &[RULES_FILE.into()], "x")
            .unwrap_err()
            .contains("Arquitecto"));
    }

    #[test]
    fn the_civil_date() {
        assert_eq!(civil(0), "1970-01-01");
        assert_eq!(civil(20_416), "2025-11-24");
        assert_eq!(civil(11_016), "2000-02-29");
        assert_eq!(today().len(), 10);
    }
}
