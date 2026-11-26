//! Schema of the project store, with numbered, forward-only migrations.
//!
//! `schema_version` holds the last migration applied. Each migration runs once, in a
//! transaction, in order. Never edit a migration that shipped: add a new one.

use rusqlite::{params, Connection};

/// Migrations, in order. Index + 1 is the version they bring the base to.
const MIGRATIONS: &[&str] = &[
    // 1 — the project model (docs/v2/UI-AUDIT.md, item 5) and the Co-Dev change sets
    //     (docs/v2/RF-CODEV-STREAM.md §9)
    "CREATE TABLE projects (
        root        TEXT PRIMARY KEY,
        key_prefix  TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        method      TEXT NOT NULL,
        iter_days   INTEGER NOT NULL,
        wip         TEXT NOT NULL,
        dor         TEXT NOT NULL,
        dod         TEXT NOT NULL,
        created     INTEGER NOT NULL,
        updated     INTEGER NOT NULL
    );
    CREATE TABLE issues (
        root        TEXT NOT NULL,
        key         TEXT NOT NULL,
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL,
        priority    TEXT NOT NULL,
        points      INTEGER,
        assignee    TEXT NOT NULL DEFAULT '',
        pair        TEXT NOT NULL DEFAULT '',
        epic        TEXT NOT NULL DEFAULT '',
        cos         TEXT NOT NULL DEFAULT 'standard',
        blocked     TEXT,
        rank        REAL NOT NULL,
        state       TEXT NOT NULL,
        sprint      TEXT,
        ready       INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        branch      TEXT,
        dod_done    TEXT NOT NULL DEFAULT '[]',
        created     INTEGER NOT NULL,
        updated     INTEGER NOT NULL,
        PRIMARY KEY (root, key)
    );
    CREATE TABLE acceptance (
        root  TEXT NOT NULL,
        key   TEXT NOT NULL,
        ord   INTEGER NOT NULL,
        text  TEXT NOT NULL,
        done  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (root, key, ord)
    );
    CREATE TABLE activity (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        root   TEXT NOT NULL,
        key    TEXT NOT NULL,
        at     INTEGER NOT NULL,
        actor  TEXT NOT NULL,
        kind   TEXT NOT NULL,
        from_state TEXT,
        to_state   TEXT,
        note   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_activity_issue ON activity(root, key, at);
    CREATE TABLE sprints (
        root      TEXT NOT NULL,
        id        TEXT NOT NULL,
        name      TEXT NOT NULL,
        goal      TEXT NOT NULL,
        start     INTEGER NOT NULL,
        end       INTEGER NOT NULL,
        state     TEXT NOT NULL,
        capacity  INTEGER,
        PRIMARY KEY (root, id)
    );
    CREATE TABLE releases (
        root     TEXT NOT NULL,
        version  TEXT NOT NULL,
        date     INTEGER NOT NULL,
        goal     TEXT NOT NULL,
        epic     TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (root, version)
    );
    CREATE TABLE retro (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        root    TEXT NOT NULL,
        sprint  TEXT,
        kind    TEXT NOT NULL,
        text    TEXT NOT NULL,
        at      INTEGER NOT NULL
    );
    CREATE TABLE inbox (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        root     TEXT NOT NULL,
        title    TEXT NOT NULL,
        kind     TEXT NOT NULL,
        points   INTEGER,
        source   TEXT NOT NULL,
        detail   TEXT NOT NULL DEFAULT '',
        state    TEXT NOT NULL,
        created  INTEGER NOT NULL
    );
    CREATE TABLE issue_links (
        root   TEXT NOT NULL,
        key    TEXT NOT NULL,
        kind   TEXT NOT NULL,
        ref    TEXT NOT NULL,
        title  TEXT NOT NULL,
        at     INTEGER NOT NULL,
        PRIMARY KEY (root, key, kind, ref)
    );
    CREATE TABLE change_sets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        root        TEXT NOT NULL,
        session     TEXT NOT NULL,
        call        TEXT NOT NULL,
        hunk        TEXT NOT NULL,
        path        TEXT NOT NULL,
        start       INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        added       INTEGER NOT NULL,
        removed     INTEGER NOT NULL,
        decided_by  TEXT NOT NULL,
        decided_at  INTEGER NOT NULL,
        issue_key   TEXT
    );
    CREATE INDEX idx_change_sets_issue ON change_sets(root, issue_key);",
    // 2 — the reports of Co-Dev turns (docs/v2/UI-AUDIT.md item 11, HARNESS-07), linked to
    //     the issue the turn worked on
    "CREATE TABLE artifacts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        root       TEXT NOT NULL,
        session    TEXT NOT NULL,
        issue_key  TEXT,
        at         INTEGER NOT NULL,
        title      TEXT NOT NULL,
        markdown   TEXT NOT NULL
    );
    CREATE INDEX idx_artifacts_issue ON artifacts(root, issue_key, at);",
    // 3 — test runs with per-test results (docs/v2/UI-AUDIT.md item 3, TEST-03): the history
    //     the Testing pane computes trends and flaky tests from
    "CREATE TABLE test_runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        root         TEXT NOT NULL,
        at           INTEGER NOT NULL,
        runner       TEXT NOT NULL,
        command      TEXT NOT NULL,
        scope        TEXT NOT NULL,
        ok           INTEGER NOT NULL,
        duration_ms  INTEGER NOT NULL,
        passed       INTEGER NOT NULL,
        failed       INTEGER NOT NULL,
        skipped      INTEGER NOT NULL
    );
    CREATE INDEX idx_test_runs_root ON test_runs(root, at);
    CREATE TABLE test_cases (
        run_id       INTEGER NOT NULL,
        case_id      TEXT NOT NULL,
        name         TEXT NOT NULL,
        suite        TEXT NOT NULL,
        status       TEXT NOT NULL,
        duration_ms  INTEGER,
        message      TEXT
    );
    CREATE INDEX idx_test_cases_run ON test_cases(run_id);
    CREATE INDEX idx_test_cases_case ON test_cases(case_id);",
    // 4 — the gutter's breakpoints per workspace (docs/v2/UI-AUDIT.md item 4, DBG-03): line,
    //     condition, hit count, log message (logpoint), on/off — kept across restarts
    "CREATE TABLE breakpoints (
        root           TEXT NOT NULL,
        file           TEXT NOT NULL,
        line           INTEGER NOT NULL,
        condition      TEXT,
        hit_condition  TEXT,
        log_message    TEXT,
        enabled        INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (root, file, line)
    );",
    // 5 — the audit log of Co-Dev (RF-T01, docs/v2/RF-DELONIX-PLANO.md F1.2): one row per
    //     decision on an action, per mode change and per turn, with the human request it
    //     answered. Secrets are masked by the writer (RF-T05).
    "CREATE TABLE audit (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        root        TEXT NOT NULL,
        at          INTEGER NOT NULL,
        session     TEXT NOT NULL,
        event       TEXT NOT NULL,
        origin      TEXT NOT NULL,
        issue_key   TEXT,
        actor       TEXT NOT NULL,
        mode        TEXT NOT NULL,
        tool        TEXT,
        call        TEXT,
        path        TEXT,
        lines       TEXT,
        command     TEXT,
        verdict     TEXT,
        outcome     TEXT,
        decided_by  TEXT,
        decided_at  INTEGER,
        reason      TEXT,
        model       TEXT,
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        driver      TEXT
    );
    CREATE INDEX idx_audit_issue ON audit(root, issue_key, at);
    CREATE INDEX idx_audit_session ON audit(session, at);",
    // 6 — the user story Co-Dev works on (RF-B01/B02/B04/B06/B07, docs/v2/RF-DELONIX-PLANO.md
    //     F4): «As / I want / So that», the file scope and the dependencies, who approved the
    //     Definition of Ready, failed test attempts, the criteria table Co-Dev answered and the
    //     prompt template version it used; and the cost of each turn in the audit log (RF-T04)
    "ALTER TABLE issues ADD COLUMN story_as TEXT NOT NULL DEFAULT '';
    ALTER TABLE issues ADD COLUMN story_want TEXT NOT NULL DEFAULT '';
    ALTER TABLE issues ADD COLUMN story_so TEXT NOT NULL DEFAULT '';
    ALTER TABLE issues ADD COLUMN scope TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE issues ADD COLUMN deps TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE issues ADD COLUMN ready_by TEXT;
    ALTER TABLE issues ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE issues ADD COLUMN criteria_report TEXT;
    ALTER TABLE issues ADD COLUMN template_version TEXT;
    ALTER TABLE audit ADD COLUMN cost_usd REAL;",
    // 7 — budgets (RF-T03, docs/v2/RF-DELONIX-PLANO.md F6.1): dollars per issue and per sprint;
    //     what was spent is the sum of the real cost of the turns in the audit log
    "ALTER TABLE issues ADD COLUMN budget_usd REAL;
    ALTER TABLE sprints ADD COLUMN budget_usd REAL;",
    // 8 — test results per commit (r23 F3, UI-SCM-09): what the Testing pane ran on which commit, so a
    //     commit's lifecycle shows real results (`dirty`: the working tree had uncommitted changes)
    "CREATE TABLE test_results (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        root     TEXT NOT NULL,
        sha      TEXT NOT NULL,
        dirty    INTEGER NOT NULL DEFAULT 0,
        at       INTEGER NOT NULL,
        runner   TEXT NOT NULL,
        command  TEXT NOT NULL,
        passed   INTEGER NOT NULL DEFAULT 0,
        failed   INTEGER NOT NULL DEFAULT 0,
        ignored  INTEGER NOT NULL DEFAULT 0,
        ok       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_test_results_sha ON test_results(root, sha, at);",
    // 9 — triggered breakpoints and breakpoint groups (r23 F2, UI-DBG-10): `trigger_on` is the
    //     breakpoint (`file:line`, relative) that arms this one; `grp` the scenario it belongs to
    "ALTER TABLE breakpoints ADD COLUMN trigger_on TEXT;
    ALTER TABLE breakpoints ADD COLUMN grp TEXT;",
    // 10 — accepted IaC risks and ignored drift (r23 F4b, P03/P04): a finding of the IaC pipeline (or
    //      a drifted resource) accepted with a reason until `expires` (at most 30 days); revoking
    //      expires it now, so the history stays
    "CREATE TABLE iac_accepted (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        root     TEXT NOT NULL,
        key      TEXT NOT NULL,
        kind     TEXT NOT NULL,
        label    TEXT NOT NULL DEFAULT '',
        reason   TEXT NOT NULL,
        actor    TEXT NOT NULL,
        at       INTEGER NOT NULL,
        expires  INTEGER NOT NULL
    );
    CREATE INDEX idx_iac_accepted ON iac_accepted(root, expires);",
    // 11 — deploy records (r23 F4c2, D04): each rollout of the guided deploy, ok or not — commit, issue,
    //      environment, cluster, who deployed and who approved, the checks and the waivers (JSON)
    "CREATE TABLE deploys (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        root        TEXT NOT NULL,
        env         TEXT NOT NULL,
        context     TEXT NOT NULL,
        namespace   TEXT NOT NULL,
        version     TEXT NOT NULL,
        issue_key   TEXT,
        actor       TEXT NOT NULL,
        approver    TEXT,
        at          INTEGER NOT NULL,
        ok          INTEGER NOT NULL,
        failed_step TEXT,
        waivers     TEXT NOT NULL DEFAULT '[]',
        gates       TEXT NOT NULL DEFAULT '{}',
        reason      TEXT
    );
    CREATE INDEX idx_deploys_version ON deploys(root, version, at);",
    // 12 — runbook runs (r23 F5a, RF-BK-R02): each step run or decided — command, output (masked),
    //      exit code, result against the expectation (or the person's judgement), who and when
    "CREATE TABLE runbook_runs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        root      TEXT NOT NULL,
        run_id    TEXT NOT NULL,
        path      TEXT NOT NULL,
        runbook   TEXT NOT NULL,
        n         INTEGER NOT NULL,
        title     TEXT NOT NULL,
        kind      TEXT NOT NULL,
        command   TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        output    TEXT NOT NULL DEFAULT '',
        expect    TEXT NOT NULL DEFAULT '',
        matched   INTEGER,
        note      TEXT,
        actor     TEXT NOT NULL,
        at        INTEGER NOT NULL,
        ms        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_runbook_runs ON runbook_runs(root, path, at);",
    // 13 — incidents (local records, owner decision §5 Q9) with their timeline, and the queue's events: an item
    //      verified done (with its proof) or handed over (recipient and reason) — r23 F5b, Q01/Q02, A01–A03
    "CREATE TABLE incidents (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        root         TEXT NOT NULL,
        key          TEXT NOT NULL,
        title        TEXT NOT NULL,
        severity     TEXT NOT NULL,
        status       TEXT NOT NULL,
        commander    TEXT NOT NULL,
        opened_at    INTEGER NOT NULL,
        mitigated_at INTEGER,
        resolved_at  INTEGER
    );
    CREATE INDEX idx_incidents ON incidents(root, opened_at);
    CREATE TABLE incident_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id INTEGER NOT NULL REFERENCES incidents(id),
        kind        TEXT NOT NULL,
        text        TEXT NOT NULL,
        reason      TEXT,
        actor       TEXT NOT NULL,
        at          INTEGER NOT NULL
    );
    CREATE INDEX idx_incident_events ON incident_events(incident_id, at);
    CREATE TABLE queue_events (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        root      TEXT NOT NULL,
        item      TEXT NOT NULL,
        kind      TEXT NOT NULL,
        title     TEXT NOT NULL,
        proof     TEXT,
        recipient TEXT,
        reason    TEXT,
        actor     TEXT NOT NULL,
        at        INTEGER NOT NULL
    );
    CREATE INDEX idx_queue_events ON queue_events(root, at);",
    // 14 — how many Co-Devs work the sprint at the same time (Multi Co-Dev, phase 1: the parallel
    //      plan); `NULL`: not set (one)
    "ALTER TABLE sprints ADD COLUMN codevs INTEGER;",
    // 15 — Multi Co-Dev, phase 2 (the integration gate's data): the project's mandatory checks
    //      (`[{name, command}]` in JSON; `NULL`: not set — the detected test command) and the
    //      functional approval recorded on an issue (who, when, the note)
    "ALTER TABLE projects ADD COLUMN checks TEXT;
    ALTER TABLE issues ADD COLUMN functional_by TEXT;
    ALTER TABLE issues ADD COLUMN functional_at INTEGER;
    ALTER TABLE issues ADD COLUMN functional_note TEXT;",
    // 16 — the history the sprint metrics read (Board A: honest burndown, velocity and insights): who joined
    //      or left a sprint and when, with the estimate at that moment; every estimate change with the old and
    //      the new points; what a sprint committed to when it started and what it held when it closed (`kind`
    //      `start | close`); when each sprint really started and closed. Nothing is back-filled: a sprint that
    //      started before this migration has no `started_at` and its reports say they are partial;
    //      `projects.history_since` is when this recording began for the project.
    "CREATE TABLE sprint_scope (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        root    TEXT NOT NULL,
        sprint  TEXT NOT NULL,
        key     TEXT NOT NULL,
        at      INTEGER NOT NULL,
        change  TEXT NOT NULL,
        points  INTEGER,
        reason  TEXT NOT NULL,
        actor   TEXT NOT NULL
    );
    CREATE INDEX idx_sprint_scope ON sprint_scope(root, sprint, at);
    CREATE TABLE estimate_changes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        root        TEXT NOT NULL,
        key         TEXT NOT NULL,
        at          INTEGER NOT NULL,
        old_points  INTEGER,
        new_points  INTEGER,
        sprint      TEXT,
        actor       TEXT NOT NULL
    );
    CREATE INDEX idx_estimate_changes ON estimate_changes(root, key, at);
    CREATE TABLE sprint_snapshots (
        root    TEXT NOT NULL,
        sprint  TEXT NOT NULL,
        kind    TEXT NOT NULL,
        key     TEXT NOT NULL,
        points  INTEGER,
        state   TEXT NOT NULL,
        at      INTEGER NOT NULL,
        PRIMARY KEY (root, sprint, kind, key)
    );
    ALTER TABLE sprints ADD COLUMN started_at INTEGER;
    ALTER TABLE sprints ADD COLUMN closed_at INTEGER;
    ALTER TABLE projects ADD COLUMN history_since INTEGER;
    UPDATE projects SET history_since = CAST(strftime('%s', 'now') AS INTEGER) * 1000;",
    // 17 — the project's own Definition of Ready ticked per issue (Board B): one flag per item of
    //      `projects.dor`, like `dod_done`; readiness lists the items not ticked
    "ALTER TABLE issues ADD COLUMN dor_done TEXT NOT NULL DEFAULT '[]';",
    // 18 — Multi Co-Dev, phase 3: the files each Co-Dev session claims (`claims`). One owner per
    //      path of a project: the session that wrote it first (with its issue, the app's process and
    //      when); another session's write to it is refused until the owner closes. A claim whose
    //      session is gone (closed elsewhere, the app crashed) is abandoned and taken over.
    "CREATE TABLE file_claims (
        root       TEXT NOT NULL,
        path       TEXT NOT NULL,
        session    TEXT NOT NULL,
        issue_key  TEXT,
        pid        INTEGER NOT NULL,
        at         INTEGER NOT NULL,
        PRIMARY KEY (root, path)
    );
    CREATE INDEX idx_file_claims_session ON file_claims(root, session);",
];

/// The schema version this code expects.
pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

fn current(conn: &Connection) -> rusqlite::Result<u32> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")?;
    let v: Option<u32> = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .unwrap_or(None);
    Ok(v.unwrap_or(0))
}

/// Brings the base to [`SCHEMA_VERSION`]. A base newer than this code is refused rather
/// than written with an older model.
pub fn migrate(conn: &mut Connection) -> Result<(), String> {
    let from = current(conn).map_err(|e| e.to_string())?;
    if from > SCHEMA_VERSION {
        return Err(format!(
            "the project database is newer (schema {from}) than this app (schema {SCHEMA_VERSION}): update the app"
        ));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(from as usize) {
        let v = i as u32 + 1;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if v == 1 {
            set_legacy_aside(&tx).map_err(|e| format!("migration 1 (legacy board): {e}"))?;
        }
        tx.execute_batch(sql)
            .map_err(|e| format!("migration {v}: {e}"))?;
        if v == 1 {
            import_legacy_board(&tx).map_err(|e| format!("migration 1 (legacy board): {e}"))?;
        }
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            params![v],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn has_table(tx: &rusqlite::Transaction, name: &str) -> rusqlite::Result<bool> {
    Ok(tx.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        params![name],
        |r| r.get::<_, i64>(0),
    )? > 0)
}

/// The first Board store used the names `boards`/`sprints`/`stories`; `sprints` clashes with
/// the new model, so they are renamed `legacy_*` before migration 1 creates its tables.
fn set_legacy_aside(tx: &rusqlite::Transaction) -> rusqlite::Result<()> {
    if !has_table(tx, "stories")? {
        return Ok(());
    }
    for t in ["boards", "sprints", "stories"] {
        if has_table(tx, t)? {
            tx.execute_batch(&format!("ALTER TABLE {t} RENAME TO legacy_{t}"))?;
        }
    }
    tx.execute_batch("DROP INDEX IF EXISTS idx_stories_root")?;
    Ok(())
}

/// The first Board store (`boards`/`stories`, written by `board_save`) becomes issues of
/// the new model, once. Its stages map onto the five canonical states.
fn import_legacy_board(tx: &rusqlite::Transaction) -> rusqlite::Result<()> {
    if !has_table(tx, "legacy_stories")? {
        return Ok(());
    }
    let mut roots = tx.prepare("SELECT root, seq, updated FROM legacy_boards")?;
    let boards: Vec<(String, i64, i64)> = roots
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    drop(roots);
    for (root, seq, updated) in boards {
        tx.execute(
            "INSERT OR IGNORE INTO projects (root, key_prefix, seq, method, iter_days, wip, dor, dod, created, updated)
             VALUES (?1, 'DX', ?2, 'scrum', 14, '{}', '[]', '[]', ?3, ?3)",
            params![root, seq, updated],
        )?;
        let mut st = tx.prepare(
            "SELECT id, role, want, so_that, acceptance, points, stage, kind, note, branch, ord, sprint
             FROM legacy_stories WHERE root = ?1 ORDER BY ord",
        )?;
        type Row = (
            String,
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            String,
            Option<String>,
            i64,
            i64,
        );
        let rows: Vec<Row> = st
            .query_map(params![root], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ))
            })?
            .collect::<Result<_, _>>()?;
        drop(st);
        for (id, role, want, so_that, acc, points, stage, kind, note, branch, ord, _sprint) in rows
        {
            let state = match stage.as_str() {
                "dev" => "progress",
                "test" => "review",
                "func" => "accept",
                "done" => "done",
                _ => "todo",
            };
            let title = if role.is_empty() {
                want.clone()
            } else {
                format!("Como {role}, quero {want}")
            };
            let description = if so_that.is_empty() {
                note
            } else {
                format!("Para {so_that}.\n\n{note}").trim().to_string()
            };
            tx.execute(
                "INSERT OR IGNORE INTO issues (root, key, title, kind, priority, points, rank, state, ready, description, branch, created, updated)
                 VALUES (?1, ?2, ?3, ?4, 'medium', ?5, ?6, ?7, 1, ?8, ?9, ?10, ?10)",
                params![root, id, title, if kind == "fix" { "bug" } else { "story" }, points, ord as f64, state, description, branch, updated],
            )?;
            let items: Vec<String> = serde_json::from_str(&acc).unwrap_or_default();
            for (k, text) in items.iter().enumerate() {
                tx.execute(
                    "INSERT OR IGNORE INTO acceptance (root, key, ord, text, done) VALUES (?1, ?2, ?3, ?4, 0)",
                    params![root, id, k as i64, text],
                )?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A base at schema 15 (before the sprint history) gains it without back-filling: the
    /// project records from the migration on, its sprints have no start or close recorded.
    #[test]
    fn the_sprint_history_starts_at_migration_16_and_invents_nothing() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE schema_version (version INTEGER NOT NULL)")
            .unwrap();
        for (i, sql) in MIGRATIONS.iter().take(15).enumerate() {
            c.execute_batch(sql).unwrap();
            c.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                params![i as u32 + 1],
            )
            .unwrap();
        }
        c.execute_batch(
            "INSERT INTO projects (root, key_prefix, seq, method, iter_days, wip, dor, dod, created, updated)
             VALUES ('/p', 'P', 0, 'scrum', 14, '{}', '[]', '[]', 1, 1);
             INSERT INTO sprints (root, id, name, goal, start, end, state) VALUES ('/p', 'S1', 'S', '', 1, 2, 'active');",
        )
        .unwrap();
        migrate(&mut c).unwrap();
        let since: Option<i64> = c
            .query_row("SELECT history_since FROM projects", [], |r| r.get(0))
            .unwrap();
        assert!(since.is_some_and(|t| t > 1_700_000_000_000), "{since:?}");
        let (started, closed): (Option<i64>, Option<i64>) = c
            .query_row("SELECT started_at, closed_at FROM sprints", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((started, closed), (None, None));
        for t in ["sprint_scope", "estimate_changes", "sprint_snapshots"] {
            let n: i64 = c
                .query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{t} is not back-filled");
        }
    }
}
