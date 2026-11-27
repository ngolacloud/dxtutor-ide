//! Evidence for an audit (r23 F5a, docs/v2/AUDIT-r23.md §4.5 — RF-BK-A03, UI-PLAT-14): the IDE's audit log
//! of a period, with the deploys and the runbook runs, grouped by ISO/IEC 27001:2022 Annex A control. The
//! mapping is a starting point; the ISMS owner decides what counts. PURE: the rows come in, Markdown goes out.

use super::deploys::DeployRecord;
use super::runbooks::RunbookStepRun;
use super::AuditEntry;

/// The controls, in the order the file lists them.
pub const CONTROLS: &[(&str, &str)] = &[
    ("A.8.32", "Change management"),
    ("A.8.9", "Configuration management"),
    (
        "A.5.17 / A.8.12",
        "Authentication information and data leakage prevention",
    ),
    ("A.8.13", "Information backup"),
    ("A.5.24–A.5.27", "Incident management"),
];

/// The control an IDE audit row belongs to (`tool` = the feature, `call` = the action), if any.
pub fn control_of(tool: &str, call: &str) -> Option<&'static str> {
    Some(match (tool, call) {
        ("vault" | "protect", _) => "A.5.17 / A.8.12",
        ("iac", _) => "A.8.9",
        ("ops", c) if c.starts_with("iac.force-unlock") => "A.8.9",
        ("incident", _) => "A.5.24–A.5.27",
        ("ops" | "deploy" | "scm" | "git" | "welcome" | "runbook", _) => "A.8.32",
        _ => return None,
    })
}

pub(crate) fn when(ms: i64) -> String {
    // UTC, without a date crate: civil from days (Howard Hinnant's algorithm)
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}",
        sod / 3600,
        (sod % 3600) / 60
    )
}

/// `YYYY-MM-DD` of a time (ms, UTC).
pub fn day(ms: i64) -> String {
    when(ms)[..10].to_string()
}

fn one_line(s: &str) -> String {
    let t: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > 300 {
        format!("{}…", t.chars().take(300).collect::<String>())
    } else {
        t
    }
}

fn audit_line(a: &AuditEntry) -> String {
    let mut s = format!(
        "{} — {} — {}.{}: {}",
        when(a.at),
        a.actor,
        a.tool.as_deref().unwrap_or("?"),
        a.call.as_deref().unwrap_or("?"),
        one_line(a.command.as_deref().unwrap_or(""))
    );
    if let Some(p) = a.path.as_deref().filter(|p| !p.is_empty()) {
        s.push_str(&format!(" · {}", one_line(p)));
    }
    let decided = match a.verdict.as_deref() {
        Some("ask") if a.outcome.as_deref() == Some("denied") => " · refused".to_string(),
        _ => a
            .outcome
            .as_deref()
            .map(|o| format!(" · {o}"))
            .unwrap_or_default(),
    };
    s.push_str(&decided);
    if let Some(r) = a.reason.as_deref().filter(|r| !r.trim().is_empty()) {
        s.push_str(&format!(" · reason: {}", one_line(r)));
    }
    s
}

fn deploy_line(d: &DeployRecord) -> String {
    format!(
        "{} — {} — deployed {} to {} ({}/{}){}{} · {}",
        when(d.at),
        d.actor,
        d.version.chars().take(12).collect::<String>(),
        d.env,
        d.context,
        d.namespace,
        d.issue
            .as_deref()
            .map(|i| format!(" for {i}"))
            .unwrap_or_default(),
        d.approver
            .as_deref()
            .map(|a| format!(", approved by {a}"))
            .unwrap_or_default(),
        if d.ok {
            "ok".to_string()
        } else {
            format!("failed at {}", d.failed_step.as_deref().unwrap_or("?"))
        }
    ) + if d.waivers != "[]" && !d.waivers.is_empty() {
        " · waivers recorded"
    } else {
        ""
    }
}

/// One line per run of a runbook: its steps and their results.
fn run_lines(runs: &[RunbookStepRun]) -> Vec<(String, String)> {
    let mut by_run: Vec<(String, Vec<&RunbookStepRun>)> = vec![];
    for r in runs {
        match by_run.iter_mut().find(|(id, _)| *id == r.run_id) {
            Some((_, v)) => v.push(r),
            None => by_run.push((r.run_id.clone(), vec![r])),
        }
    }
    by_run
        .into_iter()
        .map(|(_, steps)| {
            let first = steps[0];
            let ok = steps.iter().filter(|s| s.matched == Some(true)).count();
            let bad = steps.iter().filter(|s| s.matched == Some(false)).count();
            let unj = steps.iter().filter(|s| s.matched.is_none()).count();
            let line = format!(
                "{} — {} — runbook «{}» ({}): {} step(s) with output — {} as expected, {} not, {} not judged",
                when(first.at),
                first.actor,
                first.runbook,
                first.path,
                steps.len(),
                ok,
                bad,
                unj
            );
            (format!("{} {}", first.path, first.runbook), line)
        })
        .collect()
}

/// The evidence file for a period (`from`..`to`, ms): every control with its rows, or «no records in this
/// period»; and the IDE rows no control takes, so nothing is hidden.
pub fn markdown(
    project: &str,
    from: i64,
    to: i64,
    now: i64,
    audit: &[AuditEntry],
    deploys: &[DeployRecord],
    runs: &[RunbookStepRun],
) -> String {
    let in_period = |t: i64| t >= from && t < to;
    let ide: Vec<&AuditEntry> = audit
        .iter()
        .filter(|a| a.origin == "ide" && in_period(a.at))
        .collect();
    let mut sections: Vec<(&str, &str, Vec<String>)> =
        CONTROLS.iter().map(|(c, n)| (*c, *n, vec![])).collect();
    let mut other = vec![];
    for a in &ide {
        match control_of(
            a.tool.as_deref().unwrap_or(""),
            a.call.as_deref().unwrap_or(""),
        ) {
            Some(c) => sections
                .iter_mut()
                .find(|s| s.0 == c)
                .unwrap()
                .2
                .push(audit_line(a)),
            None => other.push(audit_line(a)),
        }
    }
    for d in deploys.iter().filter(|d| in_period(d.at)) {
        sections[0].2.push(deploy_line(d));
    }
    for (key, line) in run_lines(
        &runs
            .iter()
            .filter(|r| in_period(r.at))
            .cloned()
            .collect::<Vec<_>>(),
    ) {
        let k = key.to_lowercase();
        if k.contains("backup") || k.contains("restore") || k.contains("snapshot") {
            sections[3].2.push(line);
        } else if k.contains("incident") {
            sections[4].2.push(line);
        } else {
            sections[0].2.push(line);
        }
    }
    let mut md = format!(
        "# Evidence export — {project}\n\nPeriod: {} to {} (UTC) · exported {} from the dxtutor IDE audit log, the deploy records and the runbook runs of this project.\n\nThe mapping to ISO/IEC 27001:2022 Annex A controls is a starting point; the ISMS owner decides what counts as evidence. Secrets were masked when each row was recorded.\n",
        day(from),
        day(to - 1),
        when(now)
    );
    for (c, n, mut rows) in sections {
        rows.sort();
        md.push_str(&format!("\n## {c} {n}\n\n"));
        if rows.is_empty() {
            md.push_str("- no records in this period\n");
        } else {
            for r in rows {
                md.push_str(&format!("- {r}\n"));
            }
        }
    }
    if !other.is_empty() {
        other.sort();
        md.push_str("\n## Other IDE operations (not mapped)\n\n");
        for r in other {
            md.push_str(&format!("- {r}\n"));
        }
    }
    md
}
