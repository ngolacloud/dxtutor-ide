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
