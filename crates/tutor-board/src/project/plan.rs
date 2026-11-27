//! The parallel sprint plan (Multi Co-Dev, phase 1): how the sprint's issues would be shared out
//! among N Co-Devs working at the same time, so that two of them never change the same files.
//! Read-only: nothing runs, nothing is written — the plan is computed each time from the store.
//!
//! - Each Co-Dev is a **lane**; each lane takes one issue at a time.
//! - The issues run in **waves**: an issue starts only after its dependencies are done (an earlier
//!   wave, or Done already), and two issues that **overlap** never share a wave — the second is
//!   serialised into a later one. Within a wave, the issues go to the lanes with fewer points.
//! - Two issues overlap when one file can be changed by both: a file of the project (or one known
//!   to be touched — change sets, linked commits, the issue's branch) matched by a scope glob of
//!   each, or known to be touched by each. A literal scope entry (`src/new.rs`) counts as a file,
//!   so a file that does not exist yet still collides with `src/**`. Two wildcard globs that only
//!   meet on files that do not exist yet (`src/*.rs` and `src/a*`) are not detected.
//! - What does not go in has a reason: not Ready (its dependencies apart), already in the flow,
//!   blocked by a dependency that is neither Done nor planned, a dependency cycle, or an overlap
//!   with an issue already in the flow (it waits for that one to finish).
//!
//! Deterministic: the same input gives the same plan (priority, then rank, then key).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

/// The most Co-Devs a sprint may have (phase 1; each one is an agent session at the same time).
pub const MAX_CODEVS: u32 = 8;
/// The overlapping paths listed per pair (the total is always given).
const MAX_PATHS: usize = 20;
/// The glob pairs listed per overlap.
const MAX_GLOBS: usize = 10;

/// One issue of the sprint, as the planner sees it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanIssue {
    pub key: String,
    pub title: String,
    pub points: Option<u32>,
    /// `high | medium | low`.
    pub priority: String,
    pub rank: f64,
    /// One of the five canonical states.
    pub state: String,
    pub scope: Vec<String>,
    pub deps: Vec<String>,
    /// What the issue lacks to be Ready, its dependencies apart (they become waves).
    pub missing: Vec<String>,
    /// Files known to be touched by the issue: its change sets, its linked commits, its branch.
    pub known_files: Vec<String>,
    /// Files where merging the issue's branch into HEAD would conflict (`predict_conflicts`).
    pub branch_conflicts: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedIssue {
    pub key: String,
    pub title: String,
    pub points: Option<u32>,
    pub priority: String,
    /// 1-based: the issue starts when every issue of the previous waves is done.
    pub wave: u32,
    /// Its dependencies planned in earlier waves.
    pub after: Vec<String>,
    /// Issues it overlaps with that took the earlier wave it could have run in.
    pub serialised_after: Vec<String>,
    /// Files where its branch would conflict with HEAD.
    pub branch_conflicts: Vec<String>,
}

/// One Co-Dev's issues, in order.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    /// 1-based: «Co-Dev 1».
    pub codev: u32,
    /// The sum of the estimated points of its issues.
    pub points: u32,
    /// Its issues without an estimate.
    pub unestimated: u32,
    pub issues: Vec<PlannedIssue>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeftOut {
    pub key: String,
    pub title: String,
    /// `not_ready | in_flow | blocked_by_deps | dep_cycle | overlaps_in_flow`.
    pub reason: String,
    /// What it lacks to be Ready (`not_ready`).
    pub missing: Vec<String>,
    /// The issues behind the reason: the dependencies (`blocked_by_deps`, `dep_cycle`), the
    /// issue in the flow it overlaps with (`overlaps_in_flow`); the state for `in_flow`.
    pub keys: Vec<String>,
}

/// Two issues that may change the same files.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overlap {
    pub a: String,
    pub b: String,
    /// The first overlapping paths, sorted.
    pub paths: Vec<String>,
    /// How many paths overlap in all.
    pub total: u32,
    /// The pairs of scope entries that meet (`known` for a known file): `[of a, of b]`.
    pub globs: Vec<[String; 2]>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SprintPlan {
    pub sprint: Option<String>,
    pub codevs: u32,
    pub lanes: Vec<Lane>,
    pub waves: u32,
    pub left_out: Vec<LeftOut>,
    pub overlaps: Vec<Overlap>,
    /// How many project files the overlaps were checked against.
    pub files: u32,
}

// ───── scope globs ─────

/// Normalises a scope entry or a path: trimmed, `/` separators, no leading `./`.
fn norm(s: &str) -> String {
    s.trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string()
}

fn is_glob(p: &str) -> bool {
    p.contains(['*', '?'])
}

/// Does the scope entry `pat` cover `path` (both relative to the project)? The same rules as the
/// Co-Dev permissions (`tutor_agent::permissions::scope_matches`): a folder (`src/`, `src/**`, or
/// a literal that is a folder) covers everything under it; `**/` is zero or more folders, `**`
/// anything, `*` anything but `/`, `?` one character but `/`.
pub fn scope_matches(pat: &str, path: &str) -> bool {
    let pat = norm(pat);
    let path = norm(path);
    if pat.is_empty() {
        return false;
    }
    if let Some(dir) = pat.strip_suffix("/**").or_else(|| pat.strip_suffix('/')) {
        if !is_glob(dir) {
            return path == dir || path.starts_with(&format!("{dir}/"));
        }
    }
    if !is_glob(&pat) {
        return path == pat || path.starts_with(&format!("{}/", pat.trim_end_matches('/')));
    }
    glob_match(&pat, &path)
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Tok {
    Lit(char),
    /// `*`: anything but `/`
    Star,
    /// `?`: one character but `/`
    One,
    /// `**/`: zero or more whole folders
    Dirs,
    /// `**`: anything
    Any,
}

fn tokens(pat: &str) -> Vec<Tok> {
    let mut out = vec![];
    let mut it = pat.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '*' if it.peek() == Some(&'*') => {
                it.next();
                if it.peek() == Some(&'/') {
                    it.next();
                    out.push(Tok::Dirs);
                } else {
                    out.push(Tok::Any);
                }
            }
            '*' => out.push(Tok::Star),
            '?' => out.push(Tok::One),
            c => out.push(Tok::Lit(c)),
        }
    }
    out
}

/// The whole of `path` against the glob (dynamic programming: no backtracking blow-up).
fn glob_match(pat: &str, path: &str) -> bool {
    let t = tokens(pat);
    let s: Vec<char> = path.chars().collect();
    // m[j]: the first i tokens match the first j characters
    let mut m = vec![false; s.len() + 1];
    m[0] = true;
    for tok in &t {
        let mut n = vec![false; s.len() + 1];
        match tok {
            Tok::Lit(c) => {
                for j in 1..=s.len() {
                    n[j] = m[j - 1] && s[j - 1] == *c;
                }
            }
            Tok::One => {
                for j in 1..=s.len() {
                    n[j] = m[j - 1] && s[j - 1] != '/';
                }
            }
            Tok::Star => {
                for j in 0..=s.len() {
                    n[j] = m[j] || (j > 0 && n[j - 1] && s[j - 1] != '/');
                }
            }
            Tok::Any => {
                for j in 0..=s.len() {
                    n[j] = m[j] || (j > 0 && n[j - 1]);
                }
            }
            Tok::Dirs => {
                // zero folders, or anything that ends in `/`
                let mut seen = false;
                for j in 0..=s.len() {
                    if j > 0 && m[j - 1] {
                        seen = true;
                    }
                    n[j] = m[j] || (seen && j > 0 && s[j - 1] == '/');
                }
            }
        }
        m = n;
    }
    m[s.len()]
}

// ───── the plan ─────

const PRIORITY_ORDER: [&str; 3] = ["high", "medium", "low"];

fn priority_idx(p: &str) -> usize {
    PRIORITY_ORDER
        .iter()
        .position(|x| *x == p)
        .unwrap_or(PRIORITY_ORDER.len())
}

/// For each issue (by index), the paths it may touch → the scope entry that covers it.
fn touched(issues: &[&PlanIssue], files: &[String]) -> Vec<BTreeMap<String, String>> {
    let mut cands: BTreeSet<String> = files.iter().map(|f| norm(f)).collect();
    for i in issues {
        cands.extend(i.known_files.iter().map(|f| norm(f)));
        cands.extend(i.branch_conflicts.iter().map(|f| norm(f)));
        for s in &i.scope {
            let s = norm(s);
            if !s.is_empty() && !is_glob(&s) {
                cands.insert(s.trim_end_matches('/').to_string());
            }
        }
    }
    cands.remove("");
    issues
        .iter()
        .map(|i| {
            let mut t = BTreeMap::new();
            let scope: Vec<String> = i
                .scope
                .iter()
                .map(|s| norm(s))
                .filter(|s| !s.is_empty())
                .collect();
            for c in &cands {
                if let Some(g) = scope.iter().find(|g| scope_matches(g, c)) {
                    t.insert(c.clone(), g.clone());
                }
            }
            for f in i.known_files.iter().chain(&i.branch_conflicts) {
                let f = norm(f);
                if !f.is_empty() {
                    t.entry(f).or_insert_with(|| "known".to_string());
                }
            }
            t
        })
        .collect()
}

fn overlap_of(
    a: &PlanIssue,
    ta: &BTreeMap<String, String>,
    b: &PlanIssue,
    tb: &BTreeMap<String, String>,
) -> Option<Overlap> {
    let mut paths = vec![];
    let mut globs: Vec<[String; 2]> = vec![];
    for (p, ga) in ta {
        if let Some(gb) = tb.get(p) {
            paths.push(p.clone());
            let pair = [ga.clone(), gb.clone()];
            if !globs.contains(&pair) && globs.len() < MAX_GLOBS {
                globs.push(pair);
            }
        }
    }
    if paths.is_empty() {
        return None;
    }
    let total = paths.len() as u32;
    paths.truncate(MAX_PATHS);
    Some(Overlap {
        a: a.key.clone(),
        b: b.key.clone(),
        paths,
        total,
        globs,
    })
}

fn left(i: &PlanIssue, reason: &str, missing: Vec<String>, keys: Vec<String>) -> LeftOut {
    LeftOut {
        key: i.key.clone(),
        title: i.title.clone(),
        reason: reason.into(),
        missing,
        keys,
    }
}

/// Shares the sprint's issues out among `codevs` Co-Devs (clamped to 1…[`MAX_CODEVS`]).
/// `issues`: the sprint's issues, in any state; `states`: every issue of the project → its state
/// (dependencies outside the sprint); `files`: the project's files (relative paths).
pub fn plan_sprint(
    issues: &[PlanIssue],
    states: &HashMap<String, String>,
    codevs: u32,
    files: &[String],
) -> SprintPlan {
    let n = codevs.clamp(1, MAX_CODEVS) as usize;
    let mut ordered: Vec<&PlanIssue> = issues.iter().filter(|i| i.state != "done").collect();
    ordered.sort_by(|a, b| {
        priority_idx(&a.priority)
            .cmp(&priority_idx(&b.priority))
            .then(a.rank.total_cmp(&b.rank))
            .then(a.key.cmp(&b.key))
    });
    let mut left_out: Vec<LeftOut> = vec![];

    // 1. in the flow, or not Ready
    let mut in_flow: Vec<&PlanIssue> = vec![];
    let mut cands: Vec<&PlanIssue> = vec![];
    for i in ordered {
        if i.state != "todo" {
            left_out.push(left(i, "in_flow", vec![], vec![i.state.clone()]));
            in_flow.push(i);
        } else if !i.missing.is_empty() {
            left_out.push(left(i, "not_ready", i.missing.clone(), vec![]));
        } else {
            cands.push(i);
        }
    }

    // 2. the overlaps, among the candidates and the issues in the flow
    let all: Vec<&PlanIssue> = cands.iter().chain(&in_flow).copied().collect();
    let tt = touched(&all, files);
    let idx: HashMap<&str, usize> = all
        .iter()
        .enumerate()
        .map(|(k, i)| (i.key.as_str(), k))
        .collect();
    let mut overlaps: Vec<Overlap> = vec![];
    let mut conflicts: HashMap<&str, BTreeSet<&str>> = HashMap::new();
    for x in 0..all.len() {
        for y in x + 1..all.len() {
            if let Some(o) = overlap_of(all[x], &tt[x], all[y], &tt[y]) {
                conflicts
                    .entry(all[x].key.as_str())
                    .or_default()
                    .insert(all[y].key.as_str());
                conflicts
                    .entry(all[y].key.as_str())
                    .or_default()
                    .insert(all[x].key.as_str());
                overlaps.push(o);
            }
        }
    }
    overlaps.sort_by(|p, q| {
        (idx[p.a.as_str()], idx[p.b.as_str()]).cmp(&(idx[q.a.as_str()], idx[q.b.as_str()]))
    });
    let overlaps_with = |a: &str, b: &str| conflicts.get(a).is_some_and(|s| s.contains(b));

    // 3. dependencies and overlaps with the flow, until nothing else drops out
    let in_flow_keys: Vec<&str> = in_flow.iter().map(|i| i.key.as_str()).collect();
    loop {
        let planned: BTreeSet<&str> = cands.iter().map(|i| i.key.as_str()).collect();
        let mut keep = vec![];
        let mut changed = false;
        for i in &cands {
            let flow: Vec<String> = in_flow_keys
                .iter()
                .filter(|k| overlaps_with(&i.key, k))
                .map(|k| k.to_string())
                .collect();
            let blocked: Vec<String> = i
                .deps
                .iter()
                .filter(|d| {
                    states.get(d.as_str()).map(String::as_str) != Some("done")
                        && !planned.contains(d.as_str())
                })
                .cloned()
                .collect();
            if !blocked.is_empty() {
                left_out.push(left(i, "blocked_by_deps", vec![], blocked));
                changed = true;
            } else if !flow.is_empty() {
                left_out.push(left(i, "overlaps_in_flow", vec![], flow));
                changed = true;
            } else {
                keep.push(*i);
            }
        }
        cands = keep;
        if !changed {
            break;
        }
    }

    // 4. the waves
    let mut lanes: Vec<Lane> = (1..=n as u32)
        .map(|codev| Lane {
            codev,
            points: 0,
            unestimated: 0,
            issues: vec![],
        })
        .collect();
    let mut load = vec![0u32; n];
    let mut wave_of: HashMap<&str, u32> = HashMap::new();
    let mut remaining = cands.clone();
    let mut bumps: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    let mut wave = 0u32;
    while !remaining.is_empty() {
        wave += 1;
        let mut picked: Vec<&PlanIssue> = vec![];
        for i in &remaining {
            if picked.len() == n {
                break;
            }
            let ready = i.deps.iter().all(|d| {
                wave_of.get(d.as_str()).is_some_and(|w| *w < wave)
                    || (!remaining.iter().any(|r| &r.key == d) && !wave_of.contains_key(d.as_str()))
            });
            if !ready {
                continue;
            }
            let clash: Vec<String> = picked
                .iter()
                .filter(|p| overlaps_with(&i.key, &p.key))
                .map(|p| p.key.clone())
                .collect();
            if !clash.is_empty() {
                bumps.entry(i.key.as_str()).or_default().extend(clash);
                continue;
            }
            picked.push(i);
        }
        if picked.is_empty() {
            // what is left waits on itself: a dependency cycle
            for i in &remaining {
                let keys = i
                    .deps
                    .iter()
                    .filter(|d| remaining.iter().any(|r| &r.key == *d))
                    .cloned()
                    .collect();
                left_out.push(left(i, "dep_cycle", vec![], keys));
            }
            wave -= 1;
            break;
        }
        // the heavier issues first, each to the lightest lane still free in this wave
        let mut order: Vec<usize> = (0..picked.len()).collect();
        order.sort_by(|a, b| {
            picked[*b]
                .points
                .unwrap_or(1)
                .cmp(&picked[*a].points.unwrap_or(1))
                .then(a.cmp(b))
        });
        let mut used = vec![false; n];
        let mut placed: Vec<(usize, usize)> = vec![];
        for k in order {
            let lane = (0..n)
                .filter(|l| !used[*l])
                .min_by_key(|l| (load[*l], *l))
                .unwrap_or(0);
            used[lane] = true;
            load[lane] += picked[k].points.unwrap_or(1);
            placed.push((k, lane));
        }
        placed.sort();
        for (k, lane) in placed {
            let i = picked[k];
            wave_of.insert(i.key.as_str(), wave);
            let l = &mut lanes[lane];
            match i.points {
                Some(p) => l.points += p,
                None => l.unestimated += 1,
            }
            l.issues.push(PlannedIssue {
                key: i.key.clone(),
                title: i.title.clone(),
                points: i.points,
                priority: i.priority.clone(),
                wave,
                after: i
                    .deps
                    .iter()
                    .filter(|d| wave_of.contains_key(d.as_str()))
                    .cloned()
                    .collect(),
                serialised_after: vec![],
                branch_conflicts: i.branch_conflicts.clone(),
            });
        }
        remaining.retain(|i| !wave_of.contains_key(i.key.as_str()));
    }
    // who took the wave an issue could have run in, because they overlap
    for l in &mut lanes {
        for p in &mut l.issues {
            if let Some(b) = bumps.get(p.key.as_str()) {
                p.serialised_after = b.iter().cloned().collect();
            }
        }
    }

    SprintPlan {
        sprint: None,
        codevs: n as u32,
        lanes,
        waves: wave,
        left_out,
        overlaps,
        files: files.len() as u32,
    }
}

/// The overlaps of `issue` with each of `others` (Multi Co-Dev, phase 2): may a Co-Dev session
/// start on `issue` while the others run in the same working tree? The same rule as the plan —
/// one file both may change, by a scope glob of each or known to be touched by each.
pub fn overlaps_with(issue: &PlanIssue, others: &[PlanIssue], files: &[String]) -> Vec<Overlap> {
    let all: Vec<&PlanIssue> = std::iter::once(issue)
        .chain(others.iter().filter(|o| o.key != issue.key))
        .collect();
    let tt = touched(&all, files);
    (1..all.len())
        .filter_map(|k| overlap_of(all[0], &tt[0], all[k], &tt[k]))
        .collect()
}

// ───── from the store ─────

/// What the plan of one sprint is computed from: the sprint, its issues (with the files of their
/// change sets as known files), every issue's state, and — for the command to read from git —
/// the commits linked to each issue and each issue's branch.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanSource {
    pub sprint: super::Sprint,
    pub issues: Vec<PlanIssue>,
    pub states: HashMap<String, String>,
    /// issue key → the hashes of its linked commits (newest first)
    pub commits: BTreeMap<String, Vec<String>>,
    /// issue key → its branch
    pub branches: BTreeMap<String, String>,
}

/// What the scope check of a few issues is computed from (Multi Co-Dev, phase 2): the issues, and
/// — for the command to read from git — their linked commits and branches.
#[derive(Clone, Debug, PartialEq)]
pub struct ScopeSource {
    pub issues: Vec<PlanIssue>,
    pub commits: BTreeMap<String, Vec<String>>,
    pub branches: BTreeMap<String, String>,
}

impl super::ProjectStore {
    /// The files each issue is known to touch: the paths of its change sets.
    fn change_set_files(
        &self,
        root: &str,
    ) -> Result<HashMap<String, BTreeSet<String>>, super::ProjectError> {
        let mut files: HashMap<String, BTreeSet<String>> = HashMap::new();
        let mut st = self.conn().prepare(
            "SELECT DISTINCT issue_key, path FROM change_sets WHERE root = ?1 AND issue_key IS NOT NULL",
        )?;
        let rows = st.query_map(rusqlite::params![root], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (k, path) = row?;
            files.entry(k).or_default().insert(path);
        }
        Ok(files)
    }

    /// The issues `keys` as the planner sees them (Multi Co-Dev, phase 2: the scope check before
    /// another Co-Dev session starts). An unknown key is `not_found`.
    pub fn scope_source(
        &self,
        root: &str,
        keys: &[String],
        now: i64,
    ) -> Result<ScopeSource, super::ProjectError> {
        let p = self.load(root, now)?;
        if let Some(k) = keys.iter().find(|k| !p.issues.iter().any(|i| &i.key == *k)) {
            return Err(super::err("not_found", format!("a issue {k} não existe")));
        }
        let files = self.change_set_files(root)?;
        let mut commits = BTreeMap::new();
        let mut branches = BTreeMap::new();
        let issues = p
            .issues
            .iter()
            .filter(|i| keys.contains(&i.key))
            .map(|i| plan_issue(i, &p.dor, &files, &mut commits, &mut branches))
            .collect();
        Ok(ScopeSource {
            issues,
            commits,
            branches,
        })
    }

    /// The source of the parallel plan of `sprint` — or, without one, of the active sprint, else
    /// of the next planned one.
    pub fn plan_source(
        &self,
        root: &str,
        sprint: Option<&str>,
        now: i64,
    ) -> Result<PlanSource, super::ProjectError> {
        let p = self.load(root, now)?;
        let sp = match sprint {
            Some(id) => p.sprints.iter().find(|s| s.id == id),
            None => p
                .sprints
                .iter()
                .find(|s| s.state == "active")
                .or_else(|| p.sprints.iter().find(|s| s.state == "planned")),
        }
        .cloned()
        .ok_or_else(|| {
            super::err(
                "not_found",
                match sprint {
                    Some(id) => format!("a sprint {id} não existe"),
                    None => "não há uma sprint activa nem planeada".to_string(),
                },
            )
        })?;
        let states: HashMap<String, String> = p
            .issues
            .iter()
            .map(|i| (i.key.clone(), i.state.clone()))
            .collect();
        let files = self.change_set_files(root)?;
        let mut commits = BTreeMap::new();
        let mut branches = BTreeMap::new();
        let issues = p
            .issues
            .iter()
            .filter(|i| i.sprint.as_deref() == Some(sp.id.as_str()))
            .map(|i| plan_issue(i, &p.dor, &files, &mut commits, &mut branches))
            .collect();
        Ok(PlanSource {
            sprint: sp,
            issues,
            states,
            commits,
            branches,
        })
    }
}

/// One issue of the store as the planner sees it; its linked commits and branch go to the maps.
fn plan_issue(
    i: &super::Issue,
    dor: &[String],
    files: &HashMap<String, BTreeSet<String>>,
    commits: &mut BTreeMap<String, Vec<String>>,
    branches: &mut BTreeMap<String, String>,
) -> PlanIssue {
    // its own dependencies count as Done here: they become waves
    let deps_done: HashMap<String, String> = i
        .deps
        .iter()
        .map(|d| (d.clone(), "done".to_string()))
        .collect();
    let shas: Vec<String> = i
        .links
        .iter()
        .filter(|l| l.kind == "commit")
        .map(|l| l.reference.clone())
        .collect();
    if !shas.is_empty() {
        commits.insert(i.key.clone(), shas);
    }
    if let Some(b) = i.branch.as_ref().filter(|b| !b.trim().is_empty()) {
        branches.insert(i.key.clone(), b.clone());
    }
    PlanIssue {
        key: i.key.clone(),
        title: i.title.clone(),
        points: i.points,
        priority: i.priority.clone(),
        rank: i.rank,
        state: i.state.clone(),
        scope: i.scope.clone(),
        deps: i.deps.clone(),
        missing: super::readiness(i, &deps_done, dor),
        known_files: files
            .get(&i.key)
            .map(|f| f.iter().cloned().collect())
            .unwrap_or_default(),
        branch_conflicts: vec![],
    }
}

#[cfg(test)]
mod tests;
