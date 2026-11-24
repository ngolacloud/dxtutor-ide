//! Classificador de comandos de shell (F3) — substitui a regex do frontend.
//!
//! Faz o parse do comando (aspas, escapes, `&&`/`||`/`;`/`|`/`&`, subshells, `$(…)`,
//! backticks, redirecções) e classifica **cada** comando simples, desembrulhando
//! `env`/`command`/`nohup`/`timeout`/`xargs`/`sh -c "…"` e caminhos (`/bin/rm`, `\rm`).
//! O risco do todo é o pior dos riscos das partes.
//!
//! - **Safe**: só leitura ou verificação por convenção do ecossistema (`cargo test`).
//! - **Unknown**: não se prova que não destrói nada (escreve ficheiros, corre scripts do
//!   repositório, nome dinâmico…). No modo Assistido pergunta.
//! - **Dangerous**: destrutivo, publica, sai do projecto ou mexe em permissões. Pergunta
//!   sempre, em qualquer modo, e nenhuma regra «permitir sempre» o dispensa.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Risk {
    Safe,
    Unknown,
    Dangerous,
}

/// Classificação de um comando, com a razão a mostrar ao humano.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assessment {
    pub risk: Risk,
    pub reason: String,
    /// Os comandos simples (já desembrulhados), para as regras por prefixo.
    pub commands: Vec<Vec<String>>,
}

impl Assessment {
    fn new() -> Self {
        Assessment {
            risk: Risk::Safe,
            reason: String::new(),
            commands: vec![],
        }
    }
    fn raise(&mut self, risk: Risk, reason: impl Into<String>) {
        if risk > self.risk {
            self.risk = risk;
            self.reason = reason.into();
        }
    }
    fn merge(&mut self, other: Assessment) {
        if other.risk > self.risk {
            self.risk = other.risk;
            self.reason = other.reason;
        }
        self.commands.extend(other.commands);
    }
}

#[derive(Debug, Default)]
struct Simple {
    words: Vec<String>,
    redirects: Vec<String>,
}

#[derive(Debug, Default)]
struct Parsed {
    /// pipelines, cada uma uma lista de comandos simples
    pipelines: Vec<Vec<Simple>>,
    /// conteúdos de `$(…)`, backticks e `<(…)`, classificados recursivamente
    substitutions: Vec<String>,
    heredoc: bool,
    unbalanced: bool,
}

/// Lê até ao `)` que fecha (respeitando aspas e aninhamento). Devolve (conteúdo, fim).
fn until_close(chars: &[char], mut i: usize) -> (String, usize, bool) {
    let mut depth = 1;
    let mut out = String::new();
    let (mut sq, mut dq) = (false, false);
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && !sq && i + 1 < chars.len() {
            out.push(c);
            out.push(chars[i + 1]);
            i += 2;
            continue;
        }
        match c {
            '\'' if !dq => sq = !sq,
            '"' if !sq => dq = !dq,
            '(' if !sq && !dq => depth += 1,
            ')' if !sq && !dq => {
                depth -= 1;
                if depth == 0 {
                    return (out, i + 1, true);
                }
            }
            _ => {}
        }
        out.push(c);
        i += 1;
    }
    (out, i, false)
}

// as macros repõem o estado do lexer também na última expansão (fim da entrada),
// onde essas atribuições já não são lidas
#[allow(unused_assignments)]
fn parse(cmd: &str) -> Parsed {
    let chars: Vec<char> = cmd.chars().collect();
    let mut p = Parsed::default();
    let mut pipeline: Vec<Simple> = vec![];
    let mut cur = Simple::default();
    let mut word = String::new();
    let mut in_word = false;
    let mut redirect_next = false;
    let (mut sq, mut dq) = (false, false);

    macro_rules! end_word {
        () => {{
            if in_word {
                if redirect_next {
                    cur.redirects.push(std::mem::take(&mut word));
                    redirect_next = false;
                } else {
                    cur.words.push(std::mem::take(&mut word));
                }
                in_word = false;
            }
        }};
    }
    macro_rules! end_simple {
        () => {{
            end_word!();
            if !cur.words.is_empty() || !cur.redirects.is_empty() {
                pipeline.push(std::mem::take(&mut cur));
            }
        }};
    }
    macro_rules! end_pipeline {
        () => {{
            end_simple!();
            if !pipeline.is_empty() {
                p.pipelines.push(std::mem::take(&mut pipeline));
            }
        }};
    }

    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if sq {
            if c == '\'' {
                sq = false;
            } else {
                word.push(c);
            }
            i += 1;
            continue;
        }
        if c == '\\' {
            if let Some(n) = next {
                if n != '\n' {
                    word.push(n);
                    in_word = true;
                }
                i += 2;
                continue;
            }
        }
        if c == '$' && next == Some('(') {
            let (inner, end, ok) = until_close(&chars, i + 2);
            p.unbalanced |= !ok;
            p.substitutions.push(inner);
            word.push_str("$(…)");
            in_word = true;
            i = end;
            continue;
        }
        if c == '`' {
            let rest: String = chars[i + 1..].iter().collect();
            match rest.find('`') {
                Some(j) => {
                    p.substitutions.push(rest[..j].to_string());
                    i += 1 + rest[..j].chars().count() + 1;
                }
                None => {
                    p.unbalanced = true;
                    p.substitutions.push(rest.clone());
                    i = chars.len();
                }
            }
            word.push_str("$(…)");
            in_word = true;
            continue;
        }
        if dq {
            if c == '"' {
                dq = false;
            } else {
                word.push(c);
            }
            i += 1;
            continue;
        }
        match c {
            '\'' => {
                sq = true;
                in_word = true;
            }
            '"' => {
                dq = true;
                in_word = true;
            }
            ' ' | '\t' => end_word!(),
            '\n' | ';' => end_pipeline!(),
            '&' if next == Some('&') => {
                end_pipeline!();
                i += 1;
            }
            '&' if next == Some('>') => {
                end_word!();
                redirect_next = true;
                i += 1;
                if chars.get(i + 1) == Some(&'>') {
                    i += 1;
                }
            }
            '&' => end_pipeline!(),
            '|' if next == Some('|') => {
                end_pipeline!();
                i += 1;
            }
            '|' => end_simple!(),
            '<' | '>' if next == Some('(') => {
                let (inner, end, ok) = until_close(&chars, i + 2);
                p.unbalanced |= !ok;
                p.substitutions.push(inner);
                end_word!();
                i = end;
                continue;
            }
            '<' if next == Some('<') => {
                p.heredoc = true;
                end_word!();
                i += 1;
                redirect_next = true;
            }
            '>' | '<' => {
                // `2>`, `>>`, `>&2`: o número antes faz parte do operador
                if in_word && word.chars().all(|d| d.is_ascii_digit()) {
                    word.clear();
                    in_word = false;
                } else {
                    end_word!();
                }
                if c == '>' && next == Some('>') {
                    i += 1;
                }
                if chars.get(i + 1) == Some(&'&') {
                    // `>&2`: duplica um descritor, não é um ficheiro
                    i += 2;
                    while chars
                        .get(i)
                        .is_some_and(|d| d.is_ascii_digit() || *d == '-')
                    {
                        i += 1;
                    }
                    continue;
                }
                if c == '>' {
                    redirect_next = true;
                } else {
                    redirect_next = false; // leitura de um ficheiro: inofensiva
                                           // engole o nome do ficheiro de entrada
                    while chars.get(i + 1) == Some(&' ') {
                        i += 1;
                    }
                    let mut j = i + 1;
                    while j < chars.len() && !" \t;&|\n".contains(chars[j]) {
                        j += 1;
                    }
                    i = j;
                    continue;
                }
            }
            '(' | ')' | '{' | '}' if !in_word => end_pipeline!(),
            _ => {
                word.push(c);
                in_word = true;
            }
        }
        i += 1;
    }
    p.unbalanced |= sq || dq;
    end_pipeline!();
    p
}

fn base(name: &str) -> String {
    name.rsplit('/')
        .next()
        .unwrap_or(name)
        .trim_start_matches('\\')
        .to_string()
}

/// Tira atribuições `VAR=…` e embrulhos (`env`, `command`, `nohup`, `timeout 5`, `xargs -0`…).
/// Devolve as palavras do comando real e, se houver, um aviso de escalada de privilégios.
fn unwrap(words: &[String]) -> (Vec<String>, Option<String>) {
    let mut w: Vec<String> = words.to_vec();
    loop {
        while w
            .first()
            .is_some_and(|x| x.contains('=') && !x.starts_with('-') && !x.starts_with('='))
        {
            w.remove(0);
        }
        let Some(first) = w.first().map(|s| base(s)) else {
            return (w, None);
        };
        match first.as_str() {
            "sudo" | "doas" | "su" | "pkexec" | "run0" => {
                return (w, Some(format!("{first}: corre com privilégios elevados")))
            }
            "env" | "command" | "builtin" | "exec" | "nohup" | "time" | "stdbuf" | "unbuffer"
            | "setsid" | "chronic" => {
                w.remove(0);
                while w.first().is_some_and(|x| x.starts_with('-')) {
                    w.remove(0);
                }
            }
            "nice" | "ionice" => {
                w.remove(0);
                while w.first().is_some_and(|x| x.starts_with('-')) {
                    let opt = w.remove(0);
                    if (opt == "-n" || opt == "-c") && !w.is_empty() {
                        w.remove(0);
                    }
                }
            }
            "timeout" => {
                w.remove(0);
                while w.first().is_some_and(|x| x.starts_with('-')) {
                    w.remove(0);
                }
                if !w.is_empty() {
                    w.remove(0); // a duração
                }
            }
            "xargs" => {
                w.remove(0);
                while w.first().is_some_and(|x| x.starts_with('-')) {
                    let opt = w.remove(0);
                    if matches!(opt.as_str(), "-I" | "-n" | "-P" | "-d" | "-L" | "-s" | "-a")
                        && !w.is_empty()
                    {
                        w.remove(0);
                    }
                }
                if w.is_empty() {
                    w.push("echo".into()); // xargs sem comando = echo
                }
            }
            _ => return (w, None),
        }
    }
}

/// Um caminho (palavra ou alvo de redirecção) que sai da raiz do projecto?
fn escapes(root: &Path, p: &str) -> bool {
    if p.starts_with('~') || p.starts_with("$HOME") {
        return true;
    }
    let path = Path::new(p);
    let abs: PathBuf = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::ParentDir => {
                if !out.pop() {
                    return true;
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    !out.starts_with(root)
}

fn is_dev_sink(p: &str) -> bool {
    matches!(p, "/dev/null" | "/dev/stdout" | "/dev/stderr" | "/dev/tty")
}

/// Ficheiros cuja alteração dá poder ao agente ou corre código noutro momento.
fn touches_control_files(s: &str) -> bool {
    let s = s.replace('\\', "/");
    s.contains(".dxtutor/permissions") || s.contains(".git/hooks") || s.contains(".git/config")
}

/// Opções curtas combinadas (`-rf`, `-fdx`) contêm a letra `l`?
fn has_flag(args: &[String], short: char, long: &[&str]) -> bool {
    args.iter().any(|a| {
        long.contains(&a.as_str())
            || (a.starts_with('-') && !a.starts_with("--") && a[1..].contains(short))
    })
}

const SAFE: &[&str] = &[
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "pwd",
    "echo",
    "printf",
    "true",
    "false",
    "which",
    "type",
    "file",
    "stat",
    "du",
    "df",
    "tree",
    "diff",
    "cmp",
    "sort",
    "uniq",
    "cut",
    "tr",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ag",
    "fd",
    "basename",
    "dirname",
    "realpath",
    "readlink",
    "date",
    "whoami",
    "uname",
    "hostname",
    "printenv",
    "jq",
    "xxd",
    "od",
    "hexdump",
    "md5sum",
    "sha1sum",
    "sha256sum",
    "column",
    "nl",
    "comm",
    "paste",
    "seq",
    "sleep",
    "test",
    "[",
    "id",
    "nproc",
    "uptime",
    "ps",
    "lsof",
];

const PUBLISH: &[(&str, &str)] = &[
    ("npm", "publish"),
    ("pnpm", "publish"),
    ("yarn", "publish"),
    ("cargo", "publish"),
    ("twine", "upload"),
    ("gem", "push"),
    ("docker", "push"),
    ("podman", "push"),
];

/// The current branch of the repository at `root` (from `.git/HEAD`, also in a worktree).
fn current_branch(root: &Path) -> Option<String> {
    let git = root.join(".git");
    let head = if git.is_dir() {
        std::fs::read_to_string(git.join("HEAD")).ok()?
    } else {
        // a worktree: `.git` is a file `gitdir: <path>`
        let dir = std::fs::read_to_string(&git).ok()?;
        let dir = dir.trim().strip_prefix("gitdir:")?.trim().to_string();
        std::fs::read_to_string(Path::new(&dir).join("HEAD")).ok()?
    };
    head.trim()
        .strip_prefix("ref: refs/heads/")
        .map(str::to_string)
}

/// The shared branches: a merge into one of them always asks (RF-G05).
const SHARED_BRANCHES: &[&str] = &["main", "master", "develop", "staging", "production"];

/// Operations that are irreversible or reach shared systems, whatever tool runs them
/// (RF-G05, docs/v2/RF-DELONIX-PLANO.md F1.5): deploys, database migrations, cluster and
/// release changes. Looks at the whole command line (`npm run deploy`, `npx prisma migrate
/// deploy`, `bin/rails db:migrate`…). `None`: nothing of the kind.
fn irreversible(words: &[String]) -> Option<String> {
    let w: Vec<String> = words.iter().map(|x| x.to_ascii_lowercase()).collect();
    let has = |x: &str| w.iter().any(|a| a == x);
    let after = |x: &str| -> Option<&str> {
        w.iter()
            .position(|a| a == x || a.ends_with(&format!("/{x}")))
            .and_then(|i| w[i + 1..].iter().find(|a| !a.starts_with('-')))
            .map(String::as_str)
    };
    let name = w.first().map(|n| base(n)).unwrap_or_default();
    // deploys
    if has("deploy")
        || w.iter()
            .any(|a| a == "deploy:prod" || a.starts_with("deploy:"))
    {
        return Some("faz deploy".into());
    }
    if (name == "vercel" && has("--prod"))
        || (name == "pulumi" && matches!(after("pulumi"), Some("up" | "destroy")))
    {
        return Some(format!("{name}: deploy/alteração de infraestrutura"));
    }
    if let Some(sub) = after("helm") {
        if matches!(
            sub,
            "install" | "upgrade" | "uninstall" | "delete" | "rollback"
        ) {
            return Some(format!("helm {sub}: altera o cluster"));
        }
    }
    if let Some(sub) = after("kubectl") {
        if matches!(
            sub,
            "apply"
                | "create"
                | "patch"
                | "set"
                | "scale"
                | "rollout"
                | "edit"
                | "annotate"
                | "label"
                | "cordon"
                | "uncordon"
                | "taint"
                | "run"
                | "expose"
                | "autoscale"
        ) {
            return Some(format!("kubectl {sub}: altera o cluster"));
        }
    }
    // releases and merges on the forge
    if let Some(sub) = after("gh") {
        let next = w
            .iter()
            .position(|a| a == sub)
            .and_then(|i| w.get(i + 1))
            .map(String::as_str);
        match (sub, next) {
            ("pr", Some("merge")) => return Some("gh pr merge: funde no ramo partilhado".into()),
            ("release", Some("create" | "delete" | "upload" | "edit")) => {
                return Some("gh release: publica uma versão".into())
            }
            ("repo", Some("delete" | "archive" | "rename")) => {
                return Some("gh repo: altera o repositório remoto".into())
            }
            _ => {}
        }
    }
    // database migrations
    let migration = w.iter().any(|a| {
        let a = a.trim_start_matches("npm:").trim_start_matches("yarn:");
        a.starts_with("db:migrate")
            || matches!(
                a,
                "db:drop"
                    | "db:reset"
                    | "db:rollback"
                    | "db:schema:load"
                    | "db:setup"
                    | "db:seed"
                    | "db:push"
                    | "migrate:latest"
                    | "migrate:rollback"
                    | "migrate:up"
                    | "migrate:down"
                    | "migrate:reset"
                    | "migrate:fresh"
                    | "migrate:refresh"
            )
    }) || (has("prisma")
        && (matches!(
            after("migrate"),
            Some("deploy" | "reset" | "dev" | "resolve")
        ) || (has("db") && (has("push") || has("execute")))))
        || matches!(after("alembic"), Some("upgrade" | "downgrade" | "stamp"))
        || ((has("manage.py") || name == "django-admin") && (has("migrate") || has("flush")))
        || (has("sqlx")
            && ((has("migrate") && (has("run") || has("revert")))
                || (has("database") && (has("drop") || has("reset") || has("setup")))))
        || (has("diesel")
            && ((has("migration") && (has("run") || has("revert") || has("redo")))
                || (has("database") && (has("reset") || has("setup")))))
        || matches!(
            after("flyway"),
            Some("migrate" | "clean" | "repair" | "undo")
        )
        || matches!(after("liquibase"), Some("update" | "rollback" | "drop-all"))
        || matches!(after("goose"), Some("up" | "down" | "reset" | "redo"))
        || (name == "migrate"
            && w.iter()
                .any(|a| matches!(a.as_str(), "up" | "down" | "drop" | "force" | "goto")))
        || (name == "psql"
            && w.iter()
                .any(|a| a == "-f" || a == "--file" || a.starts_with("--file=")));
    if migration {
        return Some("migração/escrita numa base de dados".into());
    }
    None
}

fn assess_simple(words: &[String], redirects: &[String], root: &Path, out: &mut Assessment) {
    for r in redirects {
        if touches_control_files(r) {
            out.raise(
                Risk::Dangerous,
                format!("escreve em {r} (permissões/hooks)"),
            );
        } else if !is_dev_sink(r) && escapes(root, r) {
            out.raise(Risk::Dangerous, format!("escreve fora do projecto: {r}"));
        } else if !is_dev_sink(r) {
            out.raise(Risk::Unknown, format!("escreve no ficheiro {r}"));
        }
    }
    let (w, privilege) = unwrap(words);
    if let Some(why) = privilege {
        out.raise(Risk::Dangerous, why);
        out.commands.push(w);
        return;
    }
    let Some(name0) = w.first() else { return };
    out.commands.push(w.clone());
    let name = base(name0);
    let args = &w[1..];
    let sub = args
        .iter()
        .find(|a| !a.starts_with('-'))
        .map(String::as_str)
        .unwrap_or("");
    let joined = w.join(" ");
    let lower = joined.to_ascii_lowercase();

    if name.contains('$') || name.contains("(…)") {
        return out.raise(Risk::Unknown, "o nome do comando é dinâmico");
    }
    if args.iter().any(|a| touches_control_files(a)) {
        return out.raise(
            Risk::Dangerous,
            "mexe em permissões do agente ou hooks do git",
        );
    }
    if lower.contains("drop table")
        || lower.contains("drop database")
        || lower.contains("truncate table")
    {
        return out.raise(Risk::Dangerous, "apaga dados de uma base de dados");
    }
    if args.len() == 1 && matches!(args[0].as_str(), "--version" | "-V" | "--help" | "-h") {
        return;
    }
    // shells com -c: classifica o que corre lá dentro
    if matches!(
        name.as_str(),
        "sh" | "bash" | "zsh" | "dash" | "ksh" | "fish"
    ) {
        if let Some(i) = args.iter().position(|a| {
            a == "-c" || (a.starts_with('-') && a.ends_with('c') && !a.starts_with("--"))
        }) {
            if let Some(script) = args.get(i + 1) {
                out.merge(assess(script, root));
                return;
            }
        }
        return out.raise(Risk::Unknown, format!("corre um script com {name}"));
    }
    if PUBLISH.iter().any(|(n, s)| name == *n && sub == *s) {
        return out.raise(Risk::Dangerous, format!("{name} {sub}: publica para fora"));
    }
    if let Some(why) = irreversible(&w) {
        return out.raise(Risk::Dangerous, why);
    }
    // `--force` (and `--force-with-lease`) overrides a safety check of the tool itself
    if args
        .iter()
        .any(|a| a == "--force" || a.starts_with("--force-") || a.starts_with("--force="))
    {
        return out.raise(Risk::Dangerous, format!("{name} com --force"));
    }

    // comandos que mexem em ficheiros com caminhos fora do projecto
    if matches!(
        name.as_str(),
        "rm" | "mv"
            | "cp"
            | "tee"
            | "ln"
            | "touch"
            | "mkdir"
            | "rmdir"
            | "chmod"
            | "chown"
            | "rsync"
            | "install"
            | "truncate"
            | "unlink"
    ) {
        if let Some(p) = args
            .iter()
            .filter(|a| !a.starts_with('-'))
            .find(|a| escapes(root, a) && !is_dev_sink(a))
        {
            return out.raise(
                Risk::Dangerous,
                format!("{name} mexe fora do projecto: {p}"),
            );
        }
    }

    match name.as_str() {
        "rm" => {
            if has_flag(args, 'r', &["--recursive"])
                || has_flag(args, 'R', &[])
                || has_flag(args, 'f', &["--force"])
            {
                out.raise(Risk::Dangerous, "rm recursivo/forçado");
            } else if args.iter().any(|a| a == "*" || a == "." || a == "..") {
                out.raise(Risk::Dangerous, "rm de tudo na pasta");
            } else {
                // RF-G05: deleting files always asks, in every mode
                out.raise(Risk::Dangerous, "apaga ficheiros");
            }
        }
        "unlink" => out.raise(Risk::Dangerous, "apaga um ficheiro"),
        "git" => assess_git(args, root, out),
        "find" => {
            if args
                .iter()
                .any(|a| matches!(a.as_str(), "-delete" | "-fprint" | "-fprintf" | "-fls"))
            {
                out.raise(Risk::Dangerous, "find que apaga/escreve ficheiros");
            } else if let Some(i) = args
                .iter()
                .position(|a| matches!(a.as_str(), "-exec" | "-execdir" | "-ok" | "-okdir"))
            {
                let inner: Vec<String> = args[i + 1..]
                    .iter()
                    .take_while(|a| *a != ";" && *a != "+")
                    .cloned()
                    .collect();
                let mut sub = Assessment::new();
                assess_simple(&inner, &[], root, &mut sub);
                out.merge(sub);
                out.raise(Risk::Unknown, "find -exec corre um comando por ficheiro");
            }
        }
        "chmod" | "chown" | "chgrp" => {
            if has_flag(args, 'R', &["--recursive"])
                || args.iter().any(|a| a == "777" || a == "a+rwx")
            {
                out.raise(Risk::Dangerous, format!("{name} recursivo/permissivo"));
            } else {
                out.raise(Risk::Unknown, format!("{name} muda permissões"));
            }
        }
        "dd" | "shred" | "wipefs" | "fdisk" | "sfdisk" | "parted" | "mkswap" | "shutdown"
        | "reboot" | "halt" | "poweroff" | "killall" | "pkill" | "eval" | "crontab"
        | "systemctl" | "launchctl" => out.raise(
            Risk::Dangerous,
            format!("{name}: acção de sistema/irreversível"),
        ),
        n if n.starts_with("mkfs") => out.raise(Risk::Dangerous, "formata um disco"),
        "docker" | "podman" if matches!(sub, "rm" | "rmi" | "prune" | "system" | "volume") => out
            .raise(
                Risk::Dangerous,
                format!("{name} {sub}: apaga contentores/imagens/volumes"),
            ),
        "kubectl" if matches!(sub, "delete" | "drain" | "replace") => {
            out.raise(Risk::Dangerous, format!("kubectl {sub}"))
        }
        "terraform" | "tofu" if matches!(sub, "destroy" | "apply") => {
            out.raise(Risk::Dangerous, format!("{name} {sub}"))
        }
        "curl" | "wget" => {
            if has_flag(args, 'o', &["--output"])
                || has_flag(args, 'O', &["--remote-name"])
                || name == "wget"
            {
                out.raise(Risk::Unknown, "descarrega para um ficheiro");
            } else if args.iter().any(|a| {
                matches!(
                    a.as_str(),
                    "-X" | "--request" | "-d" | "--data" | "-F" | "--form" | "-T" | "--upload-file"
                )
            }) {
                out.raise(Risk::Unknown, "envia dados para a rede");
            } else {
                out.raise(Risk::Unknown, "acede à rede");
            }
        }
        "sed" if has_flag(args, 'i', &["--in-place"]) => {
            out.raise(Risk::Unknown, "sed -i altera ficheiros")
        }
        "sed" => {}
        "cargo" => match sub {
            "build" | "check" | "test" | "clippy" | "doc" | "tree" | "metadata" | "bench"
            | "nextest" => {}
            "fmt" if args.iter().any(|a| a == "--check") => {}
            _ => out.raise(Risk::Unknown, format!("cargo {sub}")),
        },
        "go" => match sub {
            "build" | "test" | "vet" | "list" | "env" | "version" => {}
            _ => out.raise(Risk::Unknown, format!("go {sub}")),
        },
        "pytest" | "mypy" => {}
        "python" | "python3"
            if args.len() >= 2
                && args[0] == "-m"
                && matches!(args[1].as_str(), "pytest" | "unittest" | "mypy") => {}
        "tsc" if args.iter().any(|a| a == "--noEmit") => {}
        "npx"
            if args.first().is_some_and(|a| a == "tsc") && args.iter().any(|a| a == "--noEmit") => {
        }
        "ruff" if sub == "check" && !args.iter().any(|a| a == "--fix") => {}
        "eslint" if !args.iter().any(|a| a == "--fix") => {}
        "prettier" if args.iter().any(|a| a == "--check" || a == "-c") => {}
        n if SAFE.contains(&n) => {}
        _ => out.raise(
            Risk::Unknown,
            format!("{name} não está na lista de comandos seguros"),
        ),
    }
}

fn assess_git(args: &[String], root: &Path, out: &mut Assessment) {
    // opções globais antes do subcomando (`git -C dir …`, `git -c k=v …`)
    let mut i = 0;
    while i < args.len() && args[i].starts_with('-') {
        if matches!(args[i].as_str(), "-C" | "-c" | "--git-dir" | "--work-tree") {
            i += 1;
        }
        i += 1;
    }
    let sub = args.get(i).map(String::as_str).unwrap_or("");
    let rest = if i < args.len() { &args[i + 1..] } else { &[] };
    let has = |s: &str| rest.iter().any(|a| a == s);
    let danger =
        |out: &mut Assessment, why: &str| out.raise(Risk::Dangerous, format!("git {sub}: {why}"));
    match sub {
        "push" => danger(out, "publica no remoto"),
        // RF-G05: a merge into a shared branch (the one checked out, or one named with
        // `git merge … --into`-like tools) always asks; elsewhere it is a normal change
        "merge" | "pull"
            if current_branch(root).is_some_and(|b| SHARED_BRANCHES.contains(&b.as_str())) =>
        {
            danger(
                out,
                &format!(
                    "funde em {} (ramo partilhado)",
                    current_branch(root).unwrap_or_default()
                ),
            )
        }
        "rm" => danger(out, "apaga ficheiros do repositório"),
        "reset" if has("--hard") || has("--merge") || has("--keep") => {
            danger(out, "descarta alterações")
        }
        "clean" if has_flag(rest, 'f', &["--force"]) => danger(out, "apaga ficheiros por seguir"),
        "checkout" if has("--") || has(".") || has_flag(rest, 'f', &["--force"]) => {
            danger(out, "descarta alterações")
        }
        "restore" if !has("--staged") || has("--worktree") => danger(out, "descarta alterações"),
        "branch" if has_flag(rest, 'D', &[]) || (has("--delete") && has("--force")) => {
            danger(out, "apaga um ramo")
        }
        "rebase" | "filter-branch" | "filter-repo" | "replace" => {
            danger(out, "reescreve o histórico")
        }
        "stash" if rest.first().is_some_and(|a| a == "drop" || a == "clear") => {
            danger(out, "apaga stashes")
        }
        "update-ref" if has("-d") => danger(out, "apaga uma referência"),
        "reflog" if rest.first().is_some_and(|a| a == "expire" || a == "delete") => {
            danger(out, "apaga o reflog")
        }
        "gc" if rest.iter().any(|a| a.starts_with("--prune")) => danger(out, "apaga objectos"),
        // RF-T02: the commits are the human's — the IDE commits the accepted changes with the
        // human as author and the Assisted-by/Issue trailers; the agent asks first, every time
        "commit" => danger(
            out,
            "os commits são do humano (a IDE faz o commit com os trailers)",
        ),
        "status" | "log" | "diff" | "show" | "rev-parse" | "ls-files" | "blame" | "describe"
        | "shortlog" | "grep" | "rev-list" | "cat-file" | "ls-tree" | "merge-base" | "version" => {}
        "branch"
            if rest.iter().all(|a| {
                matches!(
                    a.as_str(),
                    "-a" | "-r" | "-v" | "-vv" | "--list" | "--show-current" | "--all"
                )
            }) => {}
        "remote" if rest.iter().all(|a| a == "-v") => {}
        "config"
            if rest
                .iter()
                .any(|a| a == "--get" || a == "--list" || a == "-l") => {}
        "" => {}
        _ => out.raise(Risk::Unknown, format!("git {sub} altera o repositório")),
    }
}

/// Classifica `cmd`, que vai correr com `root` como directório de trabalho.
pub fn assess(cmd: &str, root: &Path) -> Assessment {
    let mut a = Assessment::new();
    if cmd.trim().is_empty() {
        a.raise(Risk::Unknown, "comando vazio");
        return a;
    }
    let p = parse(cmd);
    if p.unbalanced {
        a.raise(Risk::Unknown, "aspas ou parênteses por fechar");
    }
    if p.heredoc {
        a.raise(Risk::Unknown, "heredoc (conteúdo não verificado)");
    }
    for s in &p.substitutions {
        a.merge(assess(s, root));
    }
    for pipe in &p.pipelines {
        // descarregar e executar: curl/wget … | sh/python/…
        let fetches = pipe.iter().any(|s| {
            s.words
                .first()
                .is_some_and(|w| matches!(base(w).as_str(), "curl" | "wget"))
        });
        if fetches {
            if let Some(s) = pipe.iter().skip(1).find(|s| {
                let (w, _) = unwrap(&s.words);
                w.first().is_some_and(|x| {
                    matches!(
                        base(x).as_str(),
                        "sh" | "bash"
                            | "zsh"
                            | "dash"
                            | "python"
                            | "python3"
                            | "perl"
                            | "ruby"
                            | "node"
                            | "sudo"
                    )
                })
            }) {
                a.raise(
                    Risk::Dangerous,
                    format!("descarrega e executa ({})", s.words.join(" ")),
                );
            }
        }
        for s in pipe {
            assess_simple(&s.words, &s.redirects, root, &mut a);
        }
    }
    a
}
