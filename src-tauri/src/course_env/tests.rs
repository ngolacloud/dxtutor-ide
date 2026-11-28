//! O ambiente do curso com um runtime FALSO: um script que regista os argumentos de cada chamada e responde como o
//! podman e o avaliador responderiam. O avaliador verdadeiro prova-se no seu crate (`tutor-grade`) e numa imagem a
//! sério no CI (`grader-image.yml`); aqui prova-se o lado da IDE — o plano, o build aprovado, as opções do `run`, o
//! pedido no stdin e a leitura do relatório.

use super::*;
use std::os::unix::fs::PermissionsExt;
use tutor_core::grade::{Outcome, Submission};

const PINNED: &str = "docker.io/library/python:3.12-slim-bookworm@sha256:44cf1793efa7c7a476bb0f2cff81443f4a072c90c1cb127e2924933daa3e8c64";
const GRADER: &str = "ghcr.io/ngolacloud/dxtutor-grade:0.7.0@sha256:0000000000000000000000000000000000000000000000000000000000000000";

/// O runtime falso. `image inspect` vê o ficheiro `built`; `build` cria-o; `run` lê o pedido e responde com um
/// relatório: passa se o código diz PASS, o passo `boom` responde lixo, o `slow` demora, o `oops` é um erro.
const FAKE: &str = r#"#!/usr/bin/env python3
import json, os, sys, time
here = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
with open(os.path.join(here, "calls"), "a") as f:
    f.write(json.dumps(args) + "\n")
if args[:2] == ["image", "inspect"]:
    sys.exit(0 if os.path.exists(os.path.join(here, "built")) else 1)
if args[:1] == ["build"]:
    open(os.path.join(here, "built"), "w").close()
    print("STEP 1/2: FROM ...\nbuilt")
    sys.exit(0)
if args[:1] == ["rm"]:
    sys.exit(0)
if args[:1] == ["run"]:
    req = json.loads(sys.stdin.read())
    step = req["step"]
    if step == "boom":
        print("not json"); sys.exit(3)
    if step == "slow":
        time.sleep(30)
    if step == "oops":
        print(json.dumps({"protocol": 1, "step": step, "outcome": "error",
                          "error": {"code": "STEP_NOT_FOUND", "message": "no step"}, "grader": "fake"}))
        sys.exit(3)
    if step == "other":
        step = "not-the-one"
    ok = "PASS" in req["submission"].get("code", "")
    print(json.dumps({"protocol": 1, "step": step, "course": "python-basics",
                      "outcome": "passed" if ok else "failed",
                      "correctness": {"passed": ok, "summary": "1 test", "raw": "" if ok else "AssertionError"},
                      "grader": "fake"}))
    sys.exit(0)
sys.exit(9)
"#;

struct Fixture {
    _tmp: tempfile::TempDir,
    rt: Runtime,
    bin: PathBuf,
    store: tutor_plugins::Store,
}

impl Fixture {
    fn calls(&self) -> Vec<Vec<String>> {
        std::fs::read_to_string(self.bin.join("calls"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
}

/// O curso de Python do repositório com um `.devcontainer/`, instalado numa loja temporária.
fn fixture(containerfile: &str) -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let src = tmp.path().join("src");
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../courses/python");
    copy(&repo, &src);
    std::fs::create_dir_all(src.join(".devcontainer")).unwrap();
    std::fs::write(
        src.join(".devcontainer/devcontainer.json"),
        "{\n  // the course's grading image\n  \"name\": \"python\",\n  \"build\": { \"dockerfile\": \"Containerfile\", \"context\": \"..\" }\n}\n",
    )
    .unwrap();
    std::fs::write(src.join(".devcontainer/Containerfile"), containerfile).unwrap();
    let store = tutor_plugins::Store::at(tmp.path().join("store"));
    store
        .install(&tutor_plugins::Source::LocalDir(src), "0.7.0", &[])
        .unwrap();
    let bin = tmp.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let program = bin.join("podman");
    std::fs::write(&program, FAKE).unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    Fixture {
        rt: Runtime {
            name: "podman".into(),
            program,
        },
        bin,
        store,
        _tmp: tmp,
    }
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        if p.is_dir() {
            copy(&p, &to.join(e.file_name()));
        } else {
            std::fs::copy(&p, to.join(e.file_name())).unwrap();
        }
    }
}

fn good() -> String {
    format!("FROM {PINNED}\nCOPY --from={GRADER} /dxtutor-grade /usr/local/bin/dxtutor-grade\nUSER 1000:1000\n")
}

fn ask(step: &str, code: &str) -> GradeRequest {
    GradeRequest::new(
        step,
        Some("python".into()),
        Submission::Code { code: code.into() },
    )
}

#[test]
fn an_installed_course_with_a_devcontainer_is_found_with_its_pinned_bases() {
    let f = fixture(&good());
    let env = find(&f.store, "python-basics").unwrap().expect("found");
    assert!(
        env.tag
            .starts_with("localhost/dxtutor-course-python-basics:"),
        "{}",
        env.tag
    );
    assert_eq!(env.bases, vec![PINNED.to_string(), GRADER.to_string()]);
    assert!(env.plugin_dir.join("dxtutor-plugin.json").is_file());
    assert!(env.dockerfile.ends_with(".devcontainer/Containerfile"));
    assert!(find(&f.store, "no-such-course").unwrap().is_none());
    // The same folder gives the same tag; a changed course is another image.
    assert_eq!(
        of_dir(&env.plugin_dir, "python-basics").unwrap().tag,
        env.tag
    );
    std::fs::write(env.plugin_dir.join("README.md"), "changed").unwrap();
    assert_ne!(
        of_dir(&env.plugin_dir, "python-basics").unwrap().tag,
        env.tag
    );
}

#[test]
fn a_devcontainer_that_does_not_keep_the_contract_is_refused_with_why() {
    let f = fixture("FROM docker.io/library/python:3.12-slim\nCOPY --from=ghcr.io/ngolacloud/dxtutor-grade:0.7.0 /dxtutor-grade /usr/local/bin/\n");
    let e = find(&f.store, "python-basics").unwrap_err().to_string();
    assert!(
        e.contains("pinned by digest") && e.contains("python:3.12-slim"),
        "{e}"
    );
    assert!(
        e.contains("dxtutor-grade:0.7.0"),
        "an unpinned COPY --from is named too: {e}"
    );

    let dir = f.store.root().join("python");
    std::fs::write(
        dir.join(".devcontainer/devcontainer.json"),
        r#"{"build": {"dockerfile": "../../../etc/passwd"}}"#,
    )
    .unwrap();
    let e = of_dir(&dir, "python-basics").unwrap_err().to_string();
    assert!(
        e.contains("outside the course") || e.contains("build.dockerfile"),
        "{e}"
    );
    std::fs::write(
        dir.join(".devcontainer/devcontainer.json"),
        r#"{"image": "x"}"#,
    )
    .unwrap();
    let e = of_dir(&dir, "python-basics").unwrap_err().to_string();
    assert!(e.contains("`build`"), "{e}");
}

#[test]
fn the_bases_are_the_external_images_only() {
    let file = "FROM --platform=linux/amd64 rust:1@sha256:a AS build\nRUN x\nFROM build AS test\nCOPY --from=build /a /b\nCOPY --from=0 /c /d\nFROM debian@sha256:b\nCOPY --from=ghcr.io/x/y:1@sha256:c /g /h\nFROM ${BASE}\n";
    assert_eq!(
        bases_of(file),
        vec![
            "rust:1@sha256:a",
            "debian@sha256:b",
            "ghcr.io/x/y:1@sha256:c"
        ]
    );
}

#[test]
fn preparing_runs_only_the_approved_plan() {
    let f = fixture(&good());
    let env = find(&f.store, "python-basics").unwrap().unwrap();
    let plan = plan(&f.rt, &env);
    assert!(
        plan.starts_with(&format!("podman build -t {} -f ", env.tag)),
        "{plan}"
    );
    assert!(!image_ready(&f.rt, &env));
    assert_eq!(
        build(&f.rt, &env, "podman build something-else").unwrap_err(),
        EnvError::StalePlan
    );
    assert!(
        f.calls().iter().all(|c| c[0] != "build"),
        "a stale plan runs nothing"
    );
    let built = build(&f.rt, &env, &plan).unwrap();
    assert!(built.ok && built.output.contains("built"), "{built:?}");
    assert!(image_ready(&f.rt, &env));
    let calls = f.calls();
    let b = calls.iter().find(|c| c[0] == "build").unwrap();
    assert_eq!(b, &build_args(&env));
}

#[test]
fn grading_before_preparing_says_course_not_prepared() {
    let f = fixture(&good());
    let env = find(&f.store, "python-basics").unwrap().unwrap();
    let e = grade(&f.rt, &env, &ask("s1", "PASS"), DEFAULT_TIMEOUT).unwrap_err();
    assert!(matches!(e, EnvError::NotPrepared(_)));
    assert!(e.to_string().starts_with(NOT_PREPARED), "{e}");
    assert!(f.calls().iter().all(|c| c[0] != "run"));
}

#[test]
fn grading_runs_the_image_without_network_or_the_learners_folder() {
    let f = fixture(&good());
    let env = find(&f.store, "python-basics").unwrap().unwrap();
    build(&f.rt, &env, &plan(&f.rt, &env)).unwrap();

    let r = grade(&f.rt, &env, &ask("s1", "print('PASS')"), DEFAULT_TIMEOUT).unwrap();
    assert_eq!(r.outcome, Outcome::Passed);
    let r = grade(&f.rt, &env, &ask("s1", "nope"), DEFAULT_TIMEOUT).unwrap();
    assert_eq!(r.outcome, Outcome::Failed);
    assert_eq!(r.correctness.unwrap().raw, "AssertionError");

    let calls = f.calls();
    let run = calls.iter().find(|c| c[0] == "run").unwrap();
    let has = |pair: &[&str]| run.windows(pair.len()).any(|w| w == pair);
    assert!(
        has(&["--network", "none"]) && has(&["--read-only"]) && has(&["--cap-drop=ALL"]),
        "{run:?}"
    );
    assert!(
        has(&["--security-opt", "no-new-privileges"]) && has(&["--rm", "-i"]),
        "{run:?}"
    );
    let mounts: Vec<&String> = run
        .iter()
        .zip(run.iter().skip(1))
        .filter(|(a, _)| *a == "-v")
        .map(|(_, m)| m)
        .collect();
    assert_eq!(
        mounts,
        vec![&format!("{}:{COURSE_MOUNT}:ro", env.plugin_dir.display())],
        "only the course, read-only"
    );
    assert_eq!(
        &run[run.len() - 2..],
        &[env.tag.clone(), "dxtutor-grade".to_string()]
    );
}

#[test]
fn a_bad_or_foreign_answer_is_never_a_grade() {
    let f = fixture(&good());
    let env = find(&f.store, "python-basics").unwrap().unwrap();
    build(&f.rt, &env, &plan(&f.rt, &env)).unwrap();
    let e = grade(&f.rt, &env, &ask("oops", ""), DEFAULT_TIMEOUT)
        .unwrap_err()
        .to_string();
    assert!(
        e.starts_with("STEP_NOT_FOUND: "),
        "the grader's code comes first: {e}"
    );
    let e = grade(&f.rt, &env, &ask("boom", ""), DEFAULT_TIMEOUT)
        .unwrap_err()
        .to_string();
    assert!(e.contains("no report") && e.contains("not json"), "{e}");
    let e = grade(&f.rt, &env, &ask("other", "PASS"), DEFAULT_TIMEOUT)
        .unwrap_err()
        .to_string();
    assert!(e.contains("not-the-one"), "a report for another step: {e}");
}

#[test]
fn a_grading_past_its_time_is_stopped_and_its_container_removed() {
    let f = fixture(&good());
    let env = find(&f.store, "python-basics").unwrap().unwrap();
    build(&f.rt, &env, &plan(&f.rt, &env)).unwrap();
    let started = Instant::now();
    let e = grade(&f.rt, &env, &ask("slow", ""), Duration::from_secs(1))
        .unwrap_err()
        .to_string();
    assert!(e.contains("longer than 1 s"), "{e}");
    assert!(started.elapsed() < Duration::from_secs(20));
    let calls = f.calls();
    let name = {
        let run = calls.iter().find(|c| c[0] == "run").unwrap();
        run[run.iter().position(|a| a == "--name").unwrap() + 1].clone()
    };
    assert!(
        calls
            .iter()
            .any(|c| c == &vec!["rm".to_string(), "-f".into(), name.clone()]),
        "{calls:?}"
    );
}

#[test]
fn a_base_image_reads_as_name_tag_and_short_digest() {
    let p = image_package(PINNED);
    assert_eq!(
        (p.name.as_str(), p.version.as_str()),
        ("docker.io/library/python", "3.12-slim-bookworm")
    );
    assert_eq!(p.source, "sha256:44cf1793efa7");
    assert!(p.pinned);
    let p = image_package("localhost:5000/img@sha256:abc");
    assert_eq!(
        (p.name.as_str(), p.version.as_str()),
        ("localhost:5000/img", "")
    );
}
