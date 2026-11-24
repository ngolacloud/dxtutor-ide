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
use serde::Deserialize;

use crate::permissions::scope_matches;

pub const RULES_FILE: &str = ".dxtutor/architecture.toml";

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Layer {
    pub name: String,
    #[serde(default)]
    pub paths: Vec<String>,
    /// The other layers this one may import. `None`: unrestricted.
    #[serde(default)]
    pub may_use: Option<Vec<String>>,
    /// How an import into this layer looks (substrings); by default a path or module segment
    /// equal to the layer's name (`../domain/x`, `crate::domain::x`, `app.domain`).
    #[serde(default)]
    pub imports: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Libraries {
    #[serde(default)]
    pub forbidden: Vec<String>,
    #[serde(default)]
    pub approved: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Naming {
    pub paths: Vec<String>,
    pub pattern: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Exception {
    pub adr: String,
    /// `library:<name>`, `layer:<from>-><to>` or `naming:<path>`.
    pub rule: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
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
}
