//! Who may approve what (RF-A06, docs/v2/RF-DELONIX-PLANO.md F5.7, decision D5). The people of
//! a project and their roles live in `.dxtutor/team.json`, next to the assistants' scopes:
//!
//! ```json
//! { "agents": { … },
//!   "people": [ { "name": "Ana", "email": "ana@example.com", "roles": ["architect", "tech_lead"] } ] }
//! ```
//!
//! Roles: `developer`, `architect`, `tech_lead`, `product_owner`. The person at the keyboard is the
//! project's git identity (`user.email`, else `user.name`). With no `people`, nothing is enforced
//! (as before). On a local desktop this is advisory — the real enforcement of who changes the
//! rules is CODEOWNERS and branch protection on the git server.

use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Person {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub roles: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Team {
    #[serde(default)]
    people: Vec<Person>,
}

/// The people of the project (`team.json`), empty when there is none.
pub fn people(root: &Path) -> Vec<Person> {
    std::fs::read_to_string(root.join(".dxtutor/team.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Team>(&t).ok())
        .map(|t| t.people)
        .unwrap_or_default()
}

fn git_config(root: &Path, key: &str) -> Option<String> {
    std::process::Command::new("git")
        .args(["config", key])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The roles of the person at the keyboard; `None` when the project defines no people.
pub fn my_roles(root: &Path) -> Option<Vec<String>> {
    let people = people(root);
    if people.is_empty() {
        return None;
    }
    let email = git_config(root, "user.email").unwrap_or_default();
    let name = git_config(root, "user.name").unwrap_or_default();
    Some(roles_of(&people, &email, &name))
}

/// The roles of the person with this git identity (email first, else name).
pub fn roles_of(people: &[Person], email: &str, name: &str) -> Vec<String> {
    people
        .iter()
        .find(|p| {
            (!email.is_empty() && p.email.eq_ignore_ascii_case(email))
                || (!name.is_empty() && p.name == name)
        })
        .map(|p| p.roles.clone())
        .unwrap_or_default()
}

/// Ok when the person at the keyboard has one of `need` (or the project defines no people).
pub fn require(root: &Path, need: &[&str], what: &str) -> Result<(), String> {
    check(my_roles(root).as_deref(), need, what)
}

/// The rule itself, for the tests: `None` roles = no people defined.
pub fn check(roles: Option<&[String]>, need: &[&str], what: &str) -> Result<(), String> {
    match roles {
        None => Ok(()),
        Some(r) if r.iter().any(|x| need.contains(&x.as_str())) => Ok(()),
        Some(_) => Err(format!(
            "{what} é de {} (.dxtutor/team.json, RF-A06)",
            need.iter()
                .map(|n| match *n {
                    "architect" => "Arquitecto",
                    "tech_lead" => "Tech Lead",
                    "product_owner" => "Product Owner",
                    _ => "Developer",
                })
                .collect::<Vec<_>>()
                .join(" ou ")
        )),
    }
}

/// Who may record (or withdraw) the functional approval of an issue — the integration gate's third
/// condition (Multi Co-Dev, phase 2). The issue's responsible is its `assignee` (the «responsável»
/// of the Project model, docs/v2/UI-AUDIT.md item 5); a Product Owner or a Tech Lead may also do it,
/// as they move an issue to Done (RF-A06). `me`: the names the person at the keyboard goes by (git
/// `user.name`, `user.email`); `also`: someone else allowed (who approved, for a withdrawal).
///
/// - The assignee (or `also`) may, always.
/// - With people in `team.json` (`roles` is `Some`): a Product Owner or a Tech Lead may too.
/// - Without people: when the issue has no assignee, whoever is at the keyboard (nothing else
///   to go by); when it has one, only that person — the record says who is responsible.
pub fn functional_check(
    roles: Option<&[String]>,
    assignee: &str,
    also: Option<&str>,
    me: &[&str],
) -> Result<(), String> {
    responsible_check(roles, assignee, also, me, "a aprovação funcional")
}

/// The rule of [`functional_check`] for any act that is the issue's responsible's (or a PO's / a
/// Tech Lead's): `what` names the act in the refusal.
pub fn responsible_check(
    roles: Option<&[String]>,
    assignee: &str,
    also: Option<&str>,
    me: &[&str],
    what: &str,
) -> Result<(), String> {
    let is_me = |who: &str| {
        let w = who.trim();
        !w.is_empty()
            && me
                .iter()
                .any(|m| !m.trim().is_empty() && m.trim().eq_ignore_ascii_case(w))
    };
    if is_me(assignee) || also.is_some_and(is_me) {
        return Ok(());
    }
    match roles {
        Some(_) => check(roles, &["product_owner", "tech_lead"], what)
            .map_err(|e| format!("{e} — ou do responsável da issue ({})", assignee.trim())),
        None if assignee.trim().is_empty() => Ok(()),
        None => Err(format!(
            "{what} é do responsável da issue ({}): és {}",
            assignee.trim(),
            me.iter()
                .find(|m| !m.trim().is_empty())
                .map_or("outra pessoa", |m| m.trim())
        )),
    }
}

/// Who may delegate autonomy (Multi Co-Dev, phase 5) — asked when it is granted, with the person at
/// the keyboard, and again before every use, with the person who granted it (`me`: their name and
/// email; `roles`: theirs by `team.json`, `None` without people):
/// - over an **issue**: its assignee, or a Product Owner / Tech Lead ([`responsible_check`]);
/// - over a **sprint**: a Product Owner or a Tech Lead. Without people in `team.json` nothing is
///   enforced, as for every role of this module.
pub fn delegation_check(
    roles: Option<&[String]>,
    scope: &str,
    assignee: &str,
    me: &[&str],
) -> Result<(), String> {
    match scope {
        "issue" => responsible_check(roles, assignee, None, me, "delegar a autonomia desta issue"),
        "sprint" => check(
            roles,
            &["product_owner", "tech_lead"],
            "delegar a autonomia de uma sprint",
        ),
        other => Err(format!("âmbito desconhecido: {other}")),
    }
}

/// Is `path` (relative to the project) an ADR? Anything under `docs/adr/` or `docs/decisions/`,
/// and the files of `docs/architecture/` whose name starts with `ADR` — the folders where
/// `conformance::adr_accepted` looks (the rest of `docs/architecture/` is ordinary documentation).
pub fn is_adr(path: &str) -> bool {
    let p = path.trim_start_matches("./");
    p.starts_with("docs/adr/")
        || p.starts_with("docs/decisions/")
        || p.strip_prefix("docs/architecture/").is_some_and(|f| {
            !f.contains('/') && f.get(..3).is_some_and(|h| h.eq_ignore_ascii_case("adr"))
        })
}

/// The roles that approve a change to `path` (relative to the project), or `None` when any
/// developer may: the architect's rules and the ADRs, and the prompt templates.
pub fn approvers_of(path: &str) -> Option<&'static [&'static str]> {
    let p = path.trim_start_matches("./");
    if p == tutor_agent::conformance::RULES_FILE || is_adr(p) {
        Some(&["architect"])
    } else if p.starts_with(".dxtutor/prompts/") {
        Some(&["architect", "tech_lead"])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_by_git_identity_and_what_each_approves() {
        let people = vec![
            Person {
                name: "Ana".into(),
                email: "ana@x.pt".into(),
                roles: vec!["architect".into()],
            },
            Person {
                name: "Rui".into(),
                email: "".into(),
                roles: vec!["developer".into()],
            },
        ];
        assert_eq!(roles_of(&people, "ANA@x.pt", ""), vec!["architect"]);
        assert_eq!(roles_of(&people, "", "Rui"), vec!["developer"]);
        assert!(roles_of(&people, "zé@x.pt", "Zé").is_empty());
        let dev = vec!["developer".to_string()];
        let arch = vec!["architect".to_string()];
        // RF-A06: a developer cannot approve a change to the architecture rules
        let e = check(
            Some(&dev),
            approvers_of(".dxtutor/architecture.toml").unwrap(),
            "aprovar as regras",
        )
        .unwrap_err();
        assert!(e.contains("Arquitecto"), "{e}");
        assert!(check(
            Some(&arch),
            approvers_of("docs/adr/ADR-0001.md").unwrap(),
            "x"
        )
        .is_ok());
        assert_eq!(
            approvers_of(".dxtutor/prompts/issue.pt.md"),
            Some(&["architect", "tech_lead"][..])
        );
        assert_eq!(approvers_of("src/lib.rs"), None);
        // the ADRs of docs/architecture/ (where this repository keeps them), not its other documents
        assert_eq!(
            approvers_of("docs/architecture/ADR-0006-arch-studio.md"),
            Some(&["architect"][..])
        );
        assert_eq!(
            approvers_of("docs/architecture/adr-0009.md"),
            Some(&["architect"][..])
        );
        assert_eq!(approvers_of("docs/architecture/ARCHITECTURE.md"), None);
        assert_eq!(approvers_of("docs/architecture/old/ADR-1.md"), None);
        assert!(is_adr("docs/decisions/0003-db.md") && !is_adr("docs/v2/ADR.md"));
        // no people defined: nothing is enforced
        assert!(check(None, &["architect"], "x").is_ok());
    }

    #[test]
    fn the_functional_approval_is_the_responsibles_or_the_po_or_tech_leads() {
        let po = vec!["product_owner".to_string()];
        let dev = vec!["developer".to_string()];
        // the assignee, with or without a team
        assert!(functional_check(None, "Ana", None, &["ana", "ana@x.pt"]).is_ok());
        assert!(functional_check(Some(&dev), "Ana", None, &["Ana"]).is_ok());
        // someone else: refused without a team; with one, only a PO or a Tech Lead
        let e = functional_check(None, "Ana", None, &["Rui"]).unwrap_err();
        assert!(e.contains("Ana") && e.contains("Rui"), "{e}");
        let e = functional_check(Some(&dev), "Ana", None, &["Rui"]).unwrap_err();
        assert!(e.contains("Product Owner") && e.contains("Ana"), "{e}");
        assert!(functional_check(Some(&po), "Ana", None, &["Rui"]).is_ok());
        // no assignee and no team: whoever is at the keyboard; with a team, a PO or a Tech Lead
        assert!(functional_check(None, "", None, &["Rui"]).is_ok());
        assert!(functional_check(Some(&dev), "", None, &["Rui"]).is_err());
        // a withdrawal: who approved may too
        assert!(functional_check(None, "Ana", Some("Rui"), &["rui"]).is_ok());
        // an empty identity never matches an empty assignee
        assert!(functional_check(Some(&dev), "", None, &[""]).is_err());
    }

    #[test]
    fn who_may_delegate_autonomy() {
        let po = vec!["product_owner".to_string()];
        let dev = vec!["developer".to_string()];
        // an issue: its assignee, or a PO / Tech Lead
        assert!(delegation_check(Some(&dev), "issue", "Ana", &["Ana"]).is_ok());
        assert!(delegation_check(Some(&po), "issue", "Ana", &["Rui"]).is_ok());
        let e = delegation_check(Some(&dev), "issue", "Ana", &["Rui"]).unwrap_err();
        assert!(
            e.contains("delegar a autonomia") && e.contains("Product Owner"),
            "{e}"
        );
        // without people: the assignee only (anyone when there is none)
        assert!(delegation_check(None, "issue", "Ana", &["Rui"]).is_err());
        assert!(delegation_check(None, "issue", "", &["Rui"]).is_ok());
        // a sprint: a PO or a Tech Lead — the assignee of one issue is not enough
        assert!(delegation_check(Some(&dev), "sprint", "", &["Ana"]).is_err());
        assert!(delegation_check(Some(&po), "sprint", "", &["Ana"]).is_ok());
        assert!(delegation_check(None, "sprint", "", &["Ana"]).is_ok());
        assert!(delegation_check(None, "project", "", &["Ana"]).is_err());
    }

    #[test]
    fn people_come_from_team_json() {
        let d = tempfile::tempdir().unwrap();
        assert!(people(d.path()).is_empty());
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/team.json"),
            r#"{"agents": {}, "people": [{"name": "Ana", "roles": ["product_owner"]}]}"#,
        )
        .unwrap();
        assert_eq!(people(d.path())[0].roles, vec!["product_owner"]);
    }
}
