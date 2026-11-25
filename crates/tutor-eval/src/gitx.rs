//! Git beyond the basics, for the Source Control work (A4, docs/v2/UI-AUDIT.md item 9):
//! blame with who-knows-this-code, a file's (or a line range's) history, comparing two refs,
//! stashes, worktrees, an interactive rebase driven by a plan the human approved, and amend.
//!
//! Every function runs the real `git` in the project folder and parses its machine output
//! (`--line-porcelain`, `--porcelain`, `%x1f`-separated formats). Arguments that come from the
//! UI are checked first: a ref or a path never starts with `-` (no option injection) and
//! paths always go after `--`. Mutations return git's own message on failure and never leave
//! a half-done rebase behind (it is aborted).

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

pub(crate) fn run(root: &Path, args: &[&str], env: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        };
        return Err(if msg.is_empty() {
            format!("git {} failed", args.first().unwrap_or(&""))
        } else {
            msg
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub(crate) fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    run(root, args, &[])
}

/// A revision from the UI (branch, tag, hash, `HEAD~2`, `stash@{1}`): no leading `-`, no
/// whitespace or control characters, nothing git would read as an option.
pub fn check_rev(r: &str) -> Result<&str, String> {
    let r = r.trim();
    if r.is_empty()
        || r.starts_with('-')
        || r.chars().any(|c| c.is_whitespace() || c.is_control())
        || r.contains("..")
    {
        return Err(format!("revisão inválida: {r:?}"));
    }
    Ok(r)
}

/// A project path from the UI: relative, no `..` component, no leading `-`.
pub fn check_path(p: &str) -> Result<&str, String> {
    let p = p.trim();
    if p.is_empty()
        || p.starts_with('-')
        || p.starts_with('/')
        || p.split(['/', '\\']).any(|c| c == "..")
        || p.chars().any(|c| c.is_control())
    {
        return Err(format!("caminho inválido: {p:?}"));
    }
    Ok(p)
}

// ───── blame ─────

/// One line of `git blame`. `commit` is empty for a line not committed yet.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    pub commit: String,
    pub author: String,
    /// author time, unix seconds (0 for an uncommitted line)
    pub time: i64,
    pub summary: String,
}

/// Who knows this code: the lines each author last touched, their share and how recent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorShare {
    pub author: String,
    pub lines: u32,
    /// 0–100
    pub share: u32,
    /// the newest of their lines, unix seconds
    pub last: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub path: String,
    pub lines: Vec<BlameLine>,
    /// committed lines only, most lines first
    pub authors: Vec<AuthorShare>,
    pub uncommitted: u32,
}

/// Parses `git blame --line-porcelain`.
pub fn parse_blame(text: &str) -> Vec<BlameLine> {
    let mut out = vec![];
    let mut cur: Option<BlameLine> = None;
    for l in text.lines() {
        if l.starts_with('\t') {
            if let Some(b) = cur.take() {
                out.push(b);
            }
            continue;
        }
        let mut it = l.splitn(2, ' ');
        let head = it.next().unwrap_or("");
        let rest = it.next().unwrap_or("");
        if head.len() == 40 && head.chars().all(|c| c.is_ascii_hexdigit()) {
            let final_line = rest
                .split(' ')
                .nth(1)
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            let committed = !head.chars().all(|c| c == '0');
            cur = Some(BlameLine {
                line: final_line,
                commit: if committed {
                    head[..8].to_string()
                } else {
                    String::new()
                },
                author: String::new(),
                time: 0,
                summary: String::new(),
            });
        } else if let Some(b) = cur.as_mut() {
            match head {
                "author" => b.author = rest.to_string(),
                "author-time" => {
                    b.time = if b.commit.is_empty() {
                        0
                    } else {
                        rest.parse().unwrap_or(0)
                    }
                }
                "summary" => b.summary = rest.to_string(),
                _ => {}
            }
        }
    }
    out
}

pub fn blame(root: &Path, path: &str) -> Result<Blame, String> {
    let p = check_path(path)?;
    let text = git(root, &["blame", "--line-porcelain", "--", p])?;
    let lines = parse_blame(&text);
    let mut by: HashMap<String, (u32, i64)> = HashMap::new();
    let mut uncommitted = 0;
    for l in &lines {
        if l.commit.is_empty() {
            uncommitted += 1;
            continue;
        }
        let e = by.entry(l.author.clone()).or_insert((0, 0));
        e.0 += 1;
        e.1 = e.1.max(l.time);
    }
    let committed: u32 = by.values().map(|v| v.0).sum();
    let mut authors: Vec<AuthorShare> = by
        .into_iter()
        .map(|(author, (n, last))| AuthorShare {
            author,
            lines: n,
            share: if committed == 0 {
                0
            } else {
                ((n as f64 / committed as f64) * 100.0).round() as u32
            },
            last,
        })
        .collect();
    authors.sort_by(|a, b| b.lines.cmp(&a.lines).then(a.author.cmp(&b.author)));
    Ok(Blame {
        path: p.to_string(),
        lines,
        authors,
        uncommitted,
    })
}

// ───── history ─────

/// A commit in a file's history, a comparison or a rebase plan.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistCommit {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    /// author time, unix seconds
    pub time: i64,
    pub parents: u32,
}

const HFMT: &str = "--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%at%x1f%P";

fn parse_hist(text: &str) -> Vec<HistCommit> {
    text.split('\u{1e}')
        .filter_map(|rec| {
            let first = rec.lines().next()?.trim_end();
            let f: Vec<&str> = first.split('\u{1f}').collect();
            if f.len() < 6 || f[0].len() < 7 {
                return None;
            }
            Some(HistCommit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                subject: f[2].to_string(),
                author: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                parents: f[5].split_whitespace().count() as u32,
            })
        })
        .collect()
}

/// The commits that touched `path` (following renames), newest first; with `lines`, only
/// those that changed that line range (`git log -L`).
pub fn history(
    root: &Path,
    path: &str,
    lines: Option<(u32, u32)>,
    max: usize,
) -> Result<Vec<HistCommit>, String> {
    let p = check_path(path)?;
    let n = format!("--max-count={}", max.clamp(1, 500));
    let text = match lines {
        Some((a, b)) => {
            let (a, b) = (a.max(1), b.max(a.max(1)));
            let range = format!("-L{a},{b}:{p}");
            git(root, &["log", &n, "--no-patch", HFMT, &range])?
        }
        None => git(root, &["log", "--follow", &n, HFMT, "--", p])?,
    };
    Ok(parse_hist(&text))
}

/// What one commit did to one file (for the history tab's diff).
pub fn show_path(root: &Path, hash: &str, path: &str) -> Result<String, String> {
    let h = check_rev(hash)?;
    let p = check_path(path)?;
    git(
        root,
        &[
            "show",
            "--no-color",
            "--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%w(0,4,4)%B",
            "--find-renames",
            h,
            "--",
            p,
        ],
    )
}

/// The diff of `base...target` (what `target` changed since the merge base), optionally of one file —
/// for reviewing a branch.
pub fn range_diff(
    root: &Path,
    base: &str,
    target: &str,
    path: Option<&str>,
) -> Result<String, String> {
    let (b, t) = (check_rev(base)?, check_rev(target)?);
    let range = format!("{b}...{t}");
    match path {
        Some(p) => {
            let p = check_path(p)?;
            git(
                root,
                &["diff", "--no-color", "--find-renames", &range, "--", p],
            )
        }
        None => git(root, &["diff", "--no-color", "--find-renames", &range]),
    }
}

// ───── compare ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    /// A, M, D, R…
    pub status: String,
    /// None for binary files
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compare {
    pub base: String,
    pub target: String,
    /// in `target`, not in `base`
    pub ahead: Vec<HistCommit>,
    /// in `base`, not in `target`
    pub behind: Vec<HistCommit>,
    /// what `target` changed since the merge base (`base...target`)
    pub files: Vec<FileStat>,
}

pub fn compare(root: &Path, base: &str, target: &str) -> Result<Compare, String> {
    let (b, t) = (check_rev(base)?, check_rev(target)?);
    let ahead = parse_hist(&git(
        root,
        &["log", "--max-count=300", HFMT, &format!("{b}..{t}")],
    )?);
    let behind = parse_hist(&git(
        root,
        &["log", "--max-count=300", HFMT, &format!("{t}..{b}")],
    )?);
    let range = format!("{b}...{t}");
    let names = git(root, &["diff", "--name-status", "--find-renames", &range])?;
    let nums = git(root, &["diff", "--numstat", "--find-renames", &range])?;
    let mut counts: HashMap<String, (Option<u32>, Option<u32>)> = HashMap::new();
    for l in nums.lines() {
        let f: Vec<&str> = l.split('\t').collect();
        if f.len() >= 3 {
            let path = f[f.len() - 1]
                .rsplit(" => ")
                .next()
                .unwrap_or(f[2])
                .trim_end_matches('}')
                .to_string();
            counts.insert(path, (f[0].parse().ok(), f[1].parse().ok()));
        }
    }
    let files = names
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            let status = f.first()?.chars().next()?.to_string();
            let path = f.last()?.to_string();
            let (added, removed) = counts.get(&path).cloned().unwrap_or((None, None));
            Some(FileStat {
                path,
                status,
                added,
                removed,
            })
        })
        .collect();
    Ok(Compare {
        base: b.to_string(),
        target: t.to_string(),
        ahead,
        behind,
        files,
    })
}

// ───── stash ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,
    pub message: String,
    /// unix seconds
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum StashOp {
    List,
    Push {
        message: String,
        #[serde(default)]
        untracked: bool,
    },
    Apply {
        index: u32,
        #[serde(default)]
        pop: bool,
    },
    Drop {
        index: u32,
    },
    Show {
        index: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashResult {
    pub stashes: Vec<Stash>,
    /// git's message (push/apply/drop) or the diff (show)
    pub output: String,
}

fn stash_list(root: &Path) -> Result<Vec<Stash>, String> {
    let text = git(root, &["stash", "list", "--format=%gd%x1f%gs%x1f%ct"])?;
    Ok(text
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\u{1f}').collect();
            let index = f
                .first()?
                .trim_start_matches("stash@{")
                .trim_end_matches('}')
                .parse()
                .ok()?;
            Some(Stash {
                index,
                message: f.get(1).unwrap_or(&"").to_string(),
                time: f.get(2).and_then(|t| t.parse().ok()).unwrap_or(0),
            })
        })
        .collect())
}

pub fn stash(root: &Path, op: &StashOp) -> Result<StashResult, String> {
    let output = match op {
        StashOp::List => String::new(),
        StashOp::Push { message, untracked } => {
            let mut a = vec!["stash", "push"];
            if *untracked {
                a.push("--include-untracked");
            }
            let m = message.trim();
            if !m.is_empty() {
                a.extend(["-m", m]);
            }
            let out = git(root, &a)?;
            if out.contains("No local changes to save") {
                return Err("não há alterações para guardar".into());
            }
            out
        }
        StashOp::Apply { index, pop } => git(
            root,
            &[
                "stash",
                if *pop { "pop" } else { "apply" },
                &format!("stash@{{{index}}}"),
            ],
        )?,
        StashOp::Drop { index } => git(root, &["stash", "drop", &format!("stash@{{{index}}}")])?,
        StashOp::Show { index } => git(
            root,
            &[
                "stash",
                "show",
                "--patch",
                "--no-color",
                &format!("stash@{{{index}}}"),
            ],
        )?,
    };
    Ok(StashResult {
        stashes: stash_list(root)?,
        output: output.trim_end().to_string(),
    })
}

// ───── worktrees ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: String,
    /// None when detached
    pub branch: Option<String>,
    pub locked: bool,
    pub prunable: bool,
    /// the folder open in the IDE
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum WorktreeOp {
    List,
    /// `path` is relative to the project folder (e.g. `../proj-feature`) or absolute
    Add {
        path: String,
        branch: String,
        #[serde(default)]
        create: bool,
    },
    Remove {
        path: String,
    },
    /// r23 F3 (Launchpad): a pull request's head into its own worktree —
    /// `git fetch <remote> pull/<n>/head:pr/<n>` then `git worktree add <path> pr/<n>`
    AddPr {
        number: u64,
        path: String,
        remote: String,
    },
}

/// The commands `AddPr` runs (what the approval dialog shows).
pub fn pr_worktree_commands(number: u64, path: &str, remote: &str) -> [String; 2] {
    [
        format!("git fetch {remote} pull/{number}/head:pr/{number}"),
        format!("git worktree add {path} pr/{number}"),
    ]
}

pub fn parse_worktrees(text: &str, root: &Path) -> Vec<Worktree> {
    let here = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    text.split("\n\n")
        .filter_map(|block| {
            let mut w = Worktree {
                path: String::new(),
                head: String::new(),
                branch: None,
                locked: false,
                prunable: false,
                current: false,
            };
            for l in block.lines() {
                if let Some(p) = l.strip_prefix("worktree ") {
                    w.path = p.to_string();
                } else if let Some(h) = l.strip_prefix("HEAD ") {
                    w.head = h.chars().take(8).collect();
                } else if let Some(b) = l.strip_prefix("branch ") {
                    w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
                } else if l.starts_with("locked") {
                    w.locked = true;
                } else if l.starts_with("prunable") {
                    w.prunable = true;
                }
            }
            if w.path.is_empty() {
                return None;
            }
            w.current = std::fs::canonicalize(&w.path)
                .map(|p| p == here)
                .unwrap_or(false);
            Some(w)
        })
        .collect()
}

pub fn worktree(root: &Path, op: &WorktreeOp) -> Result<Vec<Worktree>, String> {
    let list = |root: &Path| {
        git(root, &["worktree", "list", "--porcelain"]).map(|t| parse_worktrees(&t, root))
    };
    match op {
        WorktreeOp::List => {}
        WorktreeOp::Add {
            path,
            branch,
            create,
        } => {
            let p = path.trim();
            if p.is_empty() || p.starts_with('-') || p.chars().any(|c| c.is_control()) {
                return Err(format!("pasta inválida: {p:?}"));
            }
            let b = check_rev(branch)?;
            if *create {
                git(root, &["worktree", "add", "-b", b, "--", p])?;
            } else {
                git(root, &["worktree", "add", "--", p, b])?;
            }
        }
        WorktreeOp::AddPr {
            number,
            path,
            remote,
        } => {
            let p = path.trim();
            if p.is_empty()
                || p.starts_with('-')
                || p.chars().any(|c| c.is_control())
                || *number == 0
            {
                return Err(format!("pasta ou número inválidos: {p:?} #{number}"));
            }
            let r = check_rev(remote)?;
            let refspec = format!("pull/{number}/head:pr/{number}");
            git(root, &["fetch", r, &refspec])?;
            git(root, &["worktree", "add", "--", p, &format!("pr/{number}")])?;
        }
        WorktreeOp::Remove { path } => {
            let cur = list(root)?;
            let target = cur
                .iter()
                .find(|w| w.path == *path)
                .ok_or_else(|| format!("worktree desconhecida: {path}"))?;
            if target.current {
                return Err("não se remove a worktree aberta no IDE".into());
            }
            if cur.first().map(|w| w.path == *path).unwrap_or(false) {
                return Err("não se remove a worktree principal".into());
            }
            git(root, &["worktree", "remove", "--", path])?;
        }
    }
    list(root)
}

// ───── interactive rebase ─────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub action: RebaseAction,
    pub hash: String,
    /// the new message, for `reword`
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum RebaseOp {
    Plan {
        onto: String,
    },
    Run {
        onto: String,
        steps: Vec<RebaseStep>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    pub onto: String,
    /// `onto..HEAD`, oldest first (the order of the todo)
    pub commits: Vec<HistCommit>,
    /// the working tree has changes (git refuses to rebase)
    pub dirty: bool,
    /// some of these commits are already on a remote branch (rewriting them needs a force push)
    pub published: bool,
    /// the branch being rebased
    pub branch: String,
}

fn plan(root: &Path, onto: &str) -> Result<RebasePlan, String> {
    let o = check_rev(onto)?;
    let mut commits = parse_hist(&git(
        root,
        &["log", "--max-count=200", HFMT, &format!("{o}..HEAD")],
    )?);
    commits.reverse();
    let dirty = !git(root, &["status", "--porcelain", "--untracked-files=no"])?
        .trim()
        .is_empty();
    let published = match commits.first() {
        Some(c) => !git(root, &["branch", "-r", "--contains", &c.hash])
            .unwrap_or_default()
            .trim()
            .is_empty(),
        None => false,
    };
    let branch = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    Ok(RebasePlan {
        onto: o.to_string(),
        commits,
        dirty,
        published,
        branch,
    })
}

/// The todo git will run for these steps; `reword` becomes `pick` + an `exec` that amends the
/// message from a file (`msg_file(i)` gives that file's path for step `i`).
pub fn todo_for(steps: &[RebaseStep], msg_file: &dyn Fn(usize) -> String) -> String {
    let mut out = String::new();
    for (i, s) in steps.iter().enumerate() {
        let verb = match s.action {
            RebaseAction::Pick | RebaseAction::Reword => "pick",
            RebaseAction::Squash => "squash",
            RebaseAction::Fixup => "fixup",
            RebaseAction::Drop => "drop",
        };
        out.push_str(&format!("{verb} {}\n", s.hash));
        if s.action == RebaseAction::Reword {
            out.push_str(&format!(
                "exec git commit --amend --only --allow-empty -F '{}'\n",
                msg_file(i)
            ));
        }
    }
    out
}

pub fn rebase(root: &Path, op: &RebaseOp) -> Result<RebasePlan, String> {
    match op {
        RebaseOp::Plan { onto } => plan(root, onto),
        RebaseOp::Run { onto, steps } => {
            let p = plan(root, onto)?;
            // the base as a commit: `HEAD~3` would mean something else once the branch is rewritten
            let base = git(
                root,
                &["rev-parse", "--verify", &format!("{}^{{commit}}", p.onto)],
            )?
            .trim()
            .to_string();
            if p.dirty {
                return Err(
                    "há alterações por commitar: faz commit ou stash antes do rebase".into(),
                );
            }
            let mut want: Vec<&str> = p.commits.iter().map(|c| c.hash.as_str()).collect();
            let mut got: Vec<&str> = steps.iter().map(|s| s.hash.as_str()).collect();
            want.sort_unstable();
            got.sort_unstable();
            if want != got {
                return Err(
                    "o plano já não corresponde aos commits do ramo: abre-o de novo".into(),
                );
            }
            if matches!(
                steps
                    .iter()
                    .find(|s| s.action != RebaseAction::Drop)
                    .map(|s| s.action),
                Some(RebaseAction::Squash | RebaseAction::Fixup)
            ) {
                return Err("o primeiro commit que fica não pode ser squash nem fixup".into());
            }
            for s in steps.iter().filter(|s| s.action == RebaseAction::Reword) {
                if s.message.as_deref().map(str::trim).unwrap_or("").is_empty() {
                    return Err(format!(
                        "falta a mensagem nova de {}",
                        &s.hash[..s.hash.len().min(8)]
                    ));
                }
            }
            let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
            let dir_s = dir.path().display().to_string();
            if dir_s.contains('\'') {
                return Err("pasta temporária com um nome inesperado".into());
            }
            for (i, s) in steps.iter().enumerate() {
                if let Some(m) = &s.message {
                    std::fs::write(dir.path().join(format!("msg{i}")), m.trim())
                        .map_err(|e| e.to_string())?;
                }
            }
            let todo = todo_for(steps, &|i| format!("{dir_s}/msg{i}"));
            let todo_path = dir.path().join("todo");
            std::fs::File::create(&todo_path)
                .and_then(|mut f| f.write_all(todo.as_bytes()))
                .map_err(|e| e.to_string())?;
            let seq = format!("cp '{}'", todo_path.display());
            let r = run(
                root,
                &["rebase", "-i", base.as_str()],
                &[
                    ("GIT_SEQUENCE_EDITOR", seq.as_str()),
                    ("GIT_EDITOR", "true"),
                ],
            );
            if let Err(e) = r {
                let _ = git(root, &["rebase", "--abort"]);
                return Err(format!(
                    "o rebase parou e foi desfeito (o ramo ficou como estava): {e}"
                ));
            }
            let mut after = plan(root, &base)?;
            after.onto = p.onto;
            Ok(after)
        }
    }
}

// ───── amend ─────

/// Amends HEAD with what is staged and, when given, a new message. Refuses a commit that is
/// already on a remote branch unless `allow_published` (the human confirmed). Returns the new short hash.
pub fn amend(root: &Path, message: Option<&str>, allow_published: bool) -> Result<String, String> {
    let head = git(root, &["rev-parse", "HEAD"])
        .map_err(|_| "ainda não há commits para emendar".to_string())?;
    if !allow_published
        && !git(root, &["branch", "-r", "--contains", head.trim()])
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return Err(
            "published: este commit já está num ramo remoto; emendá-lo obriga a um push forçado"
                .into(),
        );
    }
    let mut a = vec!["commit", "--amend"];
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => a.extend(["-m", m]),
        None => a.push("--no-edit"),
    }
    git(root, &a)?;
    Ok(git(root, &["rev-parse", "--short", "HEAD"])?
        .trim()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let g = |a: &[&str]| {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(d.path())
                    .args(a)
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "{a:?}"
            )
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.name", "Ana"]);
        g(&["config", "user.email", "ana@example.com"]);
        g(&["config", "commit.gpgsign", "false"]);
        d
    }
    fn commit(d: &Path, who: &str, file: &str, text: &str, msg: &str) {
        std::fs::write(d.join(file), text).unwrap();
        let ok = |a: &[&str]| {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(d)
                    .args(a)
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "{a:?}"
            )
        };
        ok(&["add", file]);
        ok(&["-c", &format!("user.name={who}"), "commit", "-q", "-m", msg]);
    }

    #[test]
    fn checks_arguments_from_the_ui() {
        assert!(check_rev("--upload-pack=x").is_err());
        assert!(check_rev("a b").is_err());
        assert!(check_rev("main..x").is_err());
        assert_eq!(check_rev("HEAD~2").unwrap(), "HEAD~2");
        assert!(check_path("../etc/passwd").is_err());
        assert!(check_path("/etc/passwd").is_err());
        assert!(check_path("-x").is_err());
        assert_eq!(check_path("src/lib.rs").unwrap(), "src/lib.rs");
    }

    #[test]
    fn blame_says_who_knows_the_code_and_marks_uncommitted_lines() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "one\ntwo\nthree\n", "first");
        commit(
            d.path(),
            "Rui",
            "a.txt",
            "one\nTWO\nthree\nfour\n",
            "second",
        );
        std::fs::write(d.path().join("a.txt"), "one\nTWO\nthree\nfour\nfive\n").unwrap();
        let b = blame(d.path(), "a.txt").unwrap();
        assert_eq!(b.lines.len(), 5);
        assert_eq!(b.lines[1].author, "Rui");
        assert_eq!(b.lines[1].summary, "second");
        assert_eq!(b.lines[4].commit, "");
        assert_eq!(b.uncommitted, 1);
        assert_eq!(
            b.authors
                .iter()
                .map(|a| (a.author.as_str(), a.lines, a.share))
                .collect::<Vec<_>>(),
            vec![("Ana", 2, 50), ("Rui", 2, 50)]
        );
    }

    #[test]
    fn history_follows_a_file_and_a_line_range() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "one\ntwo\n", "add a");
        commit(d.path(), "Ana", "b.txt", "x\n", "add b");
        commit(d.path(), "Rui", "a.txt", "one\nTWO\n", "change line 2");
        let h = history(d.path(), "a.txt", None, 50).unwrap();
        assert_eq!(
            h.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(),
            vec!["change line 2", "add a"]
        );
        let l1 = history(d.path(), "a.txt", Some((1, 1)), 50).unwrap();
        assert_eq!(
            l1.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(),
            vec!["add a"]
        );
        let diff = show_path(d.path(), &h[0].hash, "a.txt").unwrap();
        assert!(diff.contains("+TWO"), "{diff}");
        assert!(show_path(d.path(), "--output=x", "a.txt").is_err());
    }

    #[test]
    fn compares_two_refs() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "1\n", "base");
        let ok = |a: &[&str]| {
            assert!(Command::new("git")
                .arg("-C")
                .arg(d.path())
                .args(a)
                .output()
                .unwrap()
                .status
                .success())
        };
        ok(&["checkout", "-q", "-b", "feature"]);
        commit(d.path(), "Ana", "b.txt", "new\nfile\n", "feature work");
        ok(&["checkout", "-q", "main"]);
        commit(d.path(), "Ana", "a.txt", "2\n", "main work");
        let c = compare(d.path(), "main", "feature").unwrap();
        assert_eq!(c.ahead.len(), 1);
        assert_eq!(c.behind.len(), 1);
        assert_eq!(
            c.files,
            vec![FileStat {
                path: "b.txt".into(),
                status: "A".into(),
                added: Some(2),
                removed: Some(0)
            }]
        );
    }

    #[test]
    fn stashes_push_list_show_and_pop() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "1\n", "base");
        assert!(stash(
            d.path(),
            &StashOp::Push {
                message: "nada".into(),
                untracked: false
            }
        )
        .is_err());
        std::fs::write(d.path().join("a.txt"), "2\n").unwrap();
        let r = stash(
            d.path(),
            &StashOp::Push {
                message: "lexer experiment".into(),
                untracked: false,
            },
        )
        .unwrap();
        assert_eq!(r.stashes.len(), 1);
        assert!(r.stashes[0].message.contains("lexer experiment"));
        assert_eq!(
            std::fs::read_to_string(d.path().join("a.txt")).unwrap(),
            "1\n"
        );
        assert!(stash(d.path(), &StashOp::Show { index: 0 })
            .unwrap()
            .output
            .contains("+2"));
        let r = stash(
            d.path(),
            &StashOp::Apply {
                index: 0,
                pop: true,
            },
        )
        .unwrap();
        assert!(r.stashes.is_empty());
        assert_eq!(
            std::fs::read_to_string(d.path().join("a.txt")).unwrap(),
            "2\n"
        );
    }

    #[test]
    fn worktrees_add_list_and_refuse_removing_the_open_one() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "1\n", "base");
        let wt = d.path().join("..").join(format!(
            "{}-wt",
            d.path().file_name().unwrap().to_string_lossy()
        ));
        let list = worktree(
            d.path(),
            &WorktreeOp::Add {
                path: wt.display().to_string(),
                branch: "feature/x".into(),
                create: true,
            },
        )
        .unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].current);
        assert_eq!(list[1].branch.as_deref(), Some("feature/x"));
        assert!(worktree(
            d.path(),
            &WorktreeOp::Remove {
                path: list[0].path.clone()
            }
        )
        .is_err());
        let after = worktree(
            d.path(),
            &WorktreeOp::Remove {
                path: list[1].path.clone(),
            },
        )
        .unwrap();
        assert_eq!(after.len(), 1);
    }

    #[test]
    fn rebase_runs_the_approved_plan_and_aborts_on_trouble() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "1\n", "base");
        commit(d.path(), "Ana", "b.txt", "b\n", "add b");
        commit(d.path(), "Ana", "c.txt", "c\n", "add c");
        commit(d.path(), "Ana", "c.txt", "c2\n", "fix c");
        let p = rebase(
            d.path(),
            &RebaseOp::Plan {
                onto: "HEAD~3".into(),
            },
        )
        .unwrap();
        assert_eq!(
            p.commits
                .iter()
                .map(|c| c.subject.as_str())
                .collect::<Vec<_>>(),
            vec!["add b", "add c", "fix c"]
        );
        assert!(!p.dirty && !p.published);
        let h: Vec<String> = p.commits.iter().map(|c| c.hash.clone()).collect();
        // reword b, squash "fix c" into "add c" (fixup keeps its message), then put c first
        let steps = vec![
            RebaseStep {
                action: RebaseAction::Pick,
                hash: h[1].clone(),
                message: None,
            },
            RebaseStep {
                action: RebaseAction::Fixup,
                hash: h[2].clone(),
                message: None,
            },
            RebaseStep {
                action: RebaseAction::Reword,
                hash: h[0].clone(),
                message: Some("add the b file".into()),
            },
        ];
        let after = rebase(
            d.path(),
            &RebaseOp::Run {
                onto: "HEAD~3".into(),
                steps,
            },
        )
        .unwrap();
        assert_eq!(
            after
                .commits
                .iter()
                .map(|c| c.subject.as_str())
                .collect::<Vec<_>>(),
            vec!["add c", "add the b file"]
        );
        assert_eq!(
            std::fs::read_to_string(d.path().join("c.txt")).unwrap(),
            "c2\n"
        );
        // a stale plan is refused; a conflicting one is aborted and leaves the branch as it was
        let stale = vec![RebaseStep {
            action: RebaseAction::Pick,
            hash: h[0].clone(),
            message: None,
        }];
        assert!(rebase(
            d.path(),
            &RebaseOp::Run {
                onto: "HEAD~2".into(),
                steps: stale
            }
        )
        .is_err());
        let head_before = git(d.path(), &["rev-parse", "HEAD"]).unwrap();
        let p2 = rebase(
            d.path(),
            &RebaseOp::Plan {
                onto: "HEAD~2".into(),
            },
        )
        .unwrap();
        let first = vec![
            RebaseStep {
                action: RebaseAction::Squash,
                hash: p2.commits[0].hash.clone(),
                message: None,
            },
            RebaseStep {
                action: RebaseAction::Pick,
                hash: p2.commits[1].hash.clone(),
                message: None,
            },
        ];
        assert!(rebase(
            d.path(),
            &RebaseOp::Run {
                onto: "HEAD~2".into(),
                steps: first
            }
        )
        .is_err());
        assert_eq!(git(d.path(), &["rev-parse", "HEAD"]).unwrap(), head_before);
    }

    #[test]
    fn rebase_conflict_is_aborted() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "1\n", "base");
        commit(d.path(), "Ana", "a.txt", "2\n", "two");
        commit(d.path(), "Ana", "a.txt", "3\n", "three");
        let p = rebase(
            d.path(),
            &RebaseOp::Plan {
                onto: "HEAD~2".into(),
            },
        )
        .unwrap();
        let head_before = git(d.path(), &["rev-parse", "HEAD"]).unwrap();
        // dropping "two" makes "three" conflict on a.txt
        let steps = vec![
            RebaseStep {
                action: RebaseAction::Drop,
                hash: p.commits[0].hash.clone(),
                message: None,
            },
            RebaseStep {
                action: RebaseAction::Pick,
                hash: p.commits[1].hash.clone(),
                message: None,
            },
        ];
        let e = rebase(
            d.path(),
            &RebaseOp::Run {
                onto: "HEAD~2".into(),
                steps,
            },
        )
        .unwrap_err();
        assert!(e.contains("desfeito"), "{e}");
        assert_eq!(git(d.path(), &["rev-parse", "HEAD"]).unwrap(), head_before);
        assert!(!d.path().join(".git/rebase-merge").exists());
    }

    #[test]
    fn amend_changes_the_message_and_keeps_the_tree() {
        let d = repo();
        commit(d.path(), "Ana", "a.txt", "1\n", "wip");
        let short = amend(d.path(), Some("feat: a"), false).unwrap();
        assert!(!short.is_empty());
        assert_eq!(
            git(d.path(), &["log", "-1", "--format=%s"]).unwrap().trim(),
            "feat: a"
        );
    }
}
