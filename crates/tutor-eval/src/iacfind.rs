//! IaC findings from the files themselves (r23 F4a, docs/v2/AUDIT-r23.md §4.4 — P03, C03): the
//! built-in rules over `.tf` files, shown in the editor and the Problems view on save. The tools
//! (tflint, checkov, trivy) join in the F4b pipeline; these rules need nothing installed.
//!
//! The rules are about secrets, the thing that must never end up in a plan or a state file:
//! - `secret-argument` (error): an argument with a secret's name (`password`, `token`,
//!   `client_secret`…) set from a variable or a literal — Terraform/OpenTofu keep that value in
//!   the state and the plan. A write-only argument (`password_wo`) or an ephemeral value (Vault)
//!   keeps it out.
//! - `variable-not-sensitive` (warning): a variable with a secret's name not marked `sensitive`.
//! - the secret patterns of `tutor_protect` (a URL with credentials, an API key…) as errors.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IacFinding {
    /// relative to the project, `/` separators
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub end_col: u32,
    /// `error` | `warning`
    pub severity: String,
    pub rule: String,
    pub message: String,
}

const SECRET_NAME: &str = r"[a-z0-9_]*(?:password|passwd|secret|token|api_key|apikey|private_key|access_key|client_secret|connection_string)[a-z0-9_]*";

fn argument() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(&format!(r#"^(\s*)({SECRET_NAME})\s*=\s*(var\.[A-Za-z0-9_]+|local\.[A-Za-z0-9_]+|"[^"$]+")\s*(?:#.*|//.*)?$"#)).expect("argument rule")
    })
}

fn variable_block() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(&format!(r#"^\s*variable\s+"({SECRET_NAME})"\s*\{{"#)).expect("variable rule")
    })
}

/// `sensitive = true` / `ephemeral = true` in a block's body.
fn flag(name: &str) -> &'static Regex {
    static S: OnceLock<Regex> = OnceLock::new();
    static E: OnceLock<Regex> = OnceLock::new();
    let (cell, re) = if name == "sensitive" {
        (&S, r"(?m)^\s*sensitive\s*=\s*true\b")
    } else {
        (&E, r"(?m)^\s*ephemeral\s*=\s*true\b")
    };
    cell.get_or_init(|| Regex::new(re).expect("flag rule"))
}

/// The findings of one `.tf` file's text.
pub fn builtin(file: &str, text: &str) -> Vec<IacFinding> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = vec![];
    let redactor = tutor_protect::redact::Redactor::new();
    let mut depth = 0i32;
    let mut in_variable: Option<(usize, String, i32)> = None;
    for (i, l) in lines.iter().enumerate() {
        let n = i as u32 + 1;
        let code = l.split('#').next().unwrap_or("");
        if let Some(c) = argument().captures(l) {
            let name = c.get(2).unwrap();
            let value = c.get(3).unwrap().as_str();
            // a write-only argument never reaches the state
            if !name.as_str().ends_with("_wo") && depth > 0 {
                let from = if value.starts_with('"') {
                    "a literal".to_string()
                } else {
                    format!("`{value}`")
                };
                out.push(IacFinding {
                    file: file.into(),
                    line: n,
                    col: name.start() as u32 + 1,
                    end_col: c.get(3).unwrap().end() as u32 + 1,
                    severity: "error".into(),
                    rule: "secret-argument".into(),
                    message: format!(
                        "`{}` takes a secret from {from}: its value is kept in the state and the plan. Use a write-only argument (`{}_wo`) or an ephemeral value from Vault.",
                        name.as_str(),
                        name.as_str()
                    ),
                });
            }
        }
        if let Some(c) = variable_block().captures(l) {
            in_variable = Some((i, c[1].to_string(), depth));
        }
        for rule in redactor.rules_in(l) {
            if rule == "secret-assignment" && argument().is_match(l) {
                continue;
            }
            out.push(IacFinding {
                file: file.into(),
                line: n,
                col: 1,
                end_col: l.len() as u32 + 1,
                severity: "error".into(),
                rule: rule.into(),
                message: format!("a secret written in the file ({rule}): read it from Vault or a variable marked sensitive, never from the code"),
            });
        }
        depth += code.matches('{').count() as i32 - code.matches('}').count() as i32;
        if let Some((start, name, d)) = in_variable.clone() {
            if depth <= d {
                let body = lines[start..=i].join("\n");
                let sensitive = flag("sensitive").is_match(&body);
                let ephemeral = flag("ephemeral").is_match(&body);
                if !sensitive && !ephemeral {
                    out.push(IacFinding {
                        file: file.into(),
                        line: start as u32 + 1,
                        col: 1,
                        end_col: lines[start].len() as u32 + 1,
                        severity: "warning".into(),
                        rule: "variable-not-sensitive".into(),
                        message: format!("variable `{name}` holds a secret but is not marked `sensitive = true` (or `ephemeral = true`): it shows in plans and logs"),
                    });
                }
                in_variable = None;
            }
        }
    }
    out
}

const SKIP: &[&str] = &[
    ".terraform",
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
];

/// The `.tf` files of the project (relative, sorted).
pub fn tf_files(root: &Path) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
        if depth > 12 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.filter_map(Result::ok) {
            let p: PathBuf = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if !SKIP.contains(&name.as_str()) {
                    walk(root, &p, out, depth + 1);
                }
            } else if name.ends_with(".tf") {
                if let Ok(rel) = p.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    let mut out = vec![];
    walk(root, root, &mut out, 0);
    out.sort();
    out
}

/// The built-in findings of every `.tf` file of the project.
pub fn scan_root(root: &Path) -> Vec<IacFinding> {
    tf_files(root)
        .iter()
        .flat_map(|f| {
            std::fs::read_to_string(root.join(f))
                .map(|t| builtin(f, &t))
                .unwrap_or_default()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// r23 F4 acceptance: a `.tf` with `password = var.x` shows as an error.
    #[test]
    fn a_secret_from_a_variable_is_an_error() {
        let tf = "variable \"db_password\" {\n  type = string\n}\n\nresource \"aws_db_instance\" \"main\" {\n  username = \"app\"\n  password = var.db_password\n  password_wo = var.x\n  token = \"abc\"\n}\n";
        let f = builtin("infra/main.tf", tf);
        let errors: Vec<_> = f.iter().filter(|x| x.severity == "error").collect();
        assert_eq!(errors.len(), 2, "{f:#?}");
        assert_eq!(
            (errors[0].line, errors[0].rule.as_str()),
            (7, "secret-argument")
        );
        assert_eq!(errors[0].col, 3);
        assert!(errors[0].message.contains("password_wo"));
        assert_eq!(errors[1].line, 9);
        let warn: Vec<_> = f.iter().filter(|x| x.severity == "warning").collect();
        assert_eq!(
            (warn.len(), warn[0].line, warn[0].rule.as_str()),
            (1, 1, "variable-not-sensitive")
        );
    }

    #[test]
    fn sensitive_variables_and_clean_files_are_quiet() {
        let tf = "variable \"api_token\" {\n  type      = string\n  sensitive = true\n}\n\nresource \"x\" \"y\" {\n  name = var.name\n  password_wo = var.api_token\n}\n";
        assert!(builtin("a.tf", tf).is_empty(), "{:#?}", builtin("a.tf", tf));
        // the top level is not an argument (a variable named like a secret is fine there)
        assert!(builtin("b.tf", "locals {\n  x = 1\n}\n").is_empty());
        let url = builtin(
            "c.tf",
            "resource \"x\" \"y\" {\n  url = \"postgres://u:p@h/db\"\n}\n",
        );
        assert_eq!(
            (url.len(), url[0].rule.as_str(), url[0].severity.as_str()),
            (1, "url-credentials", "error")
        );
    }

    #[test]
    fn finds_the_tf_files_of_a_project() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("infra/.terraform/modules")).unwrap();
        std::fs::write(
            d.path().join("infra/main.tf"),
            "resource \"a\" \"b\" {\n  password = var.p\n}\n",
        )
        .unwrap();
        std::fs::write(
            d.path().join("infra/.terraform/modules/x.tf"),
            "resource \"a\" \"b\" {\n  password = var.p\n}\n",
        )
        .unwrap();
        std::fs::write(d.path().join("README.md"), "x").unwrap();
        assert_eq!(tf_files(d.path()), vec!["infra/main.tf"]);
        assert_eq!(scan_root(d.path()).len(), 1);
    }
}
