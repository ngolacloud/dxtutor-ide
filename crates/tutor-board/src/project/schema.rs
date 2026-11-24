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
