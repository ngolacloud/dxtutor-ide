//! The Project base is opened for an editor (measured: the rollback journal made two `fsync`s per commit, on the
//! UI thread): WAL, `synchronous=NORMAL`, a 5 s busy timeout — and the data survives reopening.
use tutor_board::project::ProjectStore;

#[test]
fn the_base_is_tuned_and_reopens() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("board.sqlite3");
    let s = ProjectStore::open(&path).unwrap();
    let c = s.conn();
    let mode: String = c
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    let sync: i64 = c.query_row("PRAGMA synchronous", [], |r| r.get(0)).unwrap();
    let busy: i64 = c
        .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
        .unwrap();
    let fk: i64 = c
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!((mode.as_str(), sync, busy, fk), ("wal", 1, 5000, 1));
    let tables: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(tables > 5, "migrated");
    c.execute_batch("CREATE TABLE probe (x INTEGER); INSERT INTO probe VALUES (42);")
        .unwrap();
    drop(s);
    // a second open (the schema is not migrated again) reads what the first wrote
    let s2 = ProjectStore::open(&path).unwrap();
    let x: i64 = s2
        .conn()
        .query_row("SELECT x FROM probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(x, 42);
    // two connections at once: the second writer waits instead of failing
    let s3 = ProjectStore::open(&path).unwrap();
    s2.conn()
        .execute_batch("BEGIN IMMEDIATE; INSERT INTO probe VALUES (1);")
        .unwrap();
    let t = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        s2.conn().execute_batch("COMMIT;").unwrap();
    });
    s3.conn()
        .execute("INSERT INTO probe VALUES (2)", [])
        .unwrap();
    t.join().unwrap();
    let n: i64 = s3
        .conn()
        .query_row("SELECT count(*) FROM probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 3);
}
