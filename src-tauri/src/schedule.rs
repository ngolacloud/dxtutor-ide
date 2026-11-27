//! H6c (docs/v2/AUDIT-harness.md §6): scheduled agents — a headless Co-Dev request (`headless::run`) that runs on its
//! own at a set time, through a `systemd --user` timer that calls this same binary (`agent schedule run <id>`).
//!
//! ```text
//! dxtutor-ide agent schedule add --name nightly-review --when daily@07:30 --cwd ~/src/shop -p "review yesterday's commits"
//!                                [--write] [--provider P] [--model M] [--effort E]
//! dxtutor-ide agent schedule list | run <id> | remove <id>
//! ```
//! Rules (here, not in a UI): a schedule is the PERSON's — it lives in the IDE's config (`schedules.json`), never in a
//! project file, so a repository can never make an agent run by itself; it is READ-ONLY by default (the plan mode,
//! where not even a plan is approved) and writes only with `--write` (then `auto` mode: the person's rules decide, and
//! whatever the policy asks is refused — nobody is there); each run is kept (`<data>/schedules/<id>/<time>.json`) and
//! goes to the project's audit log like any Co-Dev session; a desktop notification says how it ended, when
//! `notify-send` exists. `when` is `hourly`, `daily@HH:MM` or `weekly@Mon@HH:MM` (local time). `DXTUTOR_SYSTEMCTL`
//! points at another `systemctl` (the tests use a fake one).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::headless::{self, Args};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    /// `hourly`, `daily@HH:MM` or `weekly@Mon@HH:MM`
    pub when: String,
    pub cwd: String,
    pub prompt: String,
    #[serde(default)]
    pub write: bool,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    pub created: u64,
}

const DAYS: &[&str] = &["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

fn hhmm(s: &str) -> Result<(u8, u8), String> {
    let (h, m) = s
        .split_once(':')
        .ok_or_else(|| format!("«{s}» is not HH:MM"))?;
    let (h, m): (u8, u8) = (
        h.parse().map_err(|_| format!("«{s}» is not HH:MM"))?,
        m.parse().map_err(|_| format!("«{s}» is not HH:MM"))?,
    );
    if h > 23 || m > 59 {
        return Err(format!("«{s}» is not a time of day"));
    }
    Ok((h, m))
}

/// The systemd `OnCalendar=` of a `when` (only the forms above: nothing else reaches the unit file).
pub fn on_calendar(when: &str) -> Result<String, String> {
    let parts: Vec<&str> = when.trim().split('@').collect();
    match parts.as_slice() {
        ["hourly"] => Ok("hourly".into()),
        ["daily", t] => hhmm(t).map(|(h, m)| format!("*-*-* {h:02}:{m:02}:00")),
        ["weekly", d, t] if DAYS.contains(d) => {
            hhmm(t).map(|(h, m)| format!("{d} *-*-* {h:02}:{m:02}:00"))
        }
        _ => Err(format!(
            "«{when}»: use hourly, daily@HH:MM or weekly@Mon@HH:MM (Mon…Sun)"
        )),
    }
}

fn valid_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 40
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn store_file() -> PathBuf {
    headless::config_dir().join("schedules.json")
}

pub fn load() -> Vec<Schedule> {
    std::fs::read_to_string(store_file())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(all: &[Schedule]) -> Result<(), String> {
    let f = store_file();
    if let Some(d) = f.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    std::fs::write(&f, serde_json::to_string_pretty(all).unwrap_or_default())
        .map_err(|e| format!("{}: {e}", f.display()))
}

fn unit_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
        });
    base.join("systemd/user")
}

fn unit_name(id: &str) -> String {
    format!("dxtutor-agent-{id}")
}

fn systemctl(args: &[&str]) -> Result<(), String> {
    let prog = std::env::var("DXTUTOR_SYSTEMCTL").unwrap_or_else(|_| "systemctl".into());
    let o = std::process::Command::new(&prog)
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| format!("{prog}: {e} — scheduled agents need systemd --user"))?;
    if !o.status.success() {
        return Err(format!(
            "{prog} --user {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&o.stderr).trim()
        ));
    }
    Ok(())
}

/// The unit files of a schedule: the service runs this binary's `agent schedule run <id>`; the timer is persistent
/// (a run missed while the machine was off happens at the next start).
pub fn units(s: &Schedule, exe: &Path) -> Result<(String, String), String> {
    let cal = on_calendar(&s.when)?;
    let exe = exe.display().to_string();
    if exe.contains(char::is_whitespace) || exe.contains(['"', '\'', '\\', '%']) {
        return Err(format!(
            "the IDE's path «{exe}» has characters a unit file cannot hold"
        ));
    }
    let service = format!(
        "[Unit]\nDescription=dxtutor scheduled agent {name}\n\n[Service]\nType=oneshot\nExecStart={exe} agent schedule run {id}\nNice=10\n",
        name = s.name,
        id = s.id
    );
    let timer = format!(
        "[Unit]\nDescription=dxtutor scheduled agent {name}\n\n[Timer]\nOnCalendar={cal}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n",
        name = s.name
    );
    Ok((service, timer))
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Adds a schedule and installs its timer.
pub fn add(mut s: Schedule) -> Result<Schedule, String> {
    if !valid_name(&s.name) {
        return Err("--name: letters, digits, - and _ (at most 40)".into());
    }
    on_calendar(&s.when)?;
    if s.prompt.trim().is_empty() {
        return Err("a schedule needs a request (-p)".into());
    }
    let cwd = PathBuf::from(&s.cwd)
        .canonicalize()
        .map_err(|e| format!("--cwd {}: {e}", s.cwd))?;
    s.cwd = cwd.display().to_string();
    let mut all = load();
    if all.iter().any(|x| x.name == s.name) {
        return Err(format!(
            "a schedule named {} exists: remove it first",
            s.name
        ));
    }
    s.created = now();
    s.id = format!("{}-{:x}", s.name, s.created);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let (service, timer) = units(&s, &exe)?;
    let dir = unit_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = unit_name(&s.id);
    std::fs::write(dir.join(format!("{name}.service")), service).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{name}.timer")), timer).map_err(|e| e.to_string())?;
    let installed = systemctl(&["daemon-reload"])
        .and_then(|_| systemctl(&["enable", "--now", &format!("{name}.timer")]));
    if let Err(e) = installed {
        let _ = std::fs::remove_file(dir.join(format!("{name}.service")));
        let _ = std::fs::remove_file(dir.join(format!("{name}.timer")));
        return Err(e);
    }
    all.push(s.clone());
    save(&all)?;
    Ok(s)
}

/// Removes a schedule (by id or name): the timer stops, the units go; its kept runs stay.
pub fn remove(key: &str) -> Result<Schedule, String> {
    let mut all = load();
    let i = all
        .iter()
        .position(|s| s.id == key || s.name == key)
        .ok_or_else(|| format!("no schedule {key}"))?;
    let s = all.remove(i);
    let name = unit_name(&s.id);
    let _ = systemctl(&["disable", "--now", &format!("{name}.timer")]);
    let dir = unit_dir();
    let _ = std::fs::remove_file(dir.join(format!("{name}.service")));
    let _ = std::fs::remove_file(dir.join(format!("{name}.timer")));
    let _ = systemctl(&["daemon-reload"]);
    save(&all)?;
    Ok(s)
}

fn runs_dir(id: &str) -> PathBuf {
    headless::data_dir().join("schedules").join(id)
}

/// The kept runs of a schedule, newest first: (file stem = time, outcome).
pub fn runs(id: &str) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = std::fs::read_dir(runs_dir(id))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let t = std::fs::read_to_string(e.path()).ok()?;
                    let j: serde_json::Value = serde_json::from_str(&t).ok()?;
                    Some((
                        e.path().file_stem()?.to_string_lossy().to_string(),
                        j["outcome"].as_str().unwrap_or("?").to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v
}

/// Runs a schedule now (what its timer calls): headless, read-only unless `write`; the outcome is kept and notified.
pub fn run_now(key: &str) -> Result<headless::Outcome, String> {
    let s = load()
        .into_iter()
        .find(|s| s.id == key || s.name == key)
        .ok_or_else(|| format!("no schedule {key}"))?;
    let a = Args {
        cwd: Some(PathBuf::from(&s.cwd)),
        provider: s.provider.clone(),
        model: s.model.clone(),
        effort: s.effort.clone(),
        mode: "auto".into(),
        output: "json".into(),
        plan: !s.write,
        ..Default::default()
    };
    let out = headless::run(&a, &s.prompt, &mut |_| {});
    let dir = runs_dir(&s.id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let file = dir.join(format!("{}.json", now()));
    std::fs::write(
        &file,
        serde_json::to_string_pretty(&out).unwrap_or_default(),
    )
    .map_err(|e| format!("{}: {e}", file.display()))?;
    // best effort: a desktop notification of how it ended
    let summary: String = out
        .result
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(160)
        .collect();
    let _ = std::process::Command::new("notify-send")
        .args([&format!("dxtutor · {} — {}", s.name, out.outcome), &summary])
        .output();
    Ok(out)
}

fn value(args: &[String], i: &mut usize, name: &str) -> Result<String, String> {
    *i += 1;
    args.get(*i)
        .cloned()
        .ok_or_else(|| format!("{name} needs a value"))
}

const USAGE: &str =
    "usage: dxtutor-ide agent schedule add --name N --when hourly|daily@HH:MM|weekly@Mon@HH:MM \
--cwd DIR -p REQUEST [--write] [--provider P] [--model M] [--effort E]\n\
       dxtutor-ide agent schedule list | run <id|name> | remove <id|name>";

/// `agent schedule …`: the exit code.
pub fn cli(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("add") => {
            let mut s = Schedule {
                id: String::new(),
                name: String::new(),
                when: String::new(),
                cwd: ".".into(),
                prompt: String::new(),
                write: false,
                provider: None,
                model: None,
                effort: None,
                created: 0,
            };
            let mut i = 1;
            while i < args.len() {
                let r = match args[i].as_str() {
                    "--name" => value(args, &mut i, "--name").map(|v| s.name = v),
                    "--when" => value(args, &mut i, "--when").map(|v| s.when = v),
                    "--cwd" | "-C" => value(args, &mut i, "--cwd").map(|v| s.cwd = v),
                    "-p" | "--prompt" => value(args, &mut i, "-p").map(|v| s.prompt = v),
                    "--provider" => value(args, &mut i, "--provider").map(|v| s.provider = Some(v)),
                    "--model" => value(args, &mut i, "--model").map(|v| s.model = Some(v)),
                    "--effort" => value(args, &mut i, "--effort").map(|v| s.effort = Some(v)),
                    "--write" => {
                        s.write = true;
                        Ok(())
                    }
                    o => Err(format!("unknown option {o}\n{USAGE}")),
                };
                if let Err(e) = r {
                    eprintln!("{e}");
                    return 2;
                }
                i += 1;
            }
            match add(s) {
                Ok(s) => {
                    println!(
                        "scheduled {} ({}, {}) in {} — {}",
                        s.id,
                        s.when,
                        if s.write { "may write" } else { "read-only" },
                        s.cwd,
                        unit_name(&s.id)
                    );
                    0
                }
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            }
        }
        Some("list") => {
            let all = load();
            if all.is_empty() {
                println!("no scheduled agents");
            }
            for s in all {
                let last = runs(&s.id)
                    .into_iter()
                    .next()
                    .map(|(t, o)| format!("last run {t}: {o}"))
                    .unwrap_or_else(|| "never ran".into());
                println!(
                    "{}  {}  {}  {}  — {}\n    {}",
                    s.id,
                    s.when,
                    if s.write { "write" } else { "read-only" },
                    s.cwd,
                    last,
                    s.prompt.lines().next().unwrap_or("")
                );
            }
            0
        }
        Some("run") => match args.get(1).map(|k| run_now(k)) {
            Some(Ok(out)) => {
                println!("{}", out.result.trim_end());
                headless::exit_code(&out.outcome)
            }
            Some(Err(e)) => {
                eprintln!("{e}");
                1
            }
            None => {
                eprintln!("{USAGE}");
                2
            }
        },
        Some("remove") => match args.get(1).map(|k| remove(k)) {
            Some(Ok(s)) => {
                println!("removed {}", s.id);
                0
            }
            Some(Err(e)) => {
                eprintln!("{e}");
                1
            }
            None => {
                eprintln!("{USAGE}");
                2
            }
        },
        _ => {
            eprintln!("{USAGE}");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn when_becomes_a_calendar_and_nothing_else_reaches_the_unit() {
        assert_eq!(on_calendar("hourly").unwrap(), "hourly");
        assert_eq!(on_calendar("daily@07:30").unwrap(), "*-*-* 07:30:00");
        assert_eq!(
            on_calendar("weekly@Mon@9:05").unwrap(),
            "Mon *-*-* 09:05:00"
        );
        for bad in [
            "daily@25:00",
            "daily@7",
            "weekly@Funday@10:00",
            "minutely",
            "daily@07:30\nExecStart=/bin/sh",
            "",
        ] {
            assert!(on_calendar(bad).is_err(), "{bad:?}");
        }
        assert!(valid_name("nightly-review") && !valid_name("a b") && !valid_name("x\ny"));
        let s = Schedule {
            id: "nightly-1".into(),
            name: "nightly".into(),
            when: "daily@07:30".into(),
            cwd: "/p".into(),
            prompt: "x".into(),
            write: false,
            provider: None,
            model: None,
            effort: None,
            created: 1,
        };
        let (service, timer) = units(&s, Path::new("/opt/dxtutor/dxtutor-ide")).unwrap();
        assert!(service.contains("ExecStart=/opt/dxtutor/dxtutor-ide agent schedule run nightly-1"));
        assert!(timer.contains("OnCalendar=*-*-* 07:30:00") && timer.contains("Persistent=true"));
        assert!(units(&s, Path::new("/opt/my apps/dxtutor-ide")).is_err());
    }
}
