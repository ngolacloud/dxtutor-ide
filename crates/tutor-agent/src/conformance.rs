//! The architect's rules, written down and checked on every change of the agent (RF-A01/A03/A04,
//! docs/v2/RF-DELONIX-PLANO.md F5). They live in `.dxtutor/architecture.toml` (TOML, like
//! `.dxtutor/harness.toml`; `.dxtutor/` is protected from the agent, so only a human changes them):
//!
//! ```toml
//! [[layers]]
//! name = "domain"
//! paths = ["src/domain/**"]
//! may_use = []                      # besides itself; no `may_use` = unrestricted
//!
//! [libraries]
//! forbidden = ["lodash", "moment"]
//! approved = []                     # non-empty: only these (and the standard library)
//!
//! [[naming]]
//! paths = ["src/**/*.rs"]
//! pattern = "^[a-z0-9_]+\\.rs$"
//!
//! [[exceptions]]                    # a deviation needs an accepted ADR (RF-A04)
//! adr = "ADR-0007"
//! rule = "library:moment"
//! ```

use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::permissions::scope_matches;

pub const RULES_FILE: &str = ".dxtutor/architecture.toml";

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Layer {
    pub name: String,
    #[serde(default)]
    pub paths: Vec<String>,
    /// The other layers this one may import. `None`: unrestricted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub may_use: Option<Vec<String>>,
    /// How an import into this layer looks (substrings); by default a path or module segment
    /// equal to the layer's name (`../domain/x`, `crate::domain::x`, `app.domain`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub imports: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Libraries {
    #[serde(default)]
    pub forbidden: Vec<String>,
    #[serde(default)]
    pub approved: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Naming {
    pub paths: Vec<String>,
    pub pattern: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Exception {
    pub adr: String,
    /// `library:<name>`, `layer:<from>-><to>` or `naming:<path>`.
    pub rule: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Rules {
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub libraries: Libraries,
    #[serde(default)]
    pub naming: Vec<Naming>,
    #[serde(default)]
    pub exceptions: Vec<Exception>,
}

/// One broken rule.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Violation {
    /// The rule key an exception names: `library:lodash`, `layer:domain->infra`, `naming:a.rs`.
    pub rule: String,
    pub message: String,
    pub path: String,
    /// 1-based line in the text checked, when known.
    pub line: Option<usize>,
}

impl Rules {
    /// The project's rules (`None`: no rules file, nothing to check).
    pub fn load(root: &Path) -> Result<Option<Rules>, String> {
        match std::fs::read_to_string(root.join(RULES_FILE)) {
            Ok(t) => toml::from_str(&t)
                .map(Some)
                .map_err(|e| format!("{RULES_FILE}: {e}")),
            Err(_) => Ok(None),
        }
    }

    fn layer_of(&self, path: &str) -> Option<&Layer> {
        self.layers
            .iter()
            .find(|l| l.paths.iter().any(|p| scope_matches(p, path)))
    }

    fn imports_into(&self, target: &str) -> Option<&Layer> {
        let segs: Vec<&str> = target
            .split(['/', ':', '.', '\\'])
            .filter(|s| !s.is_empty())
            .collect();
        self.layers.iter().find(|l| {
            if l.imports.is_empty() {
                segs.contains(&l.name.as_str())
            } else {
                l.imports.iter().any(|i| target.contains(i.as_str()))
            }
        })
    }
}

/// What is wrong with a set of rules before it is written (F5.2: the Studio edits them): every
/// layer named once and with paths, `may_use` naming other layers, naming patterns that compile,
/// exceptions with an ADR and a rule key of a known kind. Empty: the rules may be written.
pub fn validate(rules: &Rules) -> Vec<String> {
    let mut out = Vec::new();
    let names: Vec<&str> = rules.layers.iter().map(|l| l.name.trim()).collect();
    for (k, l) in rules.layers.iter().enumerate() {
        let name = l.name.trim();
        if name.is_empty() {
            out.push(format!("layer {}: it needs a name", k + 1));
            continue;
        }
        if names.iter().filter(|n| **n == name).count() > 1
            && names.iter().position(|n| *n == name) == Some(k)
        {
            out.push(format!("layer «{name}»: the name is used more than once"));
        }
        if l.paths.iter().all(|p| p.trim().is_empty()) {
            out.push(format!(
                "layer «{name}»: it needs at least one path (e.g. src/{name}/**)"
            ));
        }
        for u in l.may_use.iter().flatten() {
            if u.trim() == name {
                out.push(format!(
                    "layer «{name}»: it does not need to list itself in may_use"
                ));
            } else if !names.contains(&u.trim()) {
                out.push(format!(
                    "layer «{name}»: may_use names «{u}», which is not a layer"
                ));
            }
        }
    }
    for (k, n) in rules.naming.iter().enumerate() {
        if n.paths.iter().all(|p| p.trim().is_empty()) {
            out.push(format!("naming rule {}: it needs at least one path", k + 1));
        }
        if let Err(e) = Regex::new(&n.pattern) {
            out.push(format!(
                "naming rule {}: the pattern does not compile ({e})",
                k + 1
            ));
        }
    }
    for (k, e) in rules.exceptions.iter().enumerate() {
        if e.adr.trim().is_empty() {
            out.push(format!(
                "exception {}: it needs the ADR that accepts it",
                k + 1
            ));
        }
        if !["library:", "layer:", "naming:"]
            .iter()
            .any(|p| e.rule.starts_with(p))
        {
            out.push(format!(
                "exception {}: the rule must be library:<name>, layer:<from>-><to> or naming:<path>",
                k + 1
            ));
        }
    }
    out
}

/// The rules as the TOML file is written (with a header saying who changes it).
pub fn to_toml(rules: &Rules) -> Result<String, String> {
    let body = toml::to_string_pretty(rules).map_err(|e| e.to_string())?;
    Ok(format!(
        "# The architect's rules (RF-A01, docs/v2/RF-DELONIX-PLANO.md F5). Edited in the Studio\n\
         # («Architecture» → Rules) or by hand; only the architect approves a change. Checked on\n\
         # every change of the agent and in the Problems panel.\n\n{body}"
    ))
}

fn import_patterns() -> &'static [(&'static [&'static str], Regex)] {
    static P: std::sync::OnceLock<Vec<(&'static [&'static str], Regex)>> =
        std::sync::OnceLock::new();
    P.get_or_init(|| {
        vec![
            (&["rs"][..], Regex::new(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([A-Za-z_][\w:]*)").unwrap()),
            (&["rs"][..], Regex::new(r"^\s*extern\s+crate\s+(\w+)").unwrap()),
            (&["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"][..], Regex::new(r#"(?:^|\s)(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap()),
            (&["py"][..], Regex::new(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))").unwrap()),
            (&["go"][..], Regex::new(r#"^\s*(?:import\s+)?(?:\w+\s+)?"([\w./-]+)"\s*$"#).unwrap()),
            (&["java", "kt", "kts"][..], Regex::new(r"^\s*import\s+(?:static\s+)?([\w.]+)").unwrap()),
            (&["cs"][..], Regex::new(r"^\s*using\s+(?:static\s+)?([\w.]+)\s*;").unwrap()),
            (&["swift"][..], Regex::new(r"^\s*import\s+(\w+)").unwrap()),
            (&["c", "h", "cc", "cpp", "cxx", "hpp", "hh"][..], Regex::new(r#"^\s*#\s*include\s*[<"]([^>"]+)[>"]"#).unwrap()),
        ]
    })
}

/// The imports in `text` of a file at `path`: `(line, target)`.
pub fn imports(path: &str, text: &str) -> Vec<(usize, String)> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let pats: Vec<&Regex> = import_patterns()
        .iter()
        .filter(|(exts, _)| exts.contains(&ext.as_str()))
        .map(|(_, r)| r)
        .collect();
    let mut out = vec![];
    for (n, line) in text.lines().enumerate() {
        for re in &pats {
            if let Some(c) = re.captures(line) {
                if let Some(m) = c.iter().skip(1).flatten().next() {
                    out.push((n + 1, m.as_str().trim_end_matches('.').to_string()));
                }
            }
        }
    }
    out
}

/// The external library an import names (`None`: relative or the project's own code).
fn library_of(path: &str, target: &str) -> Option<String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let t = target.trim();
    if t.starts_with('.') || t.starts_with('/') {
        return None;
    }
    match ext {
        "rs" => {
            let first = t.split("::").next()?;
            (!matches!(first, "crate" | "self" | "super" | "std" | "core" | "alloc"))
                .then(|| first.to_string())
        }
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => {
            if t.starts_with("node:") || t.starts_with('@') && !t.contains('/') {
                return None;
            }
            let mut parts = t.split('/');
            let first = parts.next()?;
            Some(if first.starts_with('@') {
                format!("{first}/{}", parts.next().unwrap_or(""))
            } else {
                first.to_string()
            })
        }
        _ => Some(t.split(['.', '/']).next()?.to_string()),
    }
}

/// Checks `text` — a whole file, or only the lines a change adds — of the file at `path`
/// (relative to the project) against the rules.
pub fn check(rules: &Rules, path: &str, text: &str) -> Vec<Violation> {
    let mut out = vec![];
    let v = |rule: String, message: String, line: Option<usize>| Violation {
        rule,
        message,
        path: path.to_string(),
        line,
    };
    let layer = rules.layer_of(path);
    for (line, target) in imports(path, text) {
        if let Some(lib) = library_of(path, &target) {
            if rules.libraries.forbidden.iter().any(|f| f == &lib) {
                out.push(v(
                    format!("library:{lib}"),
                    format!(
                        "{path}:{line} importa «{lib}», uma biblioteca proibida pelo arquitecto"
                    ),
                    Some(line),
                ));
                continue;
            }
            let own = rules.layers.iter().any(|l| l.name == lib);
            if !rules.libraries.approved.is_empty()
                && !own
                && !rules.libraries.approved.iter().any(|a| a == &lib)
            {
                out.push(v(
                    format!("library:{lib}"),
                    format!(
                        "{path}:{line} importa «{lib}», que não está nas bibliotecas aprovadas"
                    ),
                    Some(line),
                ));
                continue;
            }
        }
        if let (Some(from), Some(to)) = (layer, rules.imports_into(&target)) {
            if from.name != to.name {
                if let Some(allowed) = &from.may_use {
                    if !allowed.contains(&to.name) {
                        out.push(v(
                            format!("layer:{}->{}", from.name, to.name),
                            format!("{path}:{line}: a camada «{}» não pode depender de «{}» («{target}»)", from.name, to.name),
                            Some(line),
                        ));
                    }
                }
            }
        }
    }
    let file = Path::new(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(path);
    for n in &rules.naming {
        if n.paths.iter().any(|p| scope_matches(p, path)) {
            if let Ok(re) = Regex::new(&n.pattern) {
                if !re.is_match(file) {
                    out.push(v(
                        format!("naming:{path}"),
                        format!("{path}: o nome não segue a convenção {}", n.pattern),
                        None,
                    ));
                }
            }
        }
    }
    out
}

/// Is the ADR `id` accepted? Looks for `docs/adr/<id>*.md` or `docs/architecture/<id>*.md`
/// with a status line saying accepted (`Status: accepted` / `Estado: aceite`).
pub fn adr_accepted(root: &Path, id: &str) -> bool {
    let id = id.trim();
    if id.is_empty() {
        return false;
    }
    let re = Regex::new(r"(?im)^\W*(status|estado)\W*[:=]?\W*(accepted|aceite)").unwrap();
    ["docs/adr", "docs/architecture", "docs/decisions"]
        .iter()
        .any(|d| {
            std::fs::read_dir(root.join(d))
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with(id))
                .any(|e| std::fs::read_to_string(e.path()).is_ok_and(|t| re.is_match(&t)))
        })
}

fn adr_status_re() -> &'static Regex {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?im)^(\W*(status|estado)\W*?[:=]\W*)([[:alpha:]çãõéêíáú]+)(.*)$").unwrap()
    })
}

/// An ADR's id from its file name: `ADR-0006-arch-studio.md` → `ADR-0006`, `0003-db.md` → `0003`
/// (what an exception's `adr` names).
pub fn adr_id(file: &str) -> String {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"^(?i)(adr[-_]?\d+|\d+)").unwrap());
    let stem = file.trim_end_matches(".md");
    re.find(stem).map_or(stem, |m| m.as_str()).to_string()
}

/// The word of an ADR's status line, lowercase (`proposed`, `aceite`…), or empty without one.
pub fn adr_status(text: &str) -> String {
    adr_status_re()
        .captures(text)
        .map(|c| c[3].to_lowercase())
        .unwrap_or_default()
}

/// The ADR's text, accepted by `who` on `date` (RF-A04, F5.5): its status line says `accepted`
/// (`aceite` when it is written `Estado`), and a line under it says who approved it, in the same
/// form (a YAML key in a front matter; a bullet, bold or not, in a list). Without a status line,
/// one is added under the title.
pub fn accept_adr_text(text: &str, who: &str, date: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let front_end = if lines.first().map(|l| l.trim()) == Some("---") {
        lines
            .iter()
            .skip(1)
            .position(|l| l.trim() == "---")
            .map(|k| k + 1)
    } else {
        None
    };
    let re = adr_status_re();
    let found = lines
        .iter()
        .enumerate()
        .find_map(|(k, l)| re.captures(l).map(|c| (k, c)));
    let mut out: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    match found {
        Some((k, c)) => {
            let pt = c[2].eq_ignore_ascii_case("estado");
            out[k] = format!(
                "{}{}{}",
                &c[1],
                if pt { "aceite" } else { "accepted" },
                &c[4]
            );
            let label = if pt { "Aprovado por" } else { "Approved by" };
            let approved = if front_end.is_some_and(|end| k < end) {
                format!("approved_by: \"{who} ({date})\"")
            } else {
                let indent: String = out[k].chars().take_while(|c| c.is_whitespace()).collect();
                let bullet = if out[k].trim_start().starts_with("- ") {
                    "- "
                } else {
                    ""
                };
                if c[1].contains("**") {
                    format!("{indent}{bullet}**{label}:** {who} ({date})")
                } else {
                    format!("{indent}{bullet}{label}: {who} ({date})")
                }
            };
            out.insert(k + 1, approved);
        }
        None => {
            let at = out
                .iter()
                .position(|l| l.starts_with("# "))
                .map_or(0, |k| k + 1);
            out.insert(at, String::new());
            out.insert(at + 1, "Status: accepted".into());
            out.insert(at + 2, format!("Approved by: {who} ({date})"));
        }
    }
    out.join("\n")
}

/// The violations that no accepted ADR excuses (RF-A04).
pub fn unexcused(rules: &Rules, root: &Path, found: Vec<Violation>) -> Vec<Violation> {
    found
        .into_iter()
        .filter(|v| {
            !rules
                .exceptions
                .iter()
                .any(|e| e.rule == v.rule && adr_accepted(root, &e.adr))
        })
        .collect()
}

/// The whole repository against the rules (RF-A05, the drift of the rules): every file under a
/// layer or a naming rule, with what no accepted ADR excuses. `Ok(None)`: no rules file.
pub fn scan(root: &Path) -> Result<Option<Vec<Violation>>, String> {
    let Some(rules) = Rules::load(root)? else {
        return Ok(None);
    };
    let globs: Vec<&String> = rules
        .layers
        .iter()
        .flat_map(|l| l.paths.iter())
        .chain(rules.naming.iter().flat_map(|n| n.paths.iter()))
        .collect();
    let mut found = vec![];
    for e in ignore::WalkBuilder::new(root)
        .build()
        .filter_map(Result::ok)
    {
        if !e.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(rel) = e.path().strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if !globs.iter().any(|g| scope_matches(g, &rel)) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(e.path()) {
            found.extend(check(&rules, &rel, &text));
        }
    }
    Ok(Some(unexcused(&rules, root, found)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULES: &str = r#"
[[layers]]
name = "domain"
paths = ["src/domain/**"]
may_use = []

[[layers]]
name = "infrastructure"
paths = ["src/infrastructure/**"]

[libraries]
forbidden = ["lodash", "moment"]

[[naming]]
paths = ["src/**/*.rs"]
pattern = "^[a-z0-9_]+\\.rs$"

[[exceptions]]
adr = "ADR-0007"
rule = "library:moment"
"#;

    fn rules() -> Rules {
        toml::from_str(RULES).unwrap()
    }

    #[test]
    fn forbidden_libraries_layer_dependencies_and_names() {
        let r = rules();
        let v = check(&r, "src/domain/order.ts", "import _ from 'lodash';\nimport { Db } from '../infrastructure/db';\nimport { x } from './money';\n");
        let rules: Vec<&str> = v.iter().map(|v| v.rule.as_str()).collect();
        assert_eq!(
            rules,
            ["library:lodash", "layer:domain->infrastructure"],
            "{v:?}"
        );
        assert_eq!(v[0].line, Some(1));
        assert!(v[1]
            .message
            .contains("«domain» não pode depender de «infrastructure»"));
        // infrastructure may use the domain (no may_use = unrestricted)
        assert!(check(
            &r,
            "src/infrastructure/db.ts",
            "import { Order } from '../domain/order';\n"
        )
        .is_empty());
        // Rust: `use crate::infrastructure::…` from the domain
        let v = check(
            &r,
            "src/domain/mod.rs",
            "use crate::infrastructure::db::Pool;\nuse std::fmt;\n",
        );
        assert_eq!(
            v.iter().map(|v| v.rule.clone()).collect::<Vec<_>>(),
            ["layer:domain->infrastructure"]
        );
        assert_eq!(
            check(&r, "src/domain/BadName.rs", "")[0].rule,
            "naming:src/domain/BadName.rs"
        );
    }

    #[test]
    fn approved_libraries_and_imports_per_language() {
        let mut r = rules();
        r.libraries.approved = vec!["serde".into()];
        let v = check(
            &r,
            "src/infrastructure/x.rs",
            "use serde::Deserialize;\nuse reqwest::Client;\nuse std::io;\n",
        );
        assert_eq!(
            v.iter().map(|v| v.rule.clone()).collect::<Vec<_>>(),
            ["library:reqwest"]
        );
        assert_eq!(
            imports("a.py", "from app.domain import x\nimport os\n"),
            vec![(1, "app.domain".to_string()), (2, "os".to_string())]
        );
        assert_eq!(
            imports("a.java", "import static org.junit.Assert.*;\n")[0].1,
            "org.junit.Assert"
        );
        assert_eq!(
            imports("a.ts", "const fs = require('node:fs');\n")[0].1,
            "node:fs"
        );
        assert_eq!(
            library_of("a.ts", "@scope/pkg/sub").as_deref(),
            Some("@scope/pkg")
        );
    }

    #[test]
    fn a_deviation_needs_an_accepted_adr() {
        let d = tempfile::tempdir().unwrap();
        let r = rules();
        let found = check(
            &r,
            "src/infrastructure/time.ts",
            "import m from 'moment';\n",
        );
        assert_eq!(found.len(), 1);
        // no ADR → still a violation
        assert_eq!(unexcused(&r, d.path(), found.clone()).len(), 1);
        std::fs::create_dir_all(d.path().join("docs/adr")).unwrap();
        std::fs::write(
            d.path().join("docs/adr/ADR-0007-moment.md"),
            "# ADR-0007\n- **Estado:** proposto\n",
        )
        .unwrap();
        assert_eq!(
            unexcused(&r, d.path(), found.clone()).len(),
            1,
            "proposed is not accepted"
        );
        std::fs::write(
            d.path().join("docs/adr/ADR-0007-moment.md"),
            "# ADR-0007\n- **Estado:** aceite\n",
        )
        .unwrap();
        assert!(unexcused(&r, d.path(), found).is_empty());
        // the rules load from the project
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(d.path().join(RULES_FILE), RULES).unwrap();
        assert_eq!(Rules::load(d.path()).unwrap().unwrap().layers.len(), 2);
        std::fs::write(d.path().join(RULES_FILE), "layers = 3").unwrap();
        assert!(Rules::load(d.path()).is_err());
    }

    #[test]
    fn the_rules_the_studio_writes_are_validated_and_read_back_the_same() {
        let good = Rules {
            layers: vec![
                Layer {
                    name: "domain".into(),
                    paths: vec!["src/domain/**".into()],
                    may_use: Some(vec![]),
                    imports: vec![],
                },
                Layer {
                    name: "app".into(),
                    paths: vec!["src/app/**".into()],
                    may_use: Some(vec!["domain".into()]),
                    imports: vec![],
                },
                Layer {
                    name: "ui".into(),
                    paths: vec!["src/ui/**".into()],
                    may_use: None,
                    imports: vec!["@ui/".into()],
                },
            ],
            libraries: Libraries {
                forbidden: vec!["moment".into()],
                approved: vec![],
            },
            naming: vec![Naming {
                paths: vec!["src/**/*.rs".into()],
                pattern: "^[a-z0-9_]+\\.rs$".into(),
            }],
            exceptions: vec![Exception {
                adr: "ADR-0007".into(),
                rule: "library:moment".into(),
            }],
        };
        assert!(validate(&good).is_empty(), "{:?}", validate(&good));
        let text = to_toml(&good).unwrap();
        assert!(text.starts_with("# The architect's rules"));
        let back: Rules = toml::from_str(&text).unwrap();
        // the round trip keeps `may_use` absent (unrestricted) apart from an empty list (nothing)
        assert_eq!(back, good, "{text}");

        let bad = Rules {
            layers: vec![
                Layer {
                    name: "domain".into(),
                    paths: vec![],
                    may_use: Some(vec!["domain".into(), "infra".into()]),
                    imports: vec![],
                },
                Layer {
                    name: "domain".into(),
                    paths: vec!["x/**".into()],
                    may_use: None,
                    imports: vec![],
                },
                Layer {
                    name: " ".into(),
                    ..Default::default()
                },
            ],
            naming: vec![Naming {
                paths: vec![],
                pattern: "([".into(),
            }],
            exceptions: vec![Exception {
                adr: "".into(),
                rule: "moment".into(),
            }],
            ..Default::default()
        };
        let p = validate(&bad);
        for want in [
            "layer «domain»: the name is used more than once",
            "layer «domain»: it needs at least one path",
            "layer «domain»: it does not need to list itself",
            "may_use names «infra», which is not a layer",
            "layer 3: it needs a name",
            "naming rule 1: it needs at least one path",
            "naming rule 1: the pattern does not compile",
            "exception 1: it needs the ADR",
            "exception 1: the rule must be",
        ] {
            assert!(p.iter().any(|x| x.contains(want)), "{want} — {p:?}");
        }
        assert_eq!(p.iter().filter(|x| x.contains("more than once")).count(), 1);
    }
    #[test]
    fn accepting_an_adr_keeps_its_form_and_says_who_approved_it() {
        let pt = "# ADR-0006 — Studio\n\n- **Estado:** proposto (revisão a 2026-11-20)\n- **Data:** 2026-11-20\n";
        assert_eq!(
            accept_adr_text(pt, "Ana <ana@x.pt>", "2026-11-24"),
            "# ADR-0006 — Studio\n\n- **Estado:** aceite (revisão a 2026-11-20)\n- **Aprovado por:** Ana <ana@x.pt> (2026-11-24)\n- **Data:** 2026-11-20\n"
        );
        let en = "# Use SQLite\n\nStatus: proposed\n\nContext…\n";
        assert_eq!(
            accept_adr_text(en, "Ana", "2026-11-24"),
            "# Use SQLite\n\nStatus: accepted\nApproved by: Ana (2026-11-24)\n\nContext…\n"
        );
        let yaml = "---\nstatus: proposed\ndate: 2026-11-01\n---\n# Queue\n";
        assert_eq!(
            accept_adr_text(yaml, "Ana", "2026-11-24"),
            "---\nstatus: accepted\napproved_by: \"Ana (2026-11-24)\"\ndate: 2026-11-01\n---\n# Queue\n"
        );
        let none = "# No status\n\nText.\n";
        assert_eq!(
            accept_adr_text(none, "Ana", "2026-11-24"),
            "# No status\n\nStatus: accepted\nApproved by: Ana (2026-11-24)\n\nText.\n"
        );
        // what conformance::adr_accepted reads afterwards
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("docs/architecture")).unwrap();
        std::fs::write(
            d.path().join("docs/architecture/ADR-0006-studio.md"),
            accept_adr_text(pt, "Ana", "2026-11-24"),
        )
        .unwrap();
        assert!(adr_accepted(d.path(), "ADR-0006"));
    }

    #[test]
    fn adr_ids_and_status_words() {
        assert_eq!(adr_id("ADR-0006-arch-studio.md"), "ADR-0006");
        assert_eq!(adr_id("0003-db.md"), "0003");
        assert_eq!(adr_id("adr_12.md"), "adr_12");
        assert_eq!(adr_id("notes.md"), "notes");
        assert_eq!(adr_status("# x\n- **Estado:** aceite (U4)\n"), "aceite");
        assert_eq!(adr_status("Status: Proposed\n"), "proposed");
        assert_eq!(adr_status("# no status\n"), "");
    }
}
