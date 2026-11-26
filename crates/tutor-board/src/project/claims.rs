//! File claims (Multi Co-Dev, phase 3): with a worktree per Co-Dev session, two sessions no longer
//! write over each other on disk — but two branches that change the same file will clash when they
//! are integrated (phase 4). So a session claims every file it writes: the first writer owns the
//! path of the project, and another session's write to it is refused (the host's tool layer,
//! `codev_agent`) naming the owner — session and issue — until the owner closes.
//!
//! - One owner per `(root, path)`; the path is the project-relative one (the same in every worktree).
//! - A claim is released when its session closes (normal end) or when it is **abandoned**: the
//!   caller says which holders are gone (a session no longer open in this app, or whose app process
//!   died) and their claims are taken over or dropped. The store never guesses who is alive.
//! - Who and when are the caller's (the backend), never the UI.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::ProjectError;

/// One claimed file.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub path: String,
    /// the Co-Dev session that owns it
    pub session: String,
    /// the issue that session works on, when it works on one
    pub issue: Option<String>,
    /// the app process that holds the session
    pub pid: u32,
    pub at: i64,
}

/// Who wants a path.
#[derive(Debug, Clone, PartialEq)]
pub struct Claimant<'a> {
    pub session: &'a str,
    pub issue: Option<&'a str>,
    pub pid: u32,
}

/// What [`claim`] decided.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// The path is the claimant's now; `new` when it was not before (a release on refusal undoes
    /// only a new claim).
    Claimed { new: bool },
    /// Another live session owns it.
    Held(Claim),
}

fn invalid(m: String) -> ProjectError {
    ProjectError {
        code: "invalid".into(),
        message: m,
        overridable: false,
    }
}

/// A project-relative path as claims keep it: `/` separators, no `./`, never absolute or with `..`.
pub fn norm(path: &str) -> Result<String, ProjectError> {
    let p = path.trim().replace('\\', "/");
    let parts: Vec<&str> = p
        .split('/')
        .filter(|c| !c.is_empty() && *c != ".")
        .collect();
    if p.starts_with('/') || parts.is_empty() || parts.iter().any(|c| *c == "..") {
        return Err(invalid(format!("not a path inside the project: {path:?}")));
    }
    Ok(parts.join("/"))
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Claim> {
    Ok(Claim {
        path: r.get(0)?,
        session: r.get(1)?,
        issue: r.get(2)?,
        pid: r.get::<_, i64>(3)? as u32,
        at: r.get(4)?,
    })
}

/// Claims `path` of `root` for `who`, in the caller's transaction. The path's owner, when it is
/// another session that `abandoned` does not call gone, keeps it ([`Outcome::Held`]); an abandoned
/// owner's claim is taken over.
pub fn claim(
    conn: &Connection,
    root: &str,
    path: &str,
    who: &Claimant,
    now: i64,
    abandoned: &dyn Fn(&Claim) -> bool,
) -> Result<Outcome, ProjectError> {
    let path = norm(path)?;
    if who.session.trim().is_empty() {
        return Err(invalid("a claim needs its session".into()));
    }
    let cur = conn
        .query_row(
            "SELECT path, session, issue_key, pid, at FROM file_claims WHERE root = ?1 AND path = ?2",
            params![root, path],
            row,
        )
        .optional()?;
    match cur {
        Some(c) if c.session == who.session => Ok(Outcome::Claimed { new: false }),
        Some(c) if !abandoned(&c) => Ok(Outcome::Held(c)),
        _ => {
            conn.execute(
                "INSERT INTO file_claims (root, path, session, issue_key, pid, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(root, path) DO UPDATE SET session = excluded.session, issue_key = excluded.issue_key,
                   pid = excluded.pid, at = excluded.at",
                params![root, path, who.session, who.issue, who.pid as i64, now],
            )?;
            Ok(Outcome::Claimed { new: true })
        }
    }
}

/// Gives back one path the session owns (a write it claimed and that did not happen). `false`
/// when the session did not own it.
pub fn release(
    conn: &Connection,
    root: &str,
    session: &str,
    path: &str,
) -> Result<bool, ProjectError> {
    let path = norm(path)?;
    Ok(conn.execute(
        "DELETE FROM file_claims WHERE root = ?1 AND path = ?2 AND session = ?3",
        params![root, path, session],
    )? > 0)
}

/// Gives back every path of a session (it closed). Returns how many.
pub fn release_session(
    conn: &Connection,
    root: &str,
    session: &str,
) -> Result<usize, ProjectError> {
    Ok(conn.execute(
        "DELETE FROM file_claims WHERE root = ?1 AND session = ?2",
        params![root, session],
    )?)
}

/// Every claim of `root`, by path.
pub fn list(conn: &Connection, root: &str) -> Result<Vec<Claim>, ProjectError> {
    let mut st = conn.prepare(
        "SELECT path, session, issue_key, pid, at FROM file_claims WHERE root = ?1 ORDER BY path",
    )?;
    let v = st
        .query_map(params![root], row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Drops the claims whose holder is gone (`abandoned`). Returns how many.
pub fn release_abandoned(
    conn: &Connection,
    root: &str,
    abandoned: &dyn Fn(&Claim) -> bool,
) -> Result<usize, ProjectError> {
    let gone: Vec<Claim> = list(conn, root)?
        .into_iter()
        .filter(|c| abandoned(c))
        .collect();
    for c in &gone {
        conn.execute(
            "DELETE FROM file_claims WHERE root = ?1 AND path = ?2 AND session = ?3",
            params![root, c.path, c.session],
        )?;
    }
    Ok(gone.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::ProjectStore;

    fn who<'a>(session: &'a str, issue: Option<&'a str>) -> Claimant<'a> {
        Claimant {
            session,
            issue,
            pid: 7,
        }
    }

    #[test]
    fn the_first_writer_owns_a_path_until_it_closes() {
        let mut st = ProjectStore::in_memory().unwrap();
        let alive = |_: &Claim| false;
        let a = who("cda-a", Some("DX-1"));
        let b = who("cda-b", Some("DX-2"));
        assert_eq!(
            st.claim("/p", "./src/cart.rs", &a, 10, &alive).unwrap(),
            Outcome::Claimed { new: true }
        );
        // the same session again: still its own, not new
        assert_eq!(
            st.claim("/p", "src/cart.rs", &a, 11, &alive).unwrap(),
            Outcome::Claimed { new: false }
        );
        // another session is told who holds it
        match st.claim("/p", "src//cart.rs", &b, 12, &alive).unwrap() {
            Outcome::Held(c) => {
                assert_eq!(c.session, "cda-a");
                assert_eq!(c.issue.as_deref(), Some("DX-1"));
                assert_eq!(c.at, 10);
            }
            o => panic!("{o:?}"),
        }
        // another project is another set of paths
        assert_eq!(
            st.claim("/q", "src/cart.rs", &b, 12, &alive).unwrap(),
            Outcome::Claimed { new: true }
        );
        assert_eq!(st.claims("/p").unwrap().len(), 1);
        // closing releases every path of the session; then the other one gets it
        assert_eq!(st.release_session_claims("/p", "cda-a").unwrap(), 1);
        assert_eq!(
            st.claim("/p", "src/cart.rs", &b, 13, &alive).unwrap(),
            Outcome::Claimed { new: true }
        );
        // a write that did not happen gives back only that path, and only its owner can
        assert!(!st.release_claim("/p", "cda-a", "src/cart.rs").unwrap());
        assert!(st.release_claim("/p", "cda-b", "src/cart.rs").unwrap());
        assert!(st.claims("/p").unwrap().is_empty());
    }

    #[test]
    fn an_abandoned_claim_is_taken_over_or_dropped() {
        let mut st = ProjectStore::in_memory().unwrap();
        let none = |_: &Claim| false;
        st.claim("/p", "a.rs", &who("cda-old", None), 1, &none)
            .unwrap();
        st.claim("/p", "b.rs", &who("cda-old", None), 1, &none)
            .unwrap();
        st.claim("/p", "c.rs", &who("cda-live", None), 1, &none)
            .unwrap();
        let gone = |c: &Claim| c.session == "cda-old";
        assert_eq!(
            st.claim("/p", "a.rs", &who("cda-new", Some("DX-3")), 2, &gone)
                .unwrap(),
            Outcome::Claimed { new: true }
        );
        assert_eq!(st.release_abandoned_claims("/p", &gone).unwrap(), 1);
        let left: Vec<(String, String)> = st
            .claims("/p")
            .unwrap()
            .into_iter()
            .map(|c| (c.path, c.session))
            .collect();
        assert_eq!(
            left,
            [
                ("a.rs".to_string(), "cda-new".to_string()),
                ("c.rs".to_string(), "cda-live".to_string())
            ]
        );
    }

    #[test]
    fn claims_keep_project_relative_paths_only() {
        for bad in ["", "/etc/passwd", "../x", "a/../../b", "  "] {
            assert!(norm(bad).is_err(), "{bad:?}");
        }
        assert_eq!(norm(" ./src\\a.rs ").unwrap(), "src/a.rs");
        let mut st = ProjectStore::in_memory().unwrap();
        let e = st
            .claim("/p", "a.rs", &who(" ", None), 1, &|_: &Claim| false)
            .unwrap_err();
        assert_eq!(e.code, "invalid");
    }
}
