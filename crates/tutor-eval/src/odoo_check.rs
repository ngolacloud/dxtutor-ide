//! A avaliação de módulos Odoo (Learn P3c): a tabela `[odoo]` de um passo
//! ([`tutor_core::odootest`]) a correr no sandbox Podman rootless do Learn P3a (`crate::sandbox`).
//!
//! Uma avaliação, dentro da corrida do sandbox (tranca, etiquetas e limpeza ao cair, de
//! `crate::container_check::PodSession`):
//!
//! 1. **PostgreSQL** da imagem preparada, `--network none`, como o utilizador `postgres` (sem
//!    capacidades: o `docker-entrypoint.sh` só muda de dono quando corre como root), os dados num
//!    `tmpfs` (nada fica no disco) e sem `fsync` (a base morre com a corrida);
//! 2. espera pelo `pg_isready` por TCP em `127.0.0.1` (o servidor temporário da iniciação só ouve
//!    no socket Unix);
//! 3. **Odoo** da imagem preparada da série do passo, no espaço de rede do PostgreSQL
//!    (`--network container:<pg>` — nunca uma rede criada: no rootless chocaria com as do
//!    utilizador), com a pasta do passo só de leitura em `/mnt/extra-addons` (o `addons_path` do
//!    `odoo.conf` da imagem), `-i <módulos> --test-tags <etiquetas> --stop-after-init`;
//! 4. lê o registo: os módulos carregados, a linha final do `odoo.tests.result` (`F failed, E
//!    error(s) of N tests when loading database …`, igual no 18, no 19 e no 20) e QUALQUER aviso ou
//!    erro — um módulo nativo instala-se sem avisos.
//!
//! As diferenças de linha de comandos entre séries que contam aqui foram lidas no código de cada
//! uma (`odoo/tools/config.py`): no 18 os dados de demonstração carregam-se por omissão
//! (`--without-demo=all`); no 19 e no 20 não (`--with-demo` liga-os, e `--without-demo` está
//! obsoleto). O `--test-tags` liga os testes nas três.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use tutor_core::odootest::{self, OdooTest, ENTERPRISE_MISSING};
use tutor_core::toolcheck::Outcome;
use tutor_core::ImageRef;

use crate::container::ContainerLimits;
use crate::container_check::PodSession;

/// Onde a pasta do passo aparece no contentor do Odoo (o `addons_path` do `odoo.conf` da imagem).
const ADDONS_MOUNT: &str = "/mnt/extra-addons";
/// Onde os addons Enterprise do utilizador aparecem (só de leitura).
const ENTERPRISE_MOUNT: &str = "/mnt/enterprise";
/// A base de dados de cada avaliação (nasce e morre com a corrida).
const DB_NAME: &str = "dxt";
/// Quanto esperar pelo PostgreSQL.
const PG_READY_TRIES: u32 = 120;
/// Quantas linhas de cada problema do registo entram no relatório.
const PROBLEM_LINES: usize = 14;
/// Quantos problemas do registo se mostram.
const MAX_PROBLEMS: usize = 8;

/// Os avisos do próprio Odoo que não dizem nada do módulo do aluno (cada um medido numa
/// instalação limpa das três séries): o resto falha.
const BENIGN_WARNINGS: &[&str] = &[
    // Acompanha sempre um erro de carregamento (que já falha e é mostrado).
    "Transient module states were reset",
    // A imagem oficial do Odoo 20 (20.0-20261123) não traz o pacote Python `markdown2`: o `mail`
    // avisa ao carregar, com ou sem o módulo do aluno.
    "markdown2 is not installed, markdown will not be rendered",
];

/// Os addons Enterprise de um passo Enterprise: a pasta da variável da série do passo
/// ([`odootest::enterprise_env`], `DXTUTOR_ODOO_ENTERPRISE_18`…), com cada um dos
/// `enterprise_modules`. `Ok(None)` num passo Community; um erro com [`ENTERPRISE_MISSING`] quando
/// faltam (o `dxt plugin test` salta o passo com o motivo). Só se lê e se monta só de leitura:
/// nunca se descarrega, copia ou muda código Enterprise.
pub(crate) fn enterprise_addons(spec: &OdooTest) -> Result<Option<PathBuf>> {
    if !spec.enterprise {
        return Ok(None);
    }
    let var = odootest::enterprise_env(&spec.version);
    let missing = |why: String| -> Result<Option<PathBuf>> {
        bail!(
            "{ENTERPRISE_MISSING}: this step uses Odoo {} Enterprise ({}), which needs an Enterprise licence. {why} \
             Set {var} to the folder of your Odoo {} Enterprise addons (it is mounted read-only); \
             dxtutor never downloads or copies Enterprise code. The lesson still applies — read it and the solution.",
            spec.version,
            spec.enterprise_modules.join(", "),
            spec.version
        )
    };
    let Some(root) = std::env::var_os(&var).filter(|v| !v.is_empty()) else {
        return missing(format!("{var} is not set."));
    };
    let dir = PathBuf::from(root);
    if !dir.is_absolute() || !dir.is_dir() {
        return missing(format!("`{}` is not a folder.", dir.display()));
    }
    for m in &spec.enterprise_modules {
        let manifest = dir.join(m).join("__manifest__.py");
        if !manifest.is_file() {
            return missing(format!("`{}` has no `{m}` module.", dir.display()));
        }
        // O Odoo do sandbox corre num subuid do utilizador: só lê o que «outros» podem ler.
        use std::os::unix::fs::MetadataExt;
        let others_read =
            |p: &Path, bits: u32| std::fs::metadata(p).is_ok_and(|m| m.mode() & bits == bits);
        if !others_read(&dir, 0o005) || !others_read(&manifest, 0o004) {
            return missing(format!(
                "`{}` is not readable by other users (the sandboxed Odoo runs as a sub-user of yours): \
                 dxtutor never changes its permissions.",
                dir.display()
            ));
        }
    }
    Ok(Some(dir))
}

/// O que uma corrida do Odoo deixou: o registo (stdout e stderr juntos), o código de saída e se
/// excedeu o tempo.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct OdooRun {
    pub log: String,
    pub code: Option<i32>,
    pub timed_out: bool,
    pub pg_secs: f64,
    pub odoo_secs: f64,
}

/// Abre a pasta do passo à leitura de todos (o Odoo corre como `odoo` num subuid do utilizador,
/// que não lê uma pasta 0700): pastas 0755, ficheiros 0644. Só código do aluno e do curso.
fn open_for_reading(base: &Path, work: &Path) -> Result<()> {
    let set = |p: &Path, mode: u32| {
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode))
            .with_context(|| format!("chmod {}", p.display()))
    };
    set(base, 0o755)?;
    let mut stack = vec![work.to_path_buf()];
    while let Some(dir) = stack.pop() {
        set(&dir, 0o755)?;
        for e in std::fs::read_dir(&dir).with_context(|| format!("read {}", dir.display()))? {
            let e = e?;
            let ft = e.file_type()?;
            if ft.is_dir() {
                stack.push(e.path());
            } else if ft.is_file() {
                set(&e.path(), 0o644)?;
            }
        }
    }
    Ok(())
}

/// Os argumentos do `odoo` de um passo (sem as flags do `podman`).
pub(crate) fn odoo_args(spec: &OdooTest, password: &str, enterprise: bool) -> Vec<String> {
    let mut addons = ADDONS_MOUNT.to_string();
    if enterprise {
        addons.push(',');
        addons.push_str(ENTERPRISE_MOUNT);
    }
    let mut a = vec![
        "--db_host=127.0.0.1".to_string(),
        "--db_port=5432".to_string(),
        "--db_user=odoo".to_string(),
        format!("--db_password={password}"),
        "-d".to_string(),
        DB_NAME.to_string(),
        format!("--addons-path={addons}"),
        "-i".to_string(),
        spec.install.join(","),
        format!("--test-tags={}", spec.effective_tags().join(",")),
        "--stop-after-init".to_string(),
        "--no-http".to_string(),
        "--log-level=info".to_string(),
    ];
    // Medido em `odoo/tools/config.py`: só o 18 carrega os dados de demonstração por omissão.
    if spec.version == "18.0" {
        a.push("--without-demo=all".to_string());
    }
    a
}

/// Corre o PostgreSQL e o Odoo de um passo na corrida de `session` e devolve o registo.
pub(crate) fn run(
    session: &PodSession,
    spec: &OdooTest,
    base: &Path,
    work: &Path,
    images: &[ImageRef],
    timeout: Duration,
    enterprise: Option<&Path>,
) -> Result<OdooRun> {
    let odoo = odootest::odoo_image(images, &spec.version).with_context(|| {
        format!(
            "the course prepares no Odoo {} image (docker.io/library/odoo:{}…)",
            spec.version, spec.version
        )
    })?;
    let pg = odootest::postgres_image(images)
        .context("the course prepares no PostgreSQL image (docker.io/library/postgres)")?;
    open_for_reading(base, work)?;
    let sb = session.sandbox();
    let s = |x: &str| x.to_string();
    let password = format!("dxt{}", session.run_id());
    let pg_name = session.container("pg");
    let labels = session.labels();

    // 1. PostgreSQL.
    let t0 = Instant::now();
    let mut limits = ContainerLimits::grading();
    limits.memory_mb = Some(1024);
    limits.pids = Some(256);
    limits.millicpus = Some(2000);
    limits.labels = labels.clone();
    let mut a = vec![s("run"), s("-d"), s("--name"), pg_name.clone()];
    a.extend(limits.run_args());
    a.extend([
        s("--network=none"),
        s("--user=postgres"),
        s("--tmpfs"),
        s("/var/lib/postgresql/data:rw,size=768m,mode=1777"),
        s("-e"),
        s("POSTGRES_USER=odoo"),
        s("-e"),
        format!("POSTGRES_PASSWORD={password}"),
        s("-e"),
        s("PGDATA=/var/lib/postgresql/data/pg"),
        pg.name(),
        s("postgres"),
        s("-c"),
        s("fsync=off"),
        s("-c"),
        s("full_page_writes=off"),
        s("-c"),
        s("synchronous_commit=off"),
    ]);
    let out = sb.exec(&a, Duration::from_secs(60))?;
    if !out.ok() {
        bail!(
            "the PostgreSQL container did not start: {}",
            session.tidy(&out.stderr).trim()
        );
    }
    let ready = [
        s("exec"),
        pg_name.clone(),
        s("pg_isready"),
        s("-q"),
        s("-h"),
        s("127.0.0.1"),
        s("-U"),
        s("odoo"),
    ];
    let mut up = false;
    for _ in 0..PG_READY_TRIES {
        if sb.exec(&ready, Duration::from_secs(10))?.ok() {
            up = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    if !up {
        let logs = sb.exec(&[s("logs"), pg_name.clone()], Duration::from_secs(20))?;
        bail!(
            "PostgreSQL did not become ready in the sandbox: {}",
            session
                .tidy(&format!("{}{}", logs.stdout, logs.stderr))
                .trim()
        );
    }
    let pg_secs = t0.elapsed().as_secs_f64();

    // 2. Odoo.
    let t1 = Instant::now();
    let mut limits = ContainerLimits::grading();
    limits.memory_mb = Some(2560);
    limits.pids = Some(512);
    limits.millicpus = Some(2000);
    limits.labels = labels;
    let mut a = vec![s("run"), s("--rm"), s("--name"), session.container("odoo")];
    a.extend(limits.run_args());
    a.push(format!("--network=container:{pg_name}"));
    a.extend([s("-v"), format!("{}:{ADDONS_MOUNT}:ro", work.display())]);
    if let Some(ee) = enterprise {
        a.extend([s("-v"), format!("{}:{ENTERPRISE_MOUNT}:ro", ee.display())]);
    }
    a.push(s("--entrypoint=/usr/bin/odoo"));
    a.push(odoo.name());
    a.extend(odoo_args(spec, &password, enterprise.is_some()));
    let out = sb.exec(&a, timeout)?;
    // Parar o PostgreSQL já (o `conmon` corre o `container cleanup` dele agora), antes da limpeza
    // por etiqueta: medido no Podman 4.9.3 com a máquina carregada, um `rm -f -t 0` de um
    // contentor ainda a correr pode ficar preso contra o `container cleanup` que o próprio `rm`
    // provoca. Melhor esforço: a limpeza da corrida remove-o de qualquer forma.
    let _ = sb.exec(
        &[s("stop"), s("-t"), s("10"), pg_name.clone()],
        Duration::from_secs(60),
    );
    let mut log = session.tidy(&format!("{}{}", out.stdout, out.stderr));
    log = log.replace(&password, "***");
    Ok(OdooRun {
        log,
        code: out.code,
        timed_out: out.timed_out,
        pg_secs,
        odoo_secs: t1.elapsed().as_secs_f64(),
    })
}

// ── O registo ────────────────────────────────────────────────────────────────────────────

/// Uma entrada do registo do Odoo: `2026-11-27 10:31:45,156 1 ERROR dxt odoo.addons.x: mensagem`,
/// mais as linhas que se lhe seguem até à próxima entrada (um traceback).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    pub level: String,
    pub logger: String,
    pub message: String,
    pub more: Vec<String>,
}

fn log_line(line: &str) -> Option<Entry> {
    // data hora,ms pid NÍVEL base logger: mensagem
    let mut it = line.splitn(6, ' ');
    let date = it.next()?;
    let time = it.next()?;
    let pid = it.next()?;
    let level = it.next()?;
    let db = it.next()?;
    let rest = it.next()?;
    let date_ok = date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-';
    let time_ok = time.len() >= 12 && time.as_bytes()[2] == b':' && time.contains(',');
    if !date_ok
        || !time_ok
        || !pid.chars().all(|c| c.is_ascii_digit())
        || !matches!(level, "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL")
        || db.is_empty()
    {
        return None;
    }
    let (logger, message) = rest.split_once(": ").unwrap_or((rest, ""));
    Some(Entry {
        level: level.to_string(),
        logger: logger.to_string(),
        message: message.trim_end().to_string(),
        more: Vec::new(),
    })
}

/// As entradas do registo, com as linhas soltas (tracebacks) presas à anterior.
pub(crate) fn entries(log: &str) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    for line in log.lines() {
        match log_line(line) {
            Some(e) => out.push(e),
            None => {
                if let Some(last) = out.last_mut() {
                    if !line.trim().is_empty() {
                        last.more.push(line.to_string());
                    }
                }
            }
        }
    }
    out
}

/// A linha final dos testes: `(falhados, erros, corridos)`.
pub(crate) fn test_result(entries: &[Entry]) -> Option<(u32, u32, u32)> {
    entries
        .iter()
        .rev()
        .filter(|e| e.logger == "odoo.tests.result")
        .find_map(|e| {
            // «1 failed, 0 error(s) of 2 tests when loading database 'dxt'»
            let m = &e.message;
            let (failed, rest) = m.split_once(" failed, ")?;
            let (errors, rest) = rest.split_once(" error(s) of ")?;
            let (run, _) = rest.split_once(" tests")?;
            Some((
                failed.trim().parse().ok()?,
                errors.trim().parse().ok()?,
                run.trim().parse().ok()?,
            ))
        })
}

/// Os módulos que o registo diz carregados (`Module <nome> loaded in …`).
fn loaded(entries: &[Entry], module: &str) -> bool {
    let want = format!("Module {module} loaded in ");
    entries
        .iter()
        .any(|e| e.logger == "odoo.modules.loading" && e.message.starts_with(&want))
}

/// Os avisos e erros que contam (tudo de nível WARNING ou acima, menos a linha final dos testes,
/// que se avalia à parte, e os avisos [`BENIGN_WARNINGS`]).
pub(crate) fn problems(entries: &[Entry]) -> Vec<&Entry> {
    entries
        .iter()
        .filter(|e| matches!(e.level.as_str(), "WARNING" | "ERROR" | "CRITICAL"))
        .filter(|e| e.logger != "odoo.tests.result")
        .filter(|e| {
            !(e.level == "WARNING" && BENIGN_WARNINGS.iter().any(|b| e.message.contains(b)))
        })
        .collect()
}

fn show(e: &Entry) -> String {
    let mut lines = vec![format!("{} {}: {}", e.level, e.logger, e.message)];
    // As linhas finais de um traceback são as que dizem o que aconteceu.
    let skip = e.more.len().saturating_sub(PROBLEM_LINES);
    lines.extend(
        e.more
            .iter()
            .skip(skip)
            .filter(|l| !l.trim().chars().all(|c| matches!(c, '^' | '~' | ' ')))
            .cloned(),
    );
    lines
        .iter()
        .map(|l| format!("    {l}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// O veredicto de uma corrida: um resultado por afirmação, pela ordem.
pub(crate) fn judge(spec: &OdooTest, run: &OdooRun, timeout: Duration) -> Vec<Outcome> {
    let es = entries(&run.log);
    let probs = problems(&es);
    let mut out = Vec::new();
    if run.timed_out {
        out.push(Outcome {
            ok: false,
            label: format!("Odoo {} finished in time", spec.version),
            detail: format!(
                "{} (Odoo exceeded the {} s time limit and was stopped)",
                spec.message,
                timeout.as_secs()
            ),
        });
        return out;
    }
    let missing: Vec<&str> = spec
        .install
        .iter()
        .filter(|m| !loaded(&es, m))
        .map(String::as_str)
        .collect();
    let fatal: Vec<&&Entry> = probs
        .iter()
        .filter(|e| matches!(e.level.as_str(), "ERROR" | "CRITICAL"))
        .collect();
    let install_ok = missing.is_empty() && !es.iter().any(|e| e.level == "CRITICAL");
    out.push(Outcome {
        ok: install_ok,
        label: format!(
            "Odoo {} installs {}",
            spec.version,
            spec.install
                .iter()
                .map(|m| format!("`{m}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        detail: if install_ok {
            String::new()
        } else {
            let mut d = format!("{} (not loaded: {})", spec.message, missing.join(", "));
            for e in fatal.iter().take(3) {
                d.push('\n');
                d.push_str(&show(e));
            }
            d
        },
    });
    if !install_ok {
        return out;
    }
    match test_result(&es) {
        None => out.push(Outcome {
            ok: false,
            label: "the tests ran".into(),
            detail: format!(
                "{} (Odoo printed no test summary: exit code {:?})",
                spec.message, run.code
            ),
        }),
        Some((failed, errors, ran)) => {
            let ok = failed == 0 && errors == 0 && ran >= spec.min_tests;
            let mut detail = String::new();
            if !ok {
                detail = if ran < spec.min_tests {
                    format!(
                        "{} ({ran} test(s) ran; at least {} expected — are the tests imported from `tests/__init__.py`?)",
                        spec.message, spec.min_tests
                    )
                } else {
                    format!("{} ({failed} failed, {errors} error(s))", spec.message)
                };
                for e in es
                    .iter()
                    .filter(|e| {
                        e.level == "ERROR"
                            && (e.message.starts_with("FAIL: ") || e.message.starts_with("ERROR: "))
                    })
                    .take(MAX_PROBLEMS)
                {
                    detail.push('\n');
                    detail.push_str(&show(e));
                }
            }
            out.push(Outcome {
                ok,
                label: format!(
                    "tests: {ran} ran, {failed} failed, {errors} error(s) (tags {})",
                    spec.effective_tags().join(",")
                ),
                detail,
            });
        }
    }
    // Um módulo nativo instala-se sem avisos: cada aviso ou erro do registo que não seja um
    // teste falhado (já contado acima) é um problema.
    let other: Vec<&&Entry> = probs
        .iter()
        .filter(|e| !(e.message.starts_with("FAIL: ") || e.message.starts_with("ERROR: ")))
        .collect();
    out.push(Outcome {
        ok: other.is_empty(),
        label: "the Odoo log has no warnings or errors".into(),
        detail: if other.is_empty() {
            String::new()
        } else {
            let mut d = format!(
                "{} warning(s) or error(s) in the log — a native module installs cleanly:",
                other.len()
            );
            for e in other.iter().take(MAX_PROBLEMS) {
                d.push('\n');
                d.push_str(&show(e));
            }
            d
        },
    });
    for want in &spec.log_contains {
        let ok = run.log.contains(want.as_str());
        out.push(Outcome {
            ok,
            label: format!("the Odoo log contains `{want}`"),
            detail: if ok {
                String::new()
            } else {
                spec.message.clone()
            },
        });
    }
    for bad in &spec.log_lacks {
        let ok = !run.log.contains(bad.as_str());
        out.push(Outcome {
            ok,
            label: format!("the Odoo log does not contain `{bad}`"),
            detail: if ok {
                String::new()
            } else {
                spec.message.clone()
            },
        });
    }
    out
}

/// O caminho dos drills do curso de Odoo: «correr» um ficheiro é lê-lo — Python com o `ast`, XML
/// com o `xml.etree` e CSV com o módulo `csv` do Python do anfitrião (sem Odoo, sem rede): os
/// drills ensinam a escrever; os desafios correm no Odoo.
pub fn run_odoo_drill(code: &str) -> crate::runner::RunOutput {
    let fail = |e: String| crate::runner::RunOutput {
        ok: false,
        stdout: String::new(),
        stderr: e,
    };
    let Ok(dir) = tempfile::Builder::new()
        .prefix("dxtutor-odoo-drill-")
        .tempdir()
    else {
        return fail("cannot create a temporary folder".into());
    };
    let file = dir.path().join("drill.txt");
    if std::fs::write(&file, code).is_err() {
        return fail("cannot write the drill".into());
    }
    let kind = drill_kind(code);
    let script = match kind {
        "xml" => "import sys, xml.etree.ElementTree as E\nE.parse(sys.argv[1])\nprint('well-formed XML')",
        "csv" => "import sys, csv\nrows = list(csv.reader(open(sys.argv[1], newline='')))\nw = {len(r) for r in rows if r}\nassert len(w) == 1, 'rows have different numbers of columns: %s' % sorted(w)\nprint('CSV: %d columns, %d rows' % (w.pop(), len(rows) - 1))",
        _ => "import sys, ast\nast.parse(open(sys.argv[1]).read(), 'drill.py')\nprint('valid Python')",
    };
    let mut cmd = std::process::Command::new("python3");
    cmd.args(["-I", "-c", script])
        .arg(&file)
        .current_dir(dir.path())
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("LANG", "C.UTF-8");
    match crate::runner::run_guarded(cmd, dir.path(), "odoo-drill", Duration::from_secs(20), None) {
        Ok(o) => crate::runner::RunOutput {
            ok: !o.timed_out && o.status.map(|s| s.success()).unwrap_or(false),
            stdout: o.stdout,
            stderr: o
                .stderr
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or_default()
                .to_string(),
        },
        Err(e) => fail(format!("python3 is needed to read the drill: {e}")),
    }
}

/// `xml`, `csv` ou `python`, pelo conteúdo de um drill.
pub(crate) fn drill_kind(code: &str) -> &'static str {
    let t = code.trim_start();
    if t.starts_with('<') {
        "xml"
    } else if t.starts_with("id,") || t.starts_with("\"id\",") {
        "csv"
    } else {
        "python"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> OdooTest {
        toml::from_str(
            "version = \"19.0\"\ninstall = [\"l10n_ao\", \"dxt_grade\"]\nmin_tests = 2\nmessage = \"Install it.\"\n",
        )
        .unwrap()
    }

    const OK_LOG: &str = "\
2026-11-27 10:31:30,030 1 INFO ? odoo: Odoo version 19.0-20261123
2026-11-27 10:31:44,301 1 INFO dxt odoo.modules.loading: Module l10n_ao loaded in 0.04s, 44 queries (+44 other)
2026-11-27 10:31:44,401 1 INFO dxt odoo.modules.loading: Module dxt_grade loaded in 0.01s, 4 queries (+4 other)
2026-11-27 10:31:45,162 1 INFO dxt odoo.tests.stats: dxt_grade: 4 tests 0.03s 9 queries
2026-11-27 10:31:45,162 1 INFO dxt odoo.tests.result: 0 failed, 0 error(s) of 3 tests when loading database 'dxt'
";

    fn run_of(log: &str) -> OdooRun {
        OdooRun {
            log: log.into(),
            code: Some(0),
            ..Default::default()
        }
    }

    #[test]
    fn a_clean_install_with_enough_passing_tests_passes() {
        let o = judge(&spec(), &run_of(OK_LOG), Duration::from_secs(60));
        assert!(o.iter().all(|x| x.ok), "{o:?}");
        assert_eq!(o.len(), 3);
        assert!(o[1].label.contains("3 ran, 0 failed"), "{}", o[1].label);
    }

    #[test]
    fn failing_tests_show_the_assertion_and_warnings_fail_the_log_check() {
        let log = format!(
            "{}2026-11-27 10:31:45,156 1 ERROR dxt odoo.addons.dxt_grade.tests.test_x: FAIL: TestX.test_nif\nTraceback (most recent call last):\n  File \"x.py\", line 3\nAssertionError: 'X' != 'Y'\n2026-11-27 10:31:45,157 1 WARNING dxt odoo.modules.module: Missing `author` key in manifest for 'l10n_ao', defaulting to ''\n",
            OK_LOG.replace("0 failed, 0 error(s) of 3", "1 failed, 0 error(s) of 3")
        );
        let o = judge(&spec(), &run_of(&log), Duration::from_secs(60));
        assert!(o[0].ok);
        assert!(
            !o[1].ok && o[1].detail.contains("AssertionError: 'X' != 'Y'"),
            "{}",
            o[1].detail
        );
        assert!(
            !o[2].ok && o[2].detail.contains("Missing `author`"),
            "{}",
            o[2].detail
        );
        assert!(
            !o[2].detail.contains("FAIL: TestX"),
            "a failed test is counted once"
        );
    }

    #[test]
    fn a_module_that_does_not_load_stops_at_the_install_with_the_traceback() {
        let log = "\
2026-11-27 10:30:45,549 1 WARNING dxt odoo.modules.loading: Transient module states were reset
2026-11-27 10:30:45,549 1 ERROR dxt odoo.modules.registry: Failed to load registry
2026-11-27 10:30:45,550 1 CRITICAL dxt odoo.service.server: Failed to initialize database `dxt`.
Traceback (most recent call last):
odoo.tools.convert.ParseError: while parsing /mnt/extra-addons/l10n_ao/views/x.xml:3
Invalid view type: 'tree'.
";
        let o = judge(&spec(), &run_of(log), Duration::from_secs(60));
        assert_eq!(o.len(), 1);
        assert!(!o[0].ok);
        assert!(
            o[0].detail.contains("Invalid view type: 'tree'"),
            "{}",
            o[0].detail
        );
        assert!(o[0].detail.contains("not loaded: l10n_ao, dxt_grade"));
    }

    #[test]
    fn too_few_tests_and_timeouts_fail_with_a_reason() {
        let log = OK_LOG.replace("of 3 tests", "of 1 tests");
        let o = judge(&spec(), &run_of(&log), Duration::from_secs(60));
        assert!(!o[1].ok && o[1].detail.contains("at least 2 expected"));
        let mut r = run_of("");
        r.timed_out = true;
        let o = judge(&spec(), &r, Duration::from_secs(60));
        assert!(!o[0].ok && o[0].detail.contains("60 s"));
    }

    #[test]
    fn log_entries_keep_their_tracebacks_and_ignore_other_lines() {
        let es = entries("Warn: Can't find .pfb for face 'Courier'\n2026-11-27 10:31:30,030 1 INFO ? odoo: Odoo version 18.0\nnot a log line\n");
        assert_eq!(es.len(), 1);
        assert_eq!(es[0].logger, "odoo");
        assert_eq!(es[0].more, vec!["not a log line"]);
        assert_eq!(test_result(&entries(OK_LOG)), Some((0, 0, 3)));
    }

    #[test]
    fn the_command_line_differs_by_series_where_the_source_says_so() {
        let mut s = spec();
        let a = odoo_args(&s, "pw", false);
        assert!(a.contains(&"--test-tags=/l10n_ao,/dxt_grade".to_string()));
        assert!(a.contains(&"--addons-path=/mnt/extra-addons".to_string()));
        assert!(
            !a.iter().any(|x| x.contains("demo")),
            "19.0 loads no demo data by default"
        );
        s.version = "18.0".into();
        let a = odoo_args(&s, "pw", true);
        assert!(a.contains(&"--without-demo=all".to_string()));
        assert!(a.contains(&"--addons-path=/mnt/extra-addons,/mnt/enterprise".to_string()));
    }

    #[test]
    fn enterprise_steps_without_enterprise_addons_say_so_with_the_code() {
        let mut s = spec();
        assert!(enterprise_addons(&s).unwrap().is_none());
        s.enterprise = true;
        s.enterprise_modules = vec!["hr_payroll".into()];
        // Sem a variável da série, o passo é saltado com o motivo.
        if std::env::var_os(odootest::enterprise_env("19.0")).is_none() {
            let e = enterprise_addons(&s).unwrap_err().to_string();
            assert!(
                e.starts_with(ENTERPRISE_MISSING) && e.contains("DXTUTOR_ODOO_ENTERPRISE_19"),
                "{e}"
            );
        }
    }

    #[test]
    fn drills_are_read_by_kind() {
        assert_eq!(drill_kind("<odoo/>"), "xml");
        assert_eq!(drill_kind("id,name\n"), "csv");
        assert_eq!(drill_kind("from odoo import models\n"), "python");
        if std::process::Command::new("python3")
            .arg("-V")
            .output()
            .is_ok()
        {
            assert!(run_odoo_drill("<odoo><record id='x' model='y'/></odoo>").ok);
            assert!(!run_odoo_drill("<odoo><record></odoo>").ok);
            assert!(run_odoo_drill("id,name\na,b\n").ok);
            assert!(!run_odoo_drill("id,name\na,b,c\n").ok);
            assert!(run_odoo_drill("x = {'a': 1}\n").ok);
            assert!(!run_odoo_drill("def f(:\n").ok);
        }
    }
}
