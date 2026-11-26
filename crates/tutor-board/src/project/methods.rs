//! What each board method changes in the rules (Board B): its defaults, which rules it turns on,
//! and how choosing it changes the project's settings without overwriting the user's own. Pure:
//! the store ([`super`]) applies it, the IDE previews it (`project_method_preview`).
//!
//! | rule                                   | kanban | scrum | xp | scrumxp |
//! |----------------------------------------|:------:|:-----:|:--:|:-------:|
//! | WIP limits (all forward moves)         |   ✓    |   ✓   | ✓  |    ✓    |
//! | DoR to leave To Do (moves)             |        |   ✓   | ✓  |    ✓    |
//! | sprint capacity (planning, estimates)  |        |   ✓   | ✓  |    ✓    |
//! | expedite may pass the WIP limit by one |   ✓    |       |    |         |
//! | test-first proof to reach Review       |        |       | ✓  |    ✓    |
//!
//! Every rule is overridable with a reason, recorded as an `override` in the issue's activity.

use std::collections::BTreeMap;

use serde::Serialize;

/// The states whose WIP limit the settings edit (the others have none).
pub const WIP_STATES: [&str; 3] = ["progress", "review", "accept"];

/// Is the method time-boxed (sprints with a capacity)?
pub fn uses_capacity(method: &str) -> bool {
    method != "kanban"
}

/// Does the method check the Definition of Ready when an issue leaves To Do?
pub fn checks_dor_on_move(method: &str) -> bool {
    method != "kanban"
}

/// Kanban's class of service «expedite» may pass a column's WIP limit — by one issue.
pub fn expedite_passes_wip(method: &str) -> bool {
    method == "kanban"
}

/// XP and Scrum + XP: Co-Dev's work reaches Review only with a test that failed first.
pub fn test_first(method: &str) -> bool {
    method == "xp" || method == "scrumxp"
}

/// The method's name for people and for the prompt.
pub fn label(method: &str) -> &'static str {
    match method {
        "scrum" => "Scrum",
        "xp" => "XP",
        "scrumxp" => "Scrum + XP",
        _ => "Kanban",
    }
}

/// The order a board lists cards in by class of service (Kanban): expedite first.
pub fn cos_rank(cos: &str) -> u8 {
    match cos {
        "expedite" => 0,
        "fixed" => 1,
        "standard" => 2,
        _ => 3,
    }
}

/// What a method starts a project with.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MethodDefaults {
    pub iter_days: u32,
    pub wip: BTreeMap<String, u32>,
    pub dor: Vec<String>,
    pub dod: Vec<String>,
}

fn wip(p: u32, r: u32, a: Option<u32>) -> BTreeMap<String, u32> {
    let mut m = BTreeMap::from([("progress".to_string(), p), ("review".to_string(), r)]);
    if let Some(a) = a {
        m.insert("accept".into(), a);
    }
    m
}

/// The DoR/DoD suggestions of a method, in Portuguese (`pt`) or English.
fn lists(method: &str, pt: bool) -> (Vec<&'static str>, Vec<&'static str>) {
    match (method, pt) {
        ("scrum", true) => (
            vec!["Estimada em pontos", "Cabe numa sprint"],
            vec![
                "Revisão de código feita",
                "Testes a passar",
                "Documentação actualizada",
            ],
        ),
        ("scrum", false) => (
            vec!["Estimated in points", "Fits in one sprint"],
            vec!["Code reviewed", "Tests passing", "Docs updated"],
        ),
        ("xp", true) => (
            vec!["Estimada pelo par", "Teste de aceitação escrito"],
            vec![
                "Testes escritos antes do código (TDD)",
                "Feito em par",
                "Integrado com os testes verdes",
            ],
        ),
        ("xp", false) => (
            vec!["Estimated by the pair", "Acceptance test written"],
            vec![
                "Tests written before the code (TDD)",
                "Done in a pair",
                "Integrated with the tests green",
            ],
        ),
        ("scrumxp", true) => (
            vec![
                "Estimada em pontos",
                "Cabe numa sprint",
                "Teste de aceitação escrito",
            ],
            vec![
                "Testes escritos antes do código (TDD)",
                "Revisto em par ou por outra pessoa",
                "Testes a passar",
                "Documentação actualizada",
            ],
        ),
        ("scrumxp", false) => (
            vec![
                "Estimated in points",
                "Fits in one sprint",
                "Acceptance test written",
            ],
            vec![
                "Tests written before the code (TDD)",
                "Reviewed in a pair or by someone else",
                "Tests passing",
                "Docs updated",
            ],
        ),
        (_, true) => (
            vec![],
            vec!["Critérios de aceitação verificados", "Testes a passar"],
        ),
        (_, false) => (
            vec![],
            vec!["Acceptance criteria verified", "Tests passing"],
        ),
    }
}

/// The defaults of `method` (`lang`: `pt` or anything else for English).
pub fn defaults(method: &str, lang: &str) -> MethodDefaults {
    let (dor, dod) = lists(method, lang == "pt");
    let (iter_days, w) = match method {
        "scrum" => (14, wip(3, 2, None)),
        "xp" => (7, wip(2, 2, None)),
        "scrumxp" => (14, wip(2, 2, None)),
        _ => (14, wip(3, 2, Some(2))),
    };
    MethodDefaults {
        iter_days,
        wip: w,
        dor: dor.into_iter().map(String::from).collect(),
        dod: dod.into_iter().map(String::from).collect(),
    }
}

/// The settings a method change looks at.
#[derive(Clone, Debug, PartialEq)]
pub struct Current {
    pub method: String,
    pub iter_days: u32,
    pub wip: BTreeMap<String, u32>,
    pub dor: Vec<String>,
    pub dod: Vec<String>,
}

/// One setting the change sets (`from` → `to`) or keeps (`from` is the user's, `to` the new
/// method's default that was NOT applied). `field`: `iter_days`, `wip.progress`, `wip.review`,
/// `wip.accept`, `dor`, `dod`; values are JSON (`null`: no WIP limit).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    pub field: String,
    pub from: serde_json::Value,
    pub to: serde_json::Value,
}

/// What choosing a method does to the settings: what changes, and what stays because the user set
/// it (it differs from the old method's default).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MethodChange {
    pub from: String,
    pub to: String,
    pub changes: Vec<FieldChange>,
    pub kept: Vec<FieldChange>,
}

/// A list that is still the old method's: empty, or exactly its suggestion (in either language).
fn untouched_list(
    cur: &[String],
    old_method: &str,
    pick: fn(&MethodDefaults) -> &Vec<String>,
) -> bool {
    cur.is_empty()
        || ["pt", "en"]
            .iter()
            .any(|l| pick(&defaults(old_method, l)).as_slice() == cur)
}

/// The change from `cur.method` to `to`. A setting is the user's own when it differs from the old
/// method's default (an empty DoR/DoD is never the user's): those stay, and are listed in `kept`.
/// The others take the new method's default. Choosing the same method changes nothing.
pub fn change(cur: &Current, to: &str, lang: &str) -> MethodChange {
    let mut out = MethodChange {
        from: cur.method.clone(),
        to: to.to_string(),
        changes: vec![],
        kept: vec![],
    };
    if cur.method == to {
        return out;
    }
    let old = defaults(&cur.method, lang);
    let new = defaults(to, lang);
    let mut push =
        |field: &str, from: serde_json::Value, to: serde_json::Value, untouched: bool| {
            if from == to {
                return;
            }
            let fc = FieldChange {
                field: field.into(),
                from,
                to,
            };
            if untouched {
                out.changes.push(fc);
            } else {
                out.kept.push(fc);
            }
        };
    push(
        "iter_days",
        cur.iter_days.into(),
        new.iter_days.into(),
        cur.iter_days == old.iter_days,
    );
    for s in WIP_STATES {
        let c = cur.wip.get(s).copied();
        push(
            &format!("wip.{s}"),
            serde_json::json!(c),
            serde_json::json!(new.wip.get(s)),
            c == old.wip.get(s).copied(),
        );
    }
    push(
        "dor",
        serde_json::json!(cur.dor),
        serde_json::json!(new.dor),
        untouched_list(&cur.dor, &cur.method, |d| &d.dor),
    );
    push(
        "dod",
        serde_json::json!(cur.dod),
        serde_json::json!(new.dod),
        untouched_list(&cur.dod, &cur.method, |d| &d.dod),
    );
    out
}

/// The settings after `change` (only `changes` are applied).
pub fn apply(cur: &Current, ch: &MethodChange) -> Current {
    let mut next = cur.clone();
    next.method = ch.to.clone();
    for c in &ch.changes {
        match c.field.as_str() {
            "iter_days" => next.iter_days = c.to.as_u64().unwrap_or(14) as u32,
            "dor" => next.dor = serde_json::from_value(c.to.clone()).unwrap_or_default(),
            "dod" => next.dod = serde_json::from_value(c.to.clone()).unwrap_or_default(),
            f => {
                if let Some(s) = f.strip_prefix("wip.") {
                    match c.to.as_u64() {
                        Some(n) => {
                            next.wip.insert(s.to_string(), n as u32);
                        }
                        None => {
                            next.wip.remove(s);
                        }
                    }
                }
            }
        }
    }
    next
}

/// Is `path` a test file by its place or its name? `tests/`, `test/`, `__tests__/`, `spec/`, `e2e/`
/// folders; `*_test.*`, `test_*.py`, `*.test.*`, `*.spec.*`, `*Test(s).{java,kt,cs,swift}`,
/// `*_spec.rb`. A test written inside a source file (Rust's `#[cfg(test)]`) is seen by its text,
/// [`has_test_marker`].
pub fn is_test_path(path: &str) -> bool {
    let p = path.replace('\\', "/");
    let segs: Vec<&str> = p.split('/').collect();
    let (dirs, name) = segs.split_at(segs.len().saturating_sub(1));
    if dirs.iter().any(|d| {
        matches!(
            *d,
            "tests" | "test" | "__tests__" | "spec" | "specs" | "e2e"
        )
    }) {
        return true;
    }
    let name = name.first().copied().unwrap_or("");
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let lower = stem.to_lowercase();
    lower.ends_with("_test")
        || lower.ends_with("_tests")
        || lower.ends_with("_spec")
        || (lower.starts_with("test_") && !ext.is_empty())
        || lower.ends_with(".test")
        || lower.ends_with(".spec")
        || (matches!(ext, "java" | "kt" | "cs" | "swift" | "scala")
            && (stem.ends_with("Test") || stem.ends_with("Tests")))
}

/// Does a change's new text add a test? The markers of the test frameworks the IDE runs.
pub fn has_test_marker(text: &str) -> bool {
    const MARKERS: [&str; 14] = [
        "#[test]",
        "#[tokio::test",
        "#[cfg(test)]",
        "@Test",
        "[Fact]",
        "[Test]",
        "[TestMethod]",
        "func Test",
        "def test_",
        "TEST(",
        "XCTestCase",
        "@testable",
        "it(\"",
        "test(\"",
    ];
    MARKERS.iter().any(|m| text.contains(m))
}

/// A change belongs to the tests when its file is a test file or its text adds a test.
pub fn is_test_change(path: &str, text: &str) -> bool {
    is_test_path(path) || has_test_marker(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cur(method: &str) -> Current {
        let d = defaults(method, "pt");
        Current {
            method: method.into(),
            iter_days: d.iter_days,
            wip: d.wip,
            dor: vec![],
            dod: vec![],
        }
    }

    #[test]
    fn each_method_turns_on_its_rules() {
        assert!(!uses_capacity("kanban") && uses_capacity("scrum") && uses_capacity("xp"));
        assert!(!checks_dor_on_move("kanban") && checks_dor_on_move("scrumxp"));
        assert!(expedite_passes_wip("kanban") && !expedite_passes_wip("scrum"));
        assert!(test_first("xp") && test_first("scrumxp") && !test_first("scrum"));
        assert!(!test_first("kanban"));
        assert_eq!(label("scrumxp"), "Scrum + XP");
        assert!(
            cos_rank("expedite") < cos_rank("fixed")
                && cos_rank("standard") < cos_rank("intangible")
        );
    }

    #[test]
    fn choosing_a_method_applies_its_defaults_where_the_user_set_nothing() {
        let ch = change(&cur("kanban"), "xp", "pt");
        let fields: Vec<&str> = ch.changes.iter().map(|c| c.field.as_str()).collect();
        assert_eq!(
            fields,
            ["iter_days", "wip.progress", "wip.accept", "dor", "dod"]
        );
        assert!(ch.kept.is_empty());
        let next = apply(&cur("kanban"), &ch);
        assert_eq!(next.method, "xp");
        assert_eq!(next.iter_days, 7);
        assert_eq!(next.wip, defaults("xp", "pt").wip);
        assert_eq!(next.wip.get("accept"), None, "XP has no accept limit");
        assert_eq!(next.dod[0], "Testes escritos antes do código (TDD)");
    }

    #[test]
    fn the_users_own_settings_are_kept_and_listed() {
        let mut c = cur("kanban");
        c.wip.insert("progress".into(), 5);
        c.iter_days = 10;
        c.dod = vec!["Deployed to staging".into()];
        let ch = change(&c, "scrum", "en");
        let kept: Vec<&str> = ch.kept.iter().map(|c| c.field.as_str()).collect();
        assert_eq!(kept, ["iter_days", "wip.progress", "dod"]);
        let next = apply(&c, &ch);
        assert_eq!(next.iter_days, 10);
        assert_eq!(next.wip.get("progress"), Some(&5));
        assert_eq!(next.dod, ["Deployed to staging"]);
        assert_eq!(next.dor, ["Estimated in points", "Fits in one sprint"]);
        // a list still equal to the old method's suggestion (any language) follows the new method
        let mut c = cur("scrum");
        c.dod = defaults("scrum", "en").dod;
        let ch = change(&c, "scrumxp", "pt");
        assert!(ch.changes.iter().any(|f| f.field == "dod"));
        // the same method: nothing
        assert_eq!(change(&c, "scrum", "pt").changes, vec![]);
    }

    #[test]
    fn a_removed_wip_limit_is_the_users_choice() {
        let mut c = cur("kanban");
        c.wip.remove("review");
        let ch = change(&c, "xp", "pt");
        assert!(ch
            .kept
            .iter()
            .any(|f| f.field == "wip.review" && f.from.is_null()));
        assert_eq!(apply(&c, &ch).wip.get("review"), None);
    }

    #[test]
    fn tests_are_seen_by_their_place_their_name_or_their_text() {
        for p in [
            "tests/api.rs",
            "src/test/java/a/OrderTest.java",
            "app/__tests__/x.ts",
            "pkg/orders_test.go",
            "test_orders.py",
            "web/cart.test.ts",
            "web/cart.spec.tsx",
            "Sources/CartTests.swift",
            "spec/cart_spec.rb",
            "ui-app/e2e/project.e2e.ts",
        ] {
            assert!(is_test_path(p), "{p}");
        }
        for p in [
            "src/lib.rs",
            "ui-app/src/features/testing/index.ts",
            "src/testing.rs",
            "contest.py",
            "README.md",
            "test",
        ] {
            assert!(!is_test_path(p), "{p}");
        }
        assert!(is_test_change(
            "src/lib.rs",
            "    #[test]\n    fn pages() {}"
        ));
        assert!(is_test_change("app/models.py", "def test_pages():"));
        assert!(!is_test_change("src/lib.rs", "pub fn pages() {}"));
    }
}
