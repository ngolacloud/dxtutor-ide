//! What a runbook `check` may run without asking (r23 F5a, docs/v2/AUDIT-r23.md §4.5 — X01): read-only
//! commands only. The agent's shell classifier (`tutor_agent::permissions::assess`) splits the line into
//! simple commands (pipes, `&&`, `;`, subshells, `$(…)`, `env`/`sh -c` unwrapped); each must be safe for
//! it, or a read verb of an infrastructure tool. Writing to a file (`>`), and the read verbs that return
//! secret values (`aws secretsmanager get-secret-value`, `vault read`/`kv get`, `kubectl get secret -o
//! yaml`…), are refused. Anything else is `not_read_only` and must be an `action` (approved).

use std::path::Path;

use tutor_agent::permissions::{assess, Risk};

fn base(w: &str) -> &str {
    w.rsplit('/').next().unwrap_or(w)
}

fn has(words: &[String], s: &str) -> bool {
    words.iter().any(|w| w == s)
}

/// Options that take a value (`-n shop`, `--context kind-dev`, `--region eu-west-1`): their value is not
/// a verb.
const VALUE_FLAGS: &[&str] = &[
    "-n",
    "--namespace",
    "--context",
    "--kubeconfig",
    "--cluster",
    "--user",
    "-s",
    "--server",
    "--token",
    "--region",
    "--profile",
    "--output",
    "--endpoint-url",
    "--project",
    "--subscription",
    "-g",
    "--resource-group",
    "-R",
    "--repo",
    "--kube-context",
    "-H",
    "--host",
    "-c",
    "--container",
    "-l",
    "--selector",
    "-o",
];

/// The positional words of a command (options and their values left out).
fn positional(args: &[String]) -> Vec<&str> {
    let mut out = vec![];
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if a.starts_with('-') {
            if VALUE_FLAGS.contains(&a) {
                i += 1;
            }
        } else {
            out.push(a);
        }
        i += 1;
    }
    out
}

/// The read verbs of the infrastructure tools (the agent's classifier does not know them).
pub fn infra_read(words: &[String]) -> Result<bool, String> {
    let Some(tool) = words.first().map(|w| base(w).to_string()) else {
        return Ok(false);
    };
    let args = positional(&words[1..]);
    let verb = args.first().copied().unwrap_or("");
    let secret = |why: &str| Err(format!("`{}` reads secret values ({why})", words.join(" ")));
    Ok(match tool.as_str() {
        "kubectl" | "oc" => {
            let ok = matches!(
                verb,
                "get"
                    | "describe"
                    | "logs"
                    | "top"
                    | "version"
                    | "explain"
                    | "api-resources"
                    | "api-versions"
                    | "cluster-info"
                    | "events"
            ) || (verb == "auth"
                && matches!(args.get(1).copied(), Some("can-i" | "whoami")))
                || (verb == "config"
                    && matches!(
                        args.get(1).copied(),
                        Some("view" | "get-contexts" | "current-context")
                    ))
                || (verb == "rollout"
                    && matches!(args.get(1).copied(), Some("status" | "history")));
            if ok
                && verb == "get"
                && args.iter().any(|a| a.starts_with("secret"))
                && words.iter().any(|w| {
                    w.contains("yaml")
                        || w.contains("json")
                        || w.contains("jsonpath")
                        || w.contains("go-template")
                })
            {
                return secret("a Secret's data");
            }
            if ok
                && verb == "config"
                && !has(words, "--minify")
                && args.get(1) == Some(&"view")
                && has(words, "--raw")
            {
                return secret("the kubeconfig's credentials");
            }
            ok
        }
        "aws" => {
            let op = args.get(1).copied().unwrap_or("");
            if op == "get-secret-value"
                || (verb == "ssm"
                    && op.starts_with("get-parameter")
                    && has(words, "--with-decryption"))
                || op == "get-authorization-token"
                || op == "get-login-password"
            {
                return secret("aws");
            }
            op.starts_with("describe-")
                || op.starts_with("list-")
                || (op.starts_with("get-") && verb != "sts")
                || (verb == "sts" && op == "get-caller-identity")
        }
        "gcloud" => {
            if args
                .iter()
                .any(|a| *a == "access" || *a == "print-access-token")
                || (args.contains(&"secrets") && args.contains(&"access"))
            {
                return secret("gcloud");
            }
            matches!(args.last().copied(), Some("list" | "describe"))
                || args.contains(&"list")
                || args.contains(&"describe")
        }
        "az" => {
            if args.contains(&"secret") && args.contains(&"show") {
                return secret("az keyvault");
            }
            matches!(args.last().copied(), Some("list" | "show"))
                || args.contains(&"list")
                || args.contains(&"show")
        }
        "tofu" | "terraform" => {
            matches!(verb, "plan" | "show" | "validate" | "version" | "providers" | "fmt" if verb != "fmt" || has(words, "-check"))
                || (verb == "state" && matches!(args.get(1).copied(), Some("list")))
        }
        "gh" => {
            matches!(
                args.get(1).copied(),
                Some("view" | "list" | "status" | "checks" | "diff")
            ) || matches!(verb, "status")
        }
        "helm" => matches!(
            verb,
            "list" | "ls" | "status" | "history" | "version" | "lint" | "template" | "show"
        ),
        "docker" | "podman" => {
            matches!(
                verb,
                "ps" | "images" | "inspect" | "logs" | "version" | "info" | "stats" | "top"
            ) || (verb == "compose"
                && matches!(
                    args.get(1).copied(),
                    Some("ps" | "logs" | "config" | "images")
                ))
        }
        "vault" => {
            if matches!(verb, "read" | "kv")
                && !(verb == "kv" && matches!(args.get(1).copied(), Some("metadata" | "list")))
            {
                return secret("vault values stay in Vault");
            }
            matches!(verb, "status" | "version")
                || (verb == "token" && args.get(1) == Some(&"lookup"))
                || (verb == "kv" && matches!(args.get(1).copied(), Some("metadata" | "list")))
        }
        "argocd" => {
            matches!(
                args.get(1).copied(),
                Some("get" | "list" | "diff" | "history")
            ) || verb == "version"
        }
        "curl" => !words.iter().any(|w| {
            matches!(
                w.as_str(),
                "-X" | "--request"
                    | "-d"
                    | "--data"
                    | "--data-raw"
                    | "--data-binary"
                    | "-T"
                    | "--upload-file"
                    | "-F"
                    | "--form"
                    | "-o"
                    | "--output"
                    | "-O"
            )
        }),
        "dig" | "nslookup" | "host" | "ping" | "openssl"
            if tool != "openssl" || verb == "s_client" || verb == "x509" =>
        {
            true
        }
        "psql" => {
            has(words, "-c")
                && words
                    .iter()
                    .skip_while(|w| *w != "-c")
                    .nth(1)
                    .is_some_and(|q| {
                        let q = q.trim_start().to_ascii_lowercase();
                        (q.starts_with("select")
                            || q.starts_with("show")
                            || q.starts_with("explain"))
                            && !q.contains(';')
                    })
        }
        _ => false,
    })
}

/// Writes to a file (`>`, `>>`) outside quotes, other than `/dev/null` or a descriptor (`2>&1`).
fn writes_a_file(cmd: &str) -> bool {
    let b: Vec<char> = cmd.chars().collect();
    let (mut sq, mut dq) = (false, false);
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            '\'' if !dq => sq = !sq,
            '"' if !sq => dq = !dq,
            '\\' => i += 1,
            '>' if !sq && !dq => {
                let mut j = i + 1;
                while j < b.len() && (b[j] == '>' || b[j] == '|') {
                    j += 1;
                }
                if j < b.len() && b[j] == '&' {
                    i = j + 1;
                    continue;
                }
                while j < b.len() && b[j] == ' ' {
                    j += 1;
                }
                let target: String = b[j..]
                    .iter()
                    .take_while(|c| !c.is_whitespace() && **c != ';' && **c != '|' && **c != '&')
                    .collect();
                if target != "/dev/null" {
                    return true;
                }
            }
            _ => {}
        }
        i += 1;
    }
    false
}

/// `Ok` when every command of `cmd` is read-only; else the reason (`not_read_only: …`).
pub fn read_only(cmd: &str, root: &Path) -> Result<(), String> {
    if cmd.trim().is_empty() {
        return Err("not_read_only: no command".into());
    }
    if writes_a_file(cmd) {
        return Err("not_read_only: it writes to a file (>)".into());
    }
    // command by command: the classifier's verdict on the whole line would count `kubectl get deploy` as a
    // deploy; a read verb of an infrastructure tool passes, everything else must be safe on its own
    let all = assess(cmd, root);
    if all.commands.is_empty() {
        return Err(format!(
            "not_read_only: {}",
            if all.reason.is_empty() {
                "nothing to run"
            } else {
                &all.reason
            }
        ));
    }
    for words in &all.commands {
        match infra_read(words) {
            Ok(true) => continue,
            Err(e) => return Err(format!("not_read_only: {e}")),
            Ok(false) => {}
        }
        let one = assess(&words.join(" "), root);
        if one.risk != Risk::Safe {
            return Err(format!(
                "not_read_only: `{}` is not on the read-only allowlist{}",
                words.join(" "),
                if one.reason.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", one.reason)
                }
            ));
        }
    }
    Ok(())
}
