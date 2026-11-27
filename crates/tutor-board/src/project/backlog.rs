//! The backlog Co-Dev drafts and the Project it creates from it (`/backlog` and `/project`).
//!
//! - **The draft** ([`Draft`]) lives in the project, in `.dxtutor/backlog.json`: epics and issues,
//!   each issue with its user story, Given/When/Then criteria, the files it changes or creates
//!   (`scope`) and the issues it depends on. [`validate`] says what is wrong with one, in words the
//!   model (or the person editing the file) can act on: a draft that passes gives issues that can be
//!   made Ready — nothing the Definition of Ready asks for is left out.
//! - **The plan** ([`Plan`]): the method, the iteration length, an optional DoR/DoD and the sprints
//!   in order, each with the refs of its issues. [`validate_plan`] checks it against the draft: every
//!   ref exists, an issue is in one sprint at most, no sprint goes over its capacity, and no issue is
//!   planned before (or without) an issue it depends on.
//! - [`ProjectStore::create_from_backlog`] creates it all in ONE transaction (settings, sprints,
//!   issues, stories, scopes, dependencies and — when the person asks — the Ready approval of the
//!   issues that meet the rest of the DoR). An issue whose title the project already has is not
//!   created again: its ref points to the existing issue.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::{
    capacity_rule, err, insert_issue, is_gwt, json, log, read_project, readiness, record_scope, Op,
    Project, ProjectError, ProjectStore, DOR_ITEM, KINDS, METHODS, PRIORITIES,
};

/// Where the draft lives, inside the project folder.
pub const DRAFT_PATH: &str = ".dxtutor/backlog.json";
pub const MAX_ISSUES: usize = 150;
pub const MAX_EPICS: usize = 30;
pub const MAX_SPRINTS: usize = 26;
pub const MAX_CRITERIA: usize = 10;
const MAX_TITLE: usize = 200;
const MAX_POINTS: u32 = 100;
const MAX_REF: usize = 32;
const MAX_PATH: usize = 300;
const DAY: i64 = 86_400_000;
/// The note of the `created` activity of an issue the backlog created.
pub const ORIGIN: &str = "backlog (/project)";
/// The readiness item that is the person's own approval.
const HUMAN_READY: &str = "aprovação humana (Ready)";

fn story() -> String {
    "story".into()
}
fn medium() -> String {
    "medium".into()
}

/// The backlog Co-Dev drafted (`backlog_propose`), as `.dxtutor/backlog.json` keeps it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub epics: Vec<Epic>,
    pub issues: Vec<DraftIssue>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Epic {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftIssue {
    /// The issue's id inside the draft (`B1`), used by `deps` and by the plan's sprints.
    #[serde(rename = "ref")]
    pub reference: String,
    pub title: String,
    #[serde(default = "story")]
    pub kind: String,
    #[serde(default = "medium")]
    pub priority: String,
    #[serde(default)]
    pub points: Option<u32>,
    /// The id of one of the draft's epics (empty: none).
    #[serde(default)]
    pub epic: String,
    #[serde(default)]
    pub story_as: String,
    #[serde(default)]
    pub story_want: String,
    #[serde(default)]
    pub story_so: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub acceptance: Vec<String>,
    /// The files and folders it changes or creates (relative; globs allowed).
    #[serde(default)]
    pub scope: Vec<String>,
    /// Refs of the issues that must be Done first.
    #[serde(default)]
    pub deps: Vec<String>,
    /// The Studio component it implements, when it came from a design.
    #[serde(default)]
    pub component: String,
}

/// How the Project is set up from the draft (`project_propose`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    /// `kanban | scrum | xp | scrumxp`; `None` keeps the project's.
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub iter_days: Option<u32>,
    #[serde(default)]
    pub key_prefix: Option<String>,
    #[serde(default)]
    pub dor: Option<Vec<String>>,
    #[serde(default)]
    pub dod: Option<Vec<String>>,
    /// In order; the issues of none stay in the product backlog.
    #[serde(default)]
    pub sprints: Vec<PlanSprint>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanSprint {
    pub name: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub capacity: Option<u32>,
    pub issues: Vec<String>,
}

/// What [`ProjectStore::create_from_backlog`] did.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub project: Project,
    /// `(ref, key)` of each issue created, in the draft's order.
    pub created: Vec<(String, String)>,
    /// `(ref, key)` of each issue the project already had (same title): not created again.
    pub existing: Vec<(String, String)>,
    /// The ids of the sprints created, in order.
    pub sprints: Vec<String>,
    /// The keys approved as Ready (only when asked for).
    pub ready: Vec<String>,
    /// The keys that could not be made Ready, with what they still lack.
    pub not_ready: Vec<NotReady>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotReady {
    pub key: String,
    pub missing: Vec<String>,
}

fn valid_ref(r: &str) -> bool {
    !r.is_empty()
        && r.len() <= MAX_REF
        && r.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A scope entry is a path or glob relative to the project, inside it.
pub fn safe_scope(s: &str) -> Result<(), String> {
    let t = s.trim();
    if t.is_empty() {
        return Err("an empty path".into());
    }
    if t.len() > MAX_PATH {
        return Err(format!("a path longer than {MAX_PATH} characters"));
    }
    if t.contains('\0') || t.contains('\\') {
        return Err(format!("«{t}»: use forward slashes, no control characters"));
    }
    if t.starts_with('/') || t.starts_with('~') || t.chars().nth(1) == Some(':') {
        return Err(format!("«{t}» is not relative to the project folder"));
    }
    if t.split('/').any(|seg| seg == "..") {
        return Err(format!("«{t}» leaves the project folder"));
    }
    Ok(())
}

/// What is wrong with a draft (empty: nothing). Each problem says where (`issues[2] (B3)`).
pub fn validate(d: &Draft) -> Vec<String> {
    let mut p = vec![];
    if d.title.trim().is_empty() {
        p.push("the backlog needs a `title`".to_string());
    }
    if d.issues.is_empty() {
        p.push("the backlog has no issues".to_string());
    }
    if d.issues.len() > MAX_ISSUES {
        p.push(format!(
            "{} issues is too many for one backlog (at most {MAX_ISSUES}): keep the first releases",
            d.issues.len()
        ));
    }
    if d.epics.len() > MAX_EPICS {
        p.push(format!("at most {MAX_EPICS} epics"));
    }
    let mut epics = HashSet::new();
    for (n, e) in d.epics.iter().enumerate() {
        let at = format!("epics[{n}]");
        if !valid_ref(e.id.trim()) {
            p.push(format!(
                "{at}: the `id` is 1–{MAX_REF} letters, digits, - or _"
            ));
        } else if !epics.insert(e.id.trim()) {
            p.push(format!("{at}: the id «{}» is repeated", e.id.trim()));
        }
        if e.title.trim().is_empty() {
            p.push(format!("{at}: the epic needs a `title`"));
        }
    }
    let refs: HashSet<&str> = d.issues.iter().map(|i| i.reference.trim()).collect();
    let mut seen = HashSet::new();
    for (n, i) in d.issues.iter().enumerate() {
        let r = i.reference.trim();
        let at = format!("issues[{n}] ({r})");
        if !valid_ref(r) {
            p.push(format!(
                "issues[{n}]: the `ref` is 1–{MAX_REF} letters, digits, - or _"
            ));
        } else if !seen.insert(r) {
            p.push(format!("{at}: the ref is repeated"));
        }
        if i.title.trim().is_empty() {
            p.push(format!("{at}: the issue needs a `title`"));
        } else if i.title.chars().count() > MAX_TITLE {
            p.push(format!(
                "{at}: the title is longer than {MAX_TITLE} characters"
            ));
        }
        if !KINDS.contains(&i.kind.as_str()) {
            p.push(format!(
                "{at}: unknown kind «{}» ({})",
                i.kind,
                KINDS.join(", ")
            ));
        }
        if !PRIORITIES.contains(&i.priority.as_str()) {
            p.push(format!(
                "{at}: unknown priority «{}» ({})",
                i.priority,
                PRIORITIES.join(", ")
            ));
        }
        if i.points.is_some_and(|v| v > MAX_POINTS) {
            p.push(format!("{at}: at most {MAX_POINTS} points (split it)"));
        }
        if !i.epic.trim().is_empty() && !epics.contains(i.epic.trim()) {
            p.push(format!(
                "{at}: the epic «{}» is not in `epics`",
                i.epic.trim()
            ));
        }
        if i.kind == "story"
            && [&i.story_as, &i.story_want, &i.story_so]
                .iter()
                .any(|s| s.trim().is_empty())
        {
            p.push(format!(
                "{at}: a story needs `storyAs`, `storyWant` and `storySo`"
            ));
        }
        let criteria: Vec<&String> = i
            .acceptance
            .iter()
            .filter(|c| !c.trim().is_empty())
            .collect();
        if criteria.is_empty() {
            p.push(format!("{at}: at least one acceptance criterion"));
        } else if criteria.len() > MAX_CRITERIA {
            p.push(format!("{at}: at most {MAX_CRITERIA} acceptance criteria"));
        }
        for c in criteria {
            if !is_gwt(c) {
                p.push(format!(
                    "{at}: the criterion «{}» is not in Given/When/Then (Dado/Quando/Então)",
                    c.trim()
                ));
            }
        }
        if i.scope.iter().all(|s| s.trim().is_empty()) {
            p.push(format!(
                "{at}: the `scope` names the files or folders it changes or creates"
            ));
        }
        for s in i.scope.iter().filter(|s| !s.trim().is_empty()) {
            if let Err(e) = safe_scope(s) {
                p.push(format!("{at}: scope {e}"));
            }
        }
        let mut deps = HashSet::new();
        for dep in &i.deps {
            let dep = dep.trim();
            if dep == r {
                p.push(format!("{at}: an issue does not depend on itself"));
            } else if !refs.contains(dep) {
                p.push(format!(
                    "{at}: the dependency «{dep}» is not an issue of the backlog"
                ));
            } else if !deps.insert(dep) {
                p.push(format!("{at}: the dependency «{dep}» is repeated"));
            }
        }
    }
    if let Some(cycle) = cycle(d) {
        p.push(format!(
            "the dependencies go round in a circle: {}",
            cycle.join(" → ")
        ));
    }
    p
}

/// A dependency cycle, if there is one (the refs, the first repeated at the end).
fn cycle(d: &Draft) -> Option<Vec<String>> {
    let deps: HashMap<&str, Vec<&str>> = d
        .issues
        .iter()
        .map(|i| {
            (
                i.reference.trim(),
                i.deps.iter().map(|x| x.trim()).collect(),
            )
        })
        .collect();
    // 0 = not seen, 1 = on the path, 2 = done
    let mut mark: HashMap<&str, u8> = HashMap::new();
    fn visit<'a>(
        n: &'a str,
        deps: &HashMap<&'a str, Vec<&'a str>>,
        mark: &mut HashMap<&'a str, u8>,
        path: &mut Vec<&'a str>,
    ) -> Option<Vec<String>> {
        match mark.get(n).copied().unwrap_or(0) {
            2 => return None,
            1 => {
                let from = path.iter().position(|x| *x == n).unwrap_or(0);
                let mut c: Vec<String> = path[from..].iter().map(|s| s.to_string()).collect();
                c.push(n.to_string());
                return Some(c);
            }
            _ => {}
        }
        mark.insert(n, 1);
        path.push(n);
        for m in deps.get(n).into_iter().flatten() {
            if deps.contains_key(m) {
                if let Some(c) = visit(m, deps, mark, path) {
                    return Some(c);
                }
            }
        }
        path.pop();
        mark.insert(n, 2);
        None
    }
    for i in &d.issues {
        let mut path = vec![];
        if let Some(c) = visit(i.reference.trim(), &deps, &mut mark, &mut path) {
            return Some(c);
        }
    }
    None
}

/// What is wrong with a plan for this draft (empty: nothing).
pub fn validate_plan(d: &Draft, plan: &Plan) -> Vec<String> {
    let mut p = vec![];
    if let Some(m) = &plan.method {
        if !METHODS.contains(&m.as_str()) {
            p.push(format!("unknown method «{m}» ({})", METHODS.join(", ")));
        }
        if m == "kanban" && !plan.sprints.is_empty() {
            p.push(
                "Kanban has no sprints: leave `sprints` empty (the issues go to the backlog)"
                    .into(),
            );
        }
    }
    if plan.iter_days.is_some_and(|n| n == 0 || n > 60) {
        p.push("`iterDays` is 1 to 60 days".into());
    }
    if let Some(k) = &plan.key_prefix {
        let k = k.trim();
        if k.is_empty() || k.len() > 8 || !k.chars().all(|c| c.is_ascii_alphanumeric()) {
            p.push("`keyPrefix` is 1 to 8 letters or digits".into());
        }
    }
    if plan.sprints.len() > MAX_SPRINTS {
        p.push(format!("at most {MAX_SPRINTS} sprints"));
    }
    let issues: HashMap<&str, &DraftIssue> =
        d.issues.iter().map(|i| (i.reference.trim(), i)).collect();
    // the sprint each ref is in (its position)
    let mut at: HashMap<&str, usize> = HashMap::new();
    for (n, s) in plan.sprints.iter().enumerate() {
        let name = s.name.trim();
        let here = format!("sprints[{n}] ({name})");
        if name.is_empty() {
            p.push(format!("sprints[{n}]: the sprint needs a `name`"));
        }
        let mut points = 0u32;
        for r in &s.issues {
            let r = r.trim();
            match issues.get(r) {
                None => p.push(format!("{here}: «{r}» is not an issue of the backlog")),
                Some(i) => {
                    if let Some(prev) = at.insert(r, n) {
                        p.push(format!(
                            "{here}: «{r}» is already in sprints[{prev}]: an issue goes in one sprint"
                        ));
                    }
                    points += i.points.unwrap_or(0);
                }
            }
        }
        if let Some(cap) = s.capacity {
            if points > cap {
                p.push(format!(
                    "{here}: {points} points is over its capacity of {cap}: move issues to a later sprint"
                ));
            }
        }
    }
    // nothing is planned before (or without) what it depends on
    for (r, n) in &at {
        let Some(i) = issues.get(r) else { continue };
        for dep in &i.deps {
            let dep = dep.trim();
            match at.get(dep) {
                None if issues.contains_key(dep) => p.push(format!(
                    "«{r}» is in sprints[{n}] but its dependency «{dep}» is in no sprint"
                )),
                Some(m) if m > n => p.push(format!(
                    "«{r}» is in sprints[{n}] but its dependency «{dep}» is planned later (sprints[{m}])"
                )),
                _ => {}
            }
        }
    }
    p.sort();
    p
}

/// The description an issue is created with: the draft's, and the Studio component it implements.
fn description_of(i: &DraftIssue, lang: &str) -> String {
    let c = i.component.trim();
    let d = i.description.trim();
    if c.is_empty() {
        return d.to_string();
    }
    let line = if lang == "pt" {
        format!("Componente do Studio: {c}")
    } else {
        format!("Studio component: {c}")
    };
    if d.is_empty() {
        line
    } else {
        format!("{d}\n\n{line}")
    }
}

fn clean(v: &[String]) -> Vec<String> {
    v.iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

impl ProjectStore {
    /// Creates the Project of `root` from a draft and a plan, in one transaction: the settings
    /// (method, iteration, key prefix, DoR, DoD), the sprints after the last existing one, the
    /// issues (story, criteria, scope, dependencies, epic, sprint) and, with `ready`, the Ready
    /// approval of each issue that lacks nothing else (its project DoR items ticked). Who acts
    /// and when are the caller's. A draft or plan with problems creates nothing.
    #[allow(clippy::too_many_arguments)]
    pub fn create_from_backlog(
        &mut self,
        root: &str,
        actor: &str,
        now: i64,
        draft: &Draft,
        plan: &Plan,
        lang: &str,
        ready: bool,
    ) -> Result<Created, ProjectError> {
        let mut problems = validate(draft);
        problems.extend(validate_plan(draft, plan));
        if !problems.is_empty() {
            return Err(err("invalid", problems.join("; ")));
        }
        let tx = self.conn.transaction()?;
        Self::ensure(&tx, root, now)?;
        if plan.method.is_some()
            || plan.iter_days.is_some()
            || plan.key_prefix.is_some()
            || plan.dor.is_some()
            || plan.dod.is_some()
        {
            super::apply_op(
                &tx,
                root,
                actor,
                now,
                Op::Settings {
                    method: plan.method.clone(),
                    iter_days: plan.iter_days,
                    wip: None,
                    dor: plan.dor.as_deref().map(clean),
                    dod: plan.dod.as_deref().map(clean),
                    key_prefix: plan.key_prefix.clone(),
                    lang: Some(lang.to_string()),
                    checks: None,
                },
            )?;
        }
        let before = read_project(&tx, root)?;
        let sprints = create_sprints(&tx, root, actor, now, &before, plan)?;
        let sprint_of: HashMap<&str, &str> = plan
            .sprints
            .iter()
            .zip(&sprints)
            .flat_map(|(s, id)| s.issues.iter().map(move |r| (r.trim(), id.as_str())))
            .collect();
        let existing: HashMap<String, String> = before
            .issues
            .iter()
            .map(|i| (i.title.trim().to_lowercase(), i.key.clone()))
            .collect();
        let epic_title: HashMap<&str, &str> = draft
            .epics
            .iter()
            .map(|e| (e.id.trim(), e.title.trim()))
            .collect();
        let mut keys: HashMap<&str, String> = HashMap::new();
        let mut created = vec![];
        let mut kept = vec![];
        for i in &draft.issues {
            let r = i.reference.trim();
            if let Some(k) = existing.get(&i.title.trim().to_lowercase()) {
                keys.insert(r, k.clone());
                kept.push((r.to_string(), k.clone()));
                continue;
            }
            let sprint = sprint_of.get(r).copied();
            if let Some(s) = sprint {
                if let Some(e) = capacity_rule(&tx, root, s, "", 0, i.points)? {
                    return Err(e);
                }
            }
            let key = insert_issue(
                &tx,
                root,
                actor,
                now,
                &i.title,
                &i.kind,
                &i.priority,
                i.points,
                epic_title.get(i.epic.trim()).copied().unwrap_or(""),
                &description_of(i, lang),
                &clean(&i.acceptance),
                sprint,
                ORIGIN,
            )?;
            if let Some(s) = sprint {
                record_scope(&tx, root, s, &key, now, "added", i.points, "created", actor)?;
            }
            keys.insert(r, key.clone());
            created.push((r.to_string(), key));
        }
        // the story, the scope and the dependencies (the keys of the others are known now)
        for i in &draft.issues {
            let r = i.reference.trim();
            if !created.iter().any(|(c, _)| c == r) {
                continue;
            }
            let deps: Vec<&String> = i.deps.iter().filter_map(|d| keys.get(d.trim())).collect();
            tx.execute(
                "UPDATE issues SET story_as = ?3, story_want = ?4, story_so = ?5, scope = ?6, deps = ?7, updated = ?8 WHERE root = ?1 AND key = ?2",
                params![
                    root,
                    keys[r],
                    i.story_as.trim(),
                    i.story_want.trim(),
                    i.story_so.trim(),
                    json(&clean(&i.scope)),
                    json(&deps),
                    now
                ],
            )?;
        }
        let (mut made_ready, mut not_ready) = (vec![], vec![]);
        if ready {
            let p = read_project(&tx, root)?;
            let states: HashMap<String, String> = p
                .issues
                .iter()
                .map(|i| (i.key.clone(), i.state.clone()))
                .collect();
            for (_, key) in &created {
                let Some(i) = p.issues.iter().find(|i| &i.key == key) else {
                    continue;
                };
                // the person's approval covers the project's own DoR items too
                let missing: Vec<String> = readiness(i, &states, &p.dor)
                    .into_iter()
                    .filter(|m| m != HUMAN_READY && !m.starts_with(DOR_ITEM))
                    .collect();
                if missing.is_empty() {
                    mark_ready(&tx, root, key, actor, now, p.dor.len())?;
                    made_ready.push(key.clone());
                } else {
                    not_ready.push(NotReady {
                        key: key.clone(),
                        missing,
                    });
                }
            }
        }
        tx.commit()?;
        Ok(Created {
            project: read_project(&self.conn, root)?,
            created,
            existing: kept,
            sprints,
            ready: made_ready,
            not_ready,
        })
    }
}

/// The plan's sprints, one after the other, from the end of the last sprint the project has (or now).
fn create_sprints(
    c: &Connection,
    root: &str,
    actor: &str,
    now: i64,
    before: &Project,
    plan: &Plan,
) -> Result<Vec<String>, ProjectError> {
    let days = i64::from(before.iter_days.max(1));
    let mut start = before
        .sprints
        .iter()
        .map(|s| s.end + 1)
        .max()
        .unwrap_or(now)
        .max(now);
    let mut ids = vec![];
    for s in &plan.sprints {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM sprints WHERE root = ?1",
            params![root],
            |r| r.get(0),
        )?;
        let end = start + days * DAY - 1;
        super::apply_op(
            c,
            root,
            actor,
            now,
            Op::CreateSprint {
                name: s.name.trim().to_string(),
                goal: s.goal.trim().to_string(),
                start,
                end,
                capacity: s.capacity,
            },
        )?;
        ids.push(format!("S{}", n + 1));
        start = end + 1;
    }
    Ok(ids)
}

fn mark_ready(
    c: &Connection,
    root: &str,
    key: &str,
    actor: &str,
    now: i64,
    dor_items: usize,
) -> Result<(), ProjectError> {
    c.execute(
        "UPDATE issues SET ready = 1, ready_by = ?3, dor_done = ?4, updated = ?5 WHERE root = ?1 AND key = ?2",
        params![root, key, actor, json(&vec![true; dor_items]), now],
    )?;
    log(
        c,
        root,
        key,
        now,
        actor,
        "edited",
        None,
        None,
        "pronta (DoR) — aprovada ao criar o Project a partir do backlog",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn issue(r: &str, title: &str) -> DraftIssue {
        DraftIssue {
            reference: r.into(),
            title: title.into(),
            kind: "story".into(),
            priority: "medium".into(),
            points: Some(3),
            epic: "E1".into(),
            story_as: "a customer".into(),
            story_want: "to place an order".into(),
            story_so: "I get my goods".into(),
            description: String::new(),
            acceptance: vec!["Given a cart, when I pay, then the order is saved".into()],
            scope: vec!["src/orders/**".into()],
            deps: vec![],
            component: String::new(),
        }
    }

    fn draft() -> Draft {
        let mut b = issue("B2", "List orders");
        b.deps = vec!["B1".into()];
        Draft {
            title: "Shop".into(),
            summary: String::new(),
            epics: vec![Epic {
                id: "E1".into(),
                title: "Orders".into(),
                description: String::new(),
            }],
            issues: vec![issue("B1", "Place an order"), b],
        }
    }

    #[test]
    fn a_good_draft_has_no_problems_and_parses_from_the_tool_json() {
        assert_eq!(validate(&draft()), Vec::<String>::new());
        let d: Draft = serde_json::from_value(json!({
            "title": "Shop",
            "epics": [{"id": "E1", "title": "Orders"}],
            "issues": [{
                "ref": "B1", "title": "Place an order", "points": 3, "epic": "E1",
                "storyAs": "a customer", "storyWant": "to order", "storySo": "I get goods",
                "acceptance": ["Dado um carrinho, quando pago, então a encomenda fica gravada"],
                "scope": ["src/orders/new.rs"]
            }]
        }))
        .unwrap();
        assert_eq!(validate(&d), Vec::<String>::new());
        assert_eq!(d.issues[0].kind, "story");
        assert!(
            serde_json::from_value::<Draft>(json!({"title": "x", "issues": [], "extra": 1}))
                .is_err()
        );
    }

    #[test]
    fn the_problems_of_a_draft_name_the_issue_and_the_rule() {
        let mut d = draft();
        d.issues[0].acceptance = vec!["works".into()];
        d.issues[0].scope = vec!["../etc/passwd".into()];
        d.issues[1].deps = vec!["B9".into()];
        d.issues[1].story_so = " ".into();
        d.issues[1].kind = "epic".into();
        let p = validate(&d).join("\n");
        assert!(
            p.contains("issues[0] (B1): the criterion «works» is not in Given/When/Then"),
            "{p}"
        );
        assert!(
            p.contains("issues[0] (B1): scope «../etc/passwd» leaves the project folder"),
            "{p}"
        );
        assert!(
            p.contains("issues[1] (B2): the dependency «B9» is not an issue"),
            "{p}"
        );
        assert!(p.contains("issues[1] (B2): unknown kind «epic»"), "{p}");
        let mut d = draft();
        d.issues[1].scope = vec![];
        d.issues[0].reference = "B2".into();
        let p = validate(&d).join("\n");
        assert!(p.contains("the `scope` names the files"), "{p}");
        assert!(p.contains("the ref is repeated"), "{p}");
        for bad in ["/etc", "C:/x", "~/x", "a\\b", ""] {
            assert!(safe_scope(bad).is_err(), "{bad}");
        }
        assert!(safe_scope("apps/web/src/*.tsx").is_ok());
    }

    #[test]
    fn a_dependency_cycle_is_found() {
        let mut d = draft();
        d.issues[0].deps = vec!["B2".into()];
        let p = validate(&d).join("\n");
        assert!(p.contains("go round in a circle: B1 → B2 → B1"), "{p}");
    }

    #[test]
    fn a_plan_keeps_dependencies_first_and_capacity() {
        let d = draft();
        let ok = Plan {
            method: Some("scrum".into()),
            iter_days: Some(14),
            sprints: vec![
                PlanSprint {
                    name: "S1".into(),
                    issues: vec!["B1".into()],
                    capacity: Some(3),
                    ..Default::default()
                },
                PlanSprint {
                    name: "S2".into(),
                    issues: vec!["B2".into()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert_eq!(validate_plan(&d, &ok), Vec::<String>::new());
        let bad = Plan {
            method: Some("scrum".into()),
            sprints: vec![
                PlanSprint {
                    name: "S1".into(),
                    issues: vec!["B2".into(), "B1".into(), "B1".into()],
                    capacity: Some(4),
                    ..Default::default()
                },
                PlanSprint {
                    name: "".into(),
                    issues: vec!["B7".into()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let p = validate_plan(&d, &bad).join("\n");
        assert!(p.contains("«B1» is already in sprints[0]"), "{p}");
        assert!(p.contains("9 points is over its capacity of 4"), "{p}");
        assert!(p.contains("«B7» is not an issue"), "{p}");
        assert!(p.contains("sprints[1]: the sprint needs a `name`"), "{p}");
        let later = Plan {
            sprints: vec![PlanSprint {
                name: "S1".into(),
                issues: vec!["B2".into()],
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(validate_plan(&d, &later)
            .join("\n")
            .contains("its dependency «B1» is in no sprint"));
        let kanban = Plan {
            method: Some("kanban".into()),
            ..later
        };
        assert!(validate_plan(&d, &kanban)
            .join("\n")
            .contains("Kanban has no sprints"));
    }

    #[test]
    fn the_project_is_created_in_one_go_and_only_once() {
        let mut s = ProjectStore::in_memory().unwrap();
        let plan = Plan {
            method: Some("scrum".into()),
            iter_days: Some(7),
            key_prefix: Some("SHOP".into()),
            sprints: vec![
                PlanSprint {
                    name: "Sprint 1".into(),
                    goal: "Order".into(),
                    issues: vec!["B1".into()],
                    capacity: Some(5),
                },
                PlanSprint {
                    name: "Sprint 2".into(),
                    goal: "List".into(),
                    issues: vec!["B2".into()],
                    capacity: None,
                },
            ],
            ..Default::default()
        };
        let now = 1_700_000_000_000;
        let c = s
            .create_from_backlog("/w", "ana", now, &draft(), &plan, "en", true)
            .unwrap();
        assert_eq!(
            c.created,
            vec![
                ("B1".into(), "SHOP-1".into()),
                ("B2".into(), "SHOP-2".into())
            ]
        );
        assert_eq!(c.sprints, vec!["S1", "S2"]);
        let p = &c.project;
        assert_eq!((p.method.as_str(), p.iter_days), ("scrum", 7));
        let s1 = &p.sprints[0];
        let s2 = &p.sprints[1];
        assert_eq!((s1.start, s1.end + 1), (now, now + 7 * DAY));
        assert_eq!(s2.start, s1.end + 1);
        let b1 = p.issues.iter().find(|i| i.key == "SHOP-1").unwrap();
        let b2 = p.issues.iter().find(|i| i.key == "SHOP-2").unwrap();
        assert_eq!(b1.sprint.as_deref(), Some("S1"));
        assert_eq!(b1.epic, "Orders");
        assert_eq!(b1.scope, vec!["src/orders/**"]);
        assert_eq!(b1.story_want, "to place an order");
        assert_eq!(b2.deps, vec!["SHOP-1"]);
        // B1 lacks nothing else: Ready (the method's DoR ticked by the approval); B2 waits for B1
        assert!(b1.ready && b1.missing.is_empty(), "{:?}", b1.missing);
        assert_eq!(c.ready, vec!["SHOP-1"]);
        assert_eq!(c.not_ready.len(), 1);
        assert!(
            c.not_ready[0].missing.iter().any(|m| m.contains("SHOP-1")),
            "{:?}",
            c.not_ready
        );
        // again: nothing is created twice, and a new sprint starts after the last one
        let again = Plan {
            sprints: vec![PlanSprint {
                name: "Sprint 3".into(),
                issues: vec![],
                ..Default::default()
            }],
            ..Default::default()
        };
        let c2 = s
            .create_from_backlog("/w", "ana", now + 1, &draft(), &again, "en", false)
            .unwrap();
        assert!(c2.created.is_empty());
        assert_eq!(c2.existing.len(), 2);
        assert_eq!(c2.project.issues.len(), 2);
        assert_eq!(c2.project.sprints[2].start, s2.end + 1);
    }

    #[test]
    fn a_bad_plan_creates_nothing() {
        let mut s = ProjectStore::in_memory().unwrap();
        let plan = Plan {
            sprints: vec![PlanSprint {
                name: "S".into(),
                issues: vec!["B2".into()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let e = s
            .create_from_backlog("/w", "ana", 1, &draft(), &plan, "en", false)
            .unwrap_err();
        assert_eq!(e.code, "invalid");
        assert!(s.load("/w", 2).unwrap().issues.is_empty());
    }

    #[test]
    fn the_component_goes_into_the_description() {
        let mut i = issue("B1", "x");
        i.component = "orders-api".into();
        i.description = "Build it.".into();
        assert_eq!(
            description_of(&i, "pt"),
            "Build it.\n\nComponente do Studio: orders-api"
        );
        i.description.clear();
        assert_eq!(description_of(&i, "en"), "Studio component: orders-api");
    }
}
