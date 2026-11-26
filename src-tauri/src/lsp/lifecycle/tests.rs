//! LSP P6 against a fake language server: a small Python script that speaks the protocol and writes
//! each message it gets (and how it ended) to a log file.

use super::*;
use std::path::PathBuf;

/// The fake server: `python3 -I fake.py <log> <mode>`. Modes: `""` behaves; `deaf` answers neither
/// `shutdown` nor `exit`, ignores the end of its input and starts a child (`sleep`) whose pid it
/// writes — it must be killed with it; `crash` exits with code 3 on `fake/crash`.
const FAKE: &str = r#"
import json, os, subprocess, sys, time
log = open(sys.argv[1], "a", buffering=1)
mode = sys.argv[2] if len(sys.argv) > 2 else ""
log.write("pid %d\n" % os.getpid())
sys.stderr.write("fake starting token=ghp_" + "a" * 36 + "\n")
sys.stderr.flush()
sys.stderr.buffer.write(b"caf\xc3")  # an "é" split across two writes
sys.stderr.buffer.flush()
time.sleep(0.05)
sys.stderr.buffer.write(b"\xa9 done\n")
sys.stderr.buffer.flush()
if mode == "deaf":
    kid = subprocess.Popen(["sleep", "300"])
    log.write("child %d\n" % kid.pid)
inp, out = sys.stdin.buffer, sys.stdout.buffer
def read():
    n = None
    while True:
        line = inp.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        k, v = line.split(b":", 1)
        if k.lower() == b"content-length":
            n = int(v)
    return json.loads(inp.read(n))
def send(o):
    b = json.dumps(o).encode()
    out.write(b"Content-Length: %d\r\n\r\n" % len(b) + b)
    out.flush()
while True:
    m = read()
    if m is None:
        log.write("eof\n")
        if mode == "deaf":
            time.sleep(300)
        break
    meth = m.get("method", "")
    doc = (m.get("params") or {}).get("textDocument") or {}
    log.write(meth + (" " + doc["uri"] if meth.startswith("textDocument/did") and "uri" in doc else "") + "\n")
    if meth == "initialize":
        send({"jsonrpc": "2.0", "id": m["id"], "result": {"capabilities": {"hoverProvider": True}}})
        send({"jsonrpc": "2.0", "method": "window/logMessage", "params": {"type": 1, "message": "boom password=hunter22"}})
        send({"jsonrpc": "2.0", "method": "window/logMessage", "params": {"type": 4, "message": "chatter"}})
    elif meth == "shutdown":
        if mode != "deaf":
            send({"jsonrpc": "2.0", "id": m["id"], "result": None})
    elif meth == "exit":
        if mode != "deaf":
            log.write("bye\n")
            sys.exit(0)
    elif meth == "fake/crash" and mode == "crash":
        sys.exit(3)
    elif "id" in m:
        send({"jsonrpc": "2.0", "id": m["id"], "result": None})
"#;

struct Fake {
    dir: tempfile::TempDir,
    script: PathBuf,
}

fn fake() -> Fake {
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("fake.py");
    std::fs::write(&script, FAKE).unwrap();
    Fake { dir, script }
}

type Events = Arc<Mutex<Vec<(String, Value)>>>;

fn recorder() -> (Emit, Events) {
    let got: Events = Arc::default();
    let g = got.clone();
    let emit: Emit = Arc::new(move |e: &str, v: Value| g.lock().unwrap().push((e.to_string(), v)));
    (emit, got)
}

fn lang(id: &str) -> Lang {
    let server: Server = serde_json::from_value(json!({
        "id": id, "name": "Fake", "label": format!("fake-{id}"), "command": "python3"
    }))
    .unwrap();
    Lang::of(&server, None, effective(None))
}

/// A started fake server: its session key, session and log file.
struct Started {
    key: String,
    session: Arc<Mutex<Session>>,
    log: PathBuf,
    root: String,
}

fn start(map: &SessionMap, emit: &Emit, f: &Fake, id: &str, mode: &str) -> Started {
    let root = f.dir.path().join(id);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.display().to_string();
    let log = f.dir.path().join(format!("{id}.log"));
    let l = lang(id);
    let key = session_key(&l, &root);
    let args = vec![
        "-I".to_string(),
        f.script.display().to_string(),
        log.display().to_string(),
        mode.to_string(),
    ];
    let session = get_or_start(map, emit, &key, &root, &l, "python3", &args).unwrap();
    Started {
        key,
        session,
        log,
        root,
    }
}

fn lines(p: &Path) -> Vec<String> {
    std::fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .map(String::from)
        .collect()
}

fn wait_until(mut ok: impl FnMut() -> bool, max: Duration) -> bool {
    let t0 = Instant::now();
    while t0.elapsed() < max {
        if ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    ok()
}

/// The pid the fake wrote after `tag` (`pid`, `child`).
fn pid_in(log: &Path, tag: &str) -> u32 {
    let mut found = None;
    wait_until(
        || {
            found = lines(log)
                .iter()
                .find_map(|l| l.strip_prefix(&format!("{tag} "))?.parse().ok());
            found.is_some()
        },
        Duration::from_secs(5),
    );
    found.unwrap_or_else(|| panic!("no `{tag}` in {:?}", lines(log)))
}

/// The process is gone (or a zombie someone else reaps).
fn gone(pid: u32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Err(_) => true,
        Ok(stat) => stat
            .rsplit_once(')')
            .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z')),
    }
}

fn in_map(map: &SessionMap, key: &str) -> bool {
    map.lock().unwrap().contains_key(key)
}

/// The events of one kind in a server's log (`started`, `stopped`, …).
fn events(key: &str, code: &str) -> Vec<LogLine> {
    log_of(Some(key))
        .into_iter()
        .filter(|l| l.code == Some(code))
        .collect()
}

fn set_idle(s: &Arc<Mutex<Session>>, ago: Duration) {
    let mut g = s.lock().unwrap();
    g.last_used = Instant::now().checked_sub(ago).unwrap_or(g.started);
}

const NO_LIMITS: Limits = Limits {
    idle: None,
    max: 32,
};

#[test]
fn a_stop_sends_shutdown_then_exit_and_reaps_the_server() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, got) = recorder();
    let s = start(&map, &emit, &f, "stop", "");
    let pid = pid_in(&s.log, "pid");
    assert_eq!(s.session.lock().unwrap().pid, Some(pid));
    detach(&map, &s.key, &s.session);
    let t0 = Instant::now();
    shutdown(&s.session, Reason::User);
    assert!(
        t0.elapsed() < SHUTDOWN_WAIT,
        "a polite server is not waited for"
    );
    let l = lines(&s.log);
    let at = |m: &str| {
        l.iter()
            .position(|x| x == m)
            .unwrap_or_else(|| panic!("no {m} in {l:?}"))
    };
    assert!(at("initialize") < at("initialized"));
    assert!(at("initialized") < at("shutdown"));
    assert!(at("shutdown") < at("exit"));
    assert!(l.contains(&"bye".to_string()), "it exited on `exit`");
    // reaped by us: not even a zombie is left
    assert!(
        !Path::new(&format!("/proc/{pid}")).exists(),
        "pid {pid} still exists"
    );
    let g = s.session.lock().unwrap();
    assert!(g.stopping && g.pid.is_none() && g.child.is_none());
    drop(g);
    // nothing more is sent to it, and a second stop does nothing
    assert!(session_request(&s.session, "textDocument/hover", json!({})).is_err());
    shutdown(&s.session, Reason::User);
    let stopped = events(&s.key, "stopped");
    assert_eq!(stopped.len(), 1);
    assert_eq!(stopped[0].detail["reason"], "user");
    assert_eq!(stopped[0].detail["answered"], true);
    assert!(got
        .lock()
        .unwrap()
        .iter()
        .any(|(e, _)| e == "lsp://servers"));
}

#[test]
fn a_server_that_ignores_shutdown_and_exit_is_killed_with_what_it_started() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, _) = recorder();
    let s = start(&map, &emit, &f, "deaf", "deaf");
    let pid = pid_in(&s.log, "pid");
    let kid = pid_in(&s.log, "child");
    assert!(!gone(kid));
    detach(&map, &s.key, &s.session);
    let t0 = Instant::now();
    shutdown(&s.session, Reason::Idle);
    let took = t0.elapsed();
    assert!(
        took >= SHUTDOWN_WAIT && took < SHUTDOWN_WAIT + EXIT_WAIT + Duration::from_secs(2),
        "{took:?}"
    );
    assert!(!Path::new(&format!("/proc/{pid}")).exists());
    // its child went with it (the process group), and someone reaps it
    assert!(
        wait_until(|| gone(kid), Duration::from_secs(3)),
        "child {kid} survived"
    );
    let l = lines(&s.log);
    assert!(
        l.contains(&"shutdown".into()) && l.contains(&"exit".into()),
        "{l:?}"
    );
    let killed = events(&s.key, "killed");
    assert_eq!(killed.len(), 1, "{:?}", log_of(Some(&s.key)));
    assert_eq!(killed[0].detail["reason"], "idle");
}

#[test]
fn did_close_goes_to_the_sessions_that_have_the_file_and_forgets_it() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, _) = recorder();
    let s = start(&map, &emit, &f, "close", "");
    let other = start(&map, &emit, &f, "close2", "");
    let path = format!("{}/main.fake", s.root);
    docs().lock().unwrap().insert(
        path.clone(),
        OpenDoc {
            language_id: "fake".into(),
            version: 1,
            text: "x".into(),
        },
    );
    assert!(ensure_doc_open(&s.session, &path).unwrap());
    let uri = path_to_uri(&path);
    assert!(s.session.lock().unwrap().open.contains(&uri));
    assert_eq!(
        close_document(&map, &path),
        1,
        "only the session that had it"
    );
    assert!(s.session.lock().unwrap().open.is_empty());
    assert!(!docs().lock().unwrap().contains_key(&path));
    assert!(wait_until(
        || lines(&s.log).contains(&format!("textDocument/didClose {uri}")),
        Duration::from_secs(3)
    ));
    let l = lines(&s.log);
    let open_at = l
        .iter()
        .position(|x| x.starts_with("textDocument/didOpen"))
        .unwrap();
    let close_at = l
        .iter()
        .position(|x| x.starts_with("textDocument/didClose"))
        .unwrap();
    assert!(open_at < close_at);
    assert!(!lines(&other.log).iter().any(|x| x.contains("didClose")));
    // closed twice: nothing more is sent
    assert_eq!(close_document(&map, &path), 0);
    stop_all(&map, Reason::AppExit);
}

#[test]
fn an_idle_server_stops_but_not_one_with_open_files_nor_one_in_use() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, _) = recorder();
    let idle = start(&map, &emit, &f, "idle", "");
    let busy = start(&map, &emit, &f, "busy", "");
    let used = start(&map, &emit, &f, "used", "");
    busy.session
        .lock()
        .unwrap()
        .open
        .insert("file:///x/open.fake".into());
    set_idle(&idle.session, Duration::from_secs(11 * 60));
    set_idle(&busy.session, Duration::from_secs(11 * 60));
    set_idle(&used.session, Duration::from_secs(9 * 60));
    let limits = Limits {
        idle: Some(Duration::from_secs(10 * 60)),
        max: 6,
    };
    let (stops, over) = select_stops(&map, Instant::now(), limits, None);
    assert_eq!(over, None);
    assert_eq!(stops.len(), 1);
    assert!(Arc::ptr_eq(&stops[0].0, &idle.session));
    assert_eq!(stops[0].1, Reason::Idle);
    assert!(!in_map(&map, &idle.key) && in_map(&map, &busy.key) && in_map(&map, &used.key));
    for (s, why) in stops {
        shutdown(&s, why);
    }
    assert!(lines(&idle.log).contains(&"exit".into()));
    // no idle time set: nothing stops for being idle
    set_idle(&used.session, Duration::from_secs(11 * 60));
    let (stops, _) = select_stops(&map, Instant::now(), NO_LIMITS, None);
    assert!(stops.is_empty());
    // a server handed out for a request is in use again (touched under the map's lock)
    let l = lang("used");
    let again = get_or_start(&map, &emit, &used.key, &used.root, &l, "python3", &[]).unwrap();
    assert!(
        Arc::ptr_eq(&again, &used.session),
        "the running one, not a new one"
    );
    let (stops, _) = select_stops(&map, Instant::now(), limits, None);
    assert!(stops.is_empty());
    stop_all(&map, Reason::AppExit);
    assert!(map.lock().unwrap().is_empty());
}

#[test]
fn over_the_cap_the_least_recently_used_without_open_files_stops_and_never_one_with_them() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, got) = recorder();
    let a = start(&map, &emit, &f, "cap-a", ""); // open files, the oldest
    let b = start(&map, &emit, &f, "cap-b", ""); // no files, older
    let c = start(&map, &emit, &f, "cap-c", ""); // no files, newer
    a.session.lock().unwrap().open.insert("file:///a".into());
    set_idle(&a.session, Duration::from_secs(300));
    set_idle(&b.session, Duration::from_secs(200));
    set_idle(&c.session, Duration::from_secs(100));
    let cap2 = Limits { idle: None, max: 2 };
    for h in enforce(&map, &emit, cap2, None, true) {
        h.join().unwrap();
    }
    assert!(in_map(&map, &a.key) && !in_map(&map, &b.key) && in_map(&map, &c.key));
    assert_eq!(events(&b.key, "stopped")[0].detail["reason"], "limit");
    // the one just started is never the one that goes
    let d = start(&map, &emit, &f, "cap-d", "");
    set_idle(&d.session, Duration::from_secs(900));
    for h in enforce(&map, &emit, cap2, Some(&d.key), true) {
        h.join().unwrap();
    }
    assert!(in_map(&map, &a.key) && !in_map(&map, &c.key) && in_map(&map, &d.key));
    // every one left has open files: none stops, and it is said
    d.session.lock().unwrap().open.insert("file:///d".into());
    let e = start(&map, &emit, &f, "cap-e", "");
    e.session.lock().unwrap().open.insert("file:///e".into());
    got.lock().unwrap().clear();
    let handles = enforce(&map, &emit, cap2, Some(&e.key), true);
    assert!(handles.is_empty());
    assert_eq!(map.lock().unwrap().len(), 3);
    let limit = got
        .lock()
        .unwrap()
        .iter()
        .find(|(ev, _)| ev == "lsp://limit")
        .map(|(_, v)| v.clone())
        .expect("lsp://limit");
    assert_eq!(limit["running"], 3);
    assert_eq!(limit["max"], 2);
    assert_eq!(events(&e.key, "over-limit").len(), 1);
    // the periodic tick does not repeat it
    got.lock().unwrap().clear();
    assert!(enforce(&map, &emit, cap2, None, false).is_empty());
    assert!(!got
        .lock()
        .unwrap()
        .iter()
        .any(|(ev, _)| ev == "lsp://limit"));
    stop_all(&map, Reason::AppExit);
}

#[test]
fn a_stopped_server_starts_again_on_the_next_use_initialized_before_it_is_handed_out() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, _) = recorder();
    let s = start(&map, &emit, &f, "again", "");
    let first = pid_in(&s.log, "pid");
    stop_key(&map, &s.key).unwrap();
    assert!(!in_map(&map, &s.key));
    assert!(stop_key(&map, &s.key).is_err(), "not running any more");
    // several requests at once: ONE new server, and each gets it only after `initialize`
    let l = lang("again");
    let args = vec![
        "-I".to_string(),
        f.script.display().to_string(),
        s.log.display().to_string(),
        String::new(),
    ];
    let got: Vec<Arc<Mutex<Session>>> = thread::scope(|sc| {
        let jobs: Vec<_> = (0..4)
            .map(|_| {
                sc.spawn(|| {
                    get_or_start(&map, &emit, &s.key, &s.root, &l, "python3", &args).unwrap()
                })
            })
            .collect();
        jobs.into_iter().map(|j| j.join().unwrap()).collect()
    });
    for g in &got {
        let x = g.lock().unwrap();
        assert!(
            x.initialized && x.handshaken && !x.stopping,
            "handed out before initialize"
        );
    }
    let live = map.lock().unwrap().get(&s.key).cloned().unwrap();
    assert!(
        got.iter().all(|g| Arc::ptr_eq(g, &live)),
        "one session for the key"
    );
    let second = live.lock().unwrap().pid.unwrap();
    assert_ne!(first, second);
    // the log: the old one ended (shutdown, exit) before the new one's first message
    assert!(wait_until(
        || lines(&s.log).iter().filter(|x| *x == "initialized").count() >= 2,
        Duration::from_secs(5)
    ));
    let l = lines(&s.log);
    let bye = l.iter().position(|x| x == "bye").unwrap();
    let starts: Vec<usize> = l
        .iter()
        .enumerate()
        .filter(|(_, x)| *x == "initialize")
        .map(|(i, _)| i)
        .collect();
    assert_eq!(
        starts.len(),
        2,
        "one new server, not one per request: {l:?}"
    );
    assert_eq!(
        l.iter().filter(|x| x.starts_with("pid ")).count(),
        2,
        "{l:?}"
    );
    assert!(starts[1] > bye);
    stop_all(&map, Reason::AppExit);
}

#[test]
fn a_server_that_dies_leaves_the_map_is_reaped_and_says_so() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, got) = recorder();
    let s = start(&map, &emit, &f, "crash", "crash");
    let pid = pid_in(&s.log, "pid");
    let _ = session_notify(&s.session, "fake/crash", json!({}));
    assert!(wait_until(|| !in_map(&map, &s.key), Duration::from_secs(5)));
    assert!(wait_until(
        || !Path::new(&format!("/proc/{pid}")).exists(),
        Duration::from_secs(3)
    ));
    let crashed = events(&s.key, "crashed");
    assert_eq!(crashed.len(), 1);
    assert_eq!(crashed[0].detail["exitCode"], 3);
    assert!(session_request(&s.session, "x", json!({})).is_err());
    assert!(got
        .lock()
        .unwrap()
        .iter()
        .any(|(e, _)| e == "lsp://servers"));
}

#[test]
fn stderr_and_log_messages_are_kept_masked_and_sent_to_the_ui() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, got) = recorder();
    let s = start(&map, &emit, &f, "logs", "");
    assert!(wait_until(
        || {
            // the stderr thread and the stdout reader write independently: wait for both
            let l = log_of(Some(&s.key));
            l.iter().any(|l| l.text.contains("done")) && l.iter().any(|l| l.kind == "log")
        },
        Duration::from_secs(5)
    ));
    let all = log_of(Some(&s.key));
    let text: Vec<&str> = all.iter().map(|l| l.text.as_str()).collect();
    assert!(
        text.iter().any(|t| t.starts_with("fake starting")),
        "{text:?}"
    );
    assert!(
        !text.iter().any(|t| t.contains("ghp_aaaa")),
        "masked: {text:?}"
    );
    assert!(text.contains(&"café done"), "UTF-8 kept whole: {text:?}");
    let log: Vec<&LogLine> = all.iter().filter(|l| l.kind == "log").collect();
    assert_eq!(log.len(), 1, "type 4 is chatter: {text:?}");
    assert!(log[0].text.starts_with("[error] boom") && !log[0].text.contains("hunter22"));
    assert_eq!(all[0].code, Some("started"));
    assert!(all.windows(2).all(|w| w[0].seq < w[1].seq));
    assert!(all
        .iter()
        .all(|l| l.server == "fake-logs" && l.root == s.root));
    // the UI heard the same lines
    let heard: usize = got
        .lock()
        .unwrap()
        .iter()
        .filter(|(e, _)| e == "lsp://log")
        .map(|(_, v)| v["lines"].as_array().map(Vec::len).unwrap_or(0))
        .sum();
    assert!(heard >= all.len());
    stop_all(&map, Reason::AppExit);
    // the log outlives the server (a crash can still be read)
    assert!(!events(&s.key, "stopped").is_empty());
}

#[test]
fn the_log_is_bounded_per_server_and_lines_are_cut() {
    let (emit, _) = recorder();
    let src = Source {
        key: "bounded\u{0}/r\u{0}".into(),
        server: "x".into(),
        root: "/r".into(),
        emit,
    };
    for i in 0..(LOG_LINES + 50) {
        src.write("stderr", vec![format!("line {i}")], None, Value::Null);
    }
    let l = log_of(Some(&src.key));
    assert_eq!(l.len(), LOG_LINES);
    assert_eq!(l[0].text, "line 50");
    src.write(
        "stderr",
        vec!["y".repeat(LOG_LINE_CHARS + 10)],
        None,
        Value::Null,
    );
    let last = log_of(Some(&src.key)).pop().unwrap();
    assert_eq!(last.text.chars().count(), LOG_LINE_CHARS + 1);
    assert!(last.text.ends_with('…'));
}

#[test]
fn stream_lines_join_split_characters_and_secrets_across_reads() {
    let mut l = Lines::new();
    let e = "é".as_bytes();
    assert!(l.push(b"caf").is_empty());
    assert!(l.push(&e[..1]).is_empty());
    assert_eq!(
        l.push(&[&e[1..], b" ok\nnext".as_slice()].concat()),
        ["café ok"]
    );
    // a token split across two reads is still masked
    let tok = format!("ghp_{}", "b".repeat(36));
    let (a, b) = tok.split_at(10);
    let mut out = l.push(format!(" {a}").as_bytes());
    out.extend(l.push(format!("{b}\n").as_bytes()));
    assert_eq!(out.len(), 1);
    assert!(
        out[0].starts_with("next ") && !out[0].contains("bbbbbbbb"),
        "{out:?}"
    );
    // an invalid byte is replaced; the rest at the end is kept
    let mut out = l.push(b"bad \xff byte\n");
    out.extend(l.push(b"tail"));
    out.extend(l.finish());
    assert_eq!(out, ["bad \u{FFFD} byte", "tail"]);
}

#[test]
fn closing_a_folder_stops_only_its_servers_and_forgets_its_files() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, _) = recorder();
    let mine = start(&map, &emit, &f, "folder-a", "");
    let theirs = start(&map, &emit, &f, "folder-b", "");
    let path = format!("{}/x.fake", mine.root);
    docs().lock().unwrap().insert(
        path.clone(),
        OpenDoc {
            language_id: "fake".into(),
            version: 1,
            text: String::new(),
        },
    );
    register_root(&mine.root);
    for h in close_folder(&map, &format!("{}/", mine.root)) {
        h.join().unwrap();
    }
    assert!(!in_map(&map, &mine.key) && in_map(&map, &theirs.key));
    assert!(lines(&mine.log).contains(&"exit".into()));
    assert!(!lines(&theirs.log).contains(&"exit".into()));
    assert!(!docs().lock().unwrap().contains_key(&path));
    assert!(!workspace_roots().lock().unwrap().contains(&mine.root));
    assert_eq!(events(&mine.key, "stopped")[0].detail["reason"], "folder");
    stop_all(&map, Reason::AppExit);
}

#[test]
fn the_list_shows_each_server_with_its_files_idle_time_and_memory() {
    let f = fake();
    let map = SessionMap::default();
    let (emit, _) = recorder();
    let s = start(&map, &emit, &f, "list", "");
    let path = format!("{}/a.fake", s.root);
    docs().lock().unwrap().insert(
        path.clone(),
        OpenDoc {
            language_id: "fake".into(),
            version: 1,
            text: String::new(),
        },
    );
    let limits = Limits {
        idle: Some(Duration::from_secs(600)),
        max: 4,
    };
    let v = list(&map, limits);
    assert_eq!((v.idle_minutes, v.max_servers), (10, 4));
    let x = &v.servers[0];
    assert_eq!((x.server.as_str(), x.label.as_str()), ("list", "fake-list"));
    assert_eq!(x.root, s.root);
    assert_eq!(x.pid, s.session.lock().unwrap().pid);
    assert_eq!(x.state, "ready");
    assert!(x.documents.is_empty());
    assert!(x.stops_in_secs.is_some_and(|t| t <= 600));
    #[cfg(target_os = "linux")]
    assert!(x.memory_kib.is_some_and(|k| k > 0), "{:?}", x.memory_kib);
    // with a file open: no idle countdown, the file listed
    ensure_doc_open(&s.session, &path).unwrap();
    let v = list(&map, limits);
    assert_eq!(v.servers[0].documents, [path.clone()]);
    assert_eq!(v.servers[0].stops_in_secs, None);
    close_document(&map, &path);
    stop_all(&map, Reason::AppExit);
    assert!(list(&map, limits).servers.is_empty());
}

#[test]
fn limits_come_from_the_resources_and_zero_means_never() {
    let l = Limits::of(&lspconf::Resources::default());
    assert_eq!(l.idle, Some(Duration::from_secs(600)));
    assert_eq!(l.max, 6);
    let l = Limits::of(&lspconf::Resources {
        idle_minutes: 0,
        max_servers: 3,
    });
    assert_eq!((l.idle, l.max), (None, 3));
}
