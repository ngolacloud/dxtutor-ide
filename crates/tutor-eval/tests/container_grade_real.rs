//! Um passo de um curso de contentores avaliado de ponta a ponta no sandbox Podman real (Learn
//! P3a), SEM rede: a imagem «preparada» é construída aqui a partir do `busybox` estático do
//! anfitrião e registada como a cache do curso. Prova a construção (com a guarda), o `run` com
//! limites, `image inspect` + verificações, volumes, o espaço de rede partilhado, o healthcheck, a
//! cache de construção (`append` + reconstruir), a solução a passar, o início a falhar, a recusa de
//! um curso por preparar, e que nada fica no sandbox. Salta numa máquina sem `podman`, sem sessão
//! systemd ou sem `busybox` estático.

use std::collections::BTreeMap;

use tutor_core::{Gabarito, Level, Phase, ProjectFiles};
use tutor_eval::course_cache::{fingerprint, layout, Marker};
use tutor_eval::sandbox::{root_for, testing, LABEL_SANDBOX};

const IMG: &str = "localhost/fixture/busybox:1";

const CHECKS: &str = r#"
[[run]]
cmd = ["podman", "build", "-t", "app", "--format", "docker", "."]
message = "The image must build."

[[run]]
cmd = ["podman", "run", "--rm", "app"]
output_contains = ["hello from the sandbox"]
message = "Running the image prints the greeting (CMD)."

[[run]]
cmd = ["podman", "image", "inspect", "app"]
save = "image.json"
message = "The image can be inspected."

[[check]]
file = "image.json"
path = "[0].Config.User"
equals = "1000"
message = "The image runs as user 1000."

[[check]]
file = "image.json"
path = "[0].Config.ExposedPorts"
contains = { "8080/tcp" = {} }
message = "The image documents port 8080."

[[check]]
file = "image.json"
path = "[0].Size"
at_most = 20000000
message = "The image stays small."

[[run]]
cmd = ["podman", "run", "--mount", "type=image,source=app,target=/img", "localhost/fixture/busybox:1", "test", "-f", "/img/www/index.html"]
message = "The page is in the image."

[[run]]
cmd = ["podman", "volume", "create", "data"]
message = "A volume."

[[run]]
cmd = ["podman", "run", "--rm", "-u", "0", "-v", "data:/data", "app", "sh", "-c", "echo kept > /data/x"]
message = "A container writes to the volume."

[[run]]
cmd = ["podman", "run", "--rm", "-v", "data:/data:ro", "app", "cat", "/data/x"]
output_contains = ["kept"]
message = "The data outlives the container."

[[run]]
cmd = ["podman", "run", "-d", "--name", "web", "app", "httpd", "-f", "-p", "8080", "-h", "/www"]
message = "The web server starts."

[[run]]
cmd = ["podman", "run", "--rm", "--network", "container:web", "localhost/fixture/busybox:1", "wget", "-q", "-O", "-", "http://127.0.0.1:8080/"]
retries = 5
output_contains = ["it works"]
message = "The server answers on port 8080 inside the sandbox."

[[run]]
cmd = ["podman", "healthcheck", "run", "web"]
retries = 5
message = "The health check passes."

[[run]]
cmd = ["podman", "exec", "web", "id", "-u"]
output_contains = ["1000"]
message = "The server runs as user 1000."

[[run]]
cmd = ["podman", "run", "--rm", "app", "wget", "-q", "-T", "2", "-O", "-", "http://10.0.2.2/"]
expect = "failure"
message = "A container has no network."

[[run]]
cmd = ["append", "www/index.html", "<!-- changed -->\n"]
message = "Change the page."

[[run]]
cmd = ["podman", "build", "-t", "app2", "--format", "docker", "."]
output_matches = ['(?s)STEP 2/\d+: COPY greeting.txt /greeting.txt\n--> Using cache']
output_lacks = ["STEP 3/7: COPY www /www\n--> Using cache"]
message = "Changing the page reuses the cached layers before it."
"#;

const SOLUTION: &str = "FROM localhost/fixture/busybox:1\nCOPY greeting.txt /greeting.txt\nCOPY www /www\nEXPOSE 8080\nUSER 1000\nHEALTHCHECK --interval=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1\nCMD [\"cat\", \"/greeting.txt\"]\n";

fn phase(images: &[String]) -> Phase {
    let map = |p: &[(&str, &str)]| {
        p.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<BTreeMap<_, _>>()
    };
    let starter = map(&[
        (
            "Containerfile",
            "FROM localhost/fixture/busybox:1\nCOPY greeting.txt /greeting.txt\nCOPY www /www\n",
        ),
        ("greeting.txt", "hello from the sandbox\n"),
        ("www/index.html", "<p>it works</p>\n"),
    ]);
    let solution = map(&[("Containerfile", SOLUTION)]);
    Phase {
        id: "fixture-step".into(),
        title: "t".into(),
        level: Level::Basico,
        language: "dockerfile".into(),
        instructions: String::new(),
        entry: String::new(),
        starter: String::new(),
        tests: String::new(),
        gabarito: Gabarito {
            solution: String::new(),
            time: String::new(),
            space: String::new(),
            justification: String::new(),
        },
        probe: None,
        hints: Vec::new(),
        dependencies: Vec::new(),
        project: Some(ProjectFiles {
            main: "Containerfile".into(),
            starter,
            readonly: vec!["greeting.txt".into(), "www/index.html".into()],
            tests: map(&[("checks.toml", CHECKS)]),
            solution,
            explanation: String::new(),
        }),
        build: tutor_core::BuildEnv {
            cache: Some(tutor_core::CourseCache {
                key: "fixture-course".into(),
                language: "dockerfile".into(),
                dependencies: images.to_vec(),
            }),
            timeout_secs: 120,
        },
        support: Default::default(),
    }
}

#[test]
fn a_container_step_is_graded_in_the_sandbox_and_leaves_nothing_behind() {
    let tmp = tempfile::tempdir().unwrap();
    let cache_root = tmp.path().join("course-cache");
    std::env::set_var("DXTUTOR_COURSE_CACHE", &cache_root);
    std::env::remove_var(tutor_eval::sandbox::ROOT_ENV);
    let sb_root = root_for(&cache_root);
    let Some(sb) = testing::sandbox_or_skip(&sb_root) else {
        return;
    };
    let digest = testing::busybox_image(&sb, IMG).expect("fixture image");
    let images = vec![format!("{IMG}@{digest}")];
    let p = phase(&images);
    let project = p.project.clone().unwrap();

    // Not prepared yet: refused before anything runs.
    let e = tutor_eval::assess_project(&p, &project.solution)
        .unwrap_err()
        .to_string();
    assert!(e.contains("COURSE_NOT_PREPARED"), "{e}");

    // «Prepared»: the marker says so (the image is already in the sandbox).
    let l = layout(&cache_root, "fixture-course").unwrap();
    std::fs::create_dir_all(&l.dir).unwrap();
    let marker = Marker {
        fingerprint: fingerprint(&images),
        prepared_at: 0,
        fetch_secs: 0.0,
        warm_secs: 0.0,
        tool: "test".into(),
    };
    std::fs::write(&l.marker, serde_json::to_vec(&marker).unwrap()).unwrap();

    let good = tutor_eval::assess_project(&p, &project.solution).unwrap();
    eprintln!("{}", good.correctness.raw);
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    assert!(
        good.correctness.raw.contains("rootless Podman sandbox"),
        "{}",
        good.correctness.raw
    );
    assert!(
        !good.correctness.raw.contains("dxtutor-"),
        "the run id is hidden: {}",
        good.correctness.raw
    );

    let bad = tutor_eval::assess_project(&p, &BTreeMap::new()).unwrap();
    assert!(!bad.correctness.passed);
    assert!(
        bad.correctness.raw.contains("prints the greeting")
            && bad.correctness.raw.contains("runs as user 1000"),
        "{}",
        bad.correctness.raw
    );

    // A FROM that is not prepared is refused by the guard, in words, and nothing is pulled.
    let mut other = project.solution.clone();
    other.insert(
        "Containerfile".into(),
        "FROM docker.io/library/alpine:3.24.4\n".into(),
    );
    let r = tutor_eval::assess_project(&p, &other).unwrap();
    assert!(
        !r.correctness.passed && r.correctness.raw.contains("not one of the images"),
        "{}",
        r.correctness.raw
    );

    // Nothing of the grading runs is left: no containers, no volumes, no labelled images; the
    // prepared image stays.
    let out = |a: &[&str]| {
        let o = sb
            .exec(
                &a.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                std::time::Duration::from_secs(60),
            )
            .unwrap();
        assert!(o.ok(), "{}", o.stderr);
        o.stdout.trim().to_string()
    };
    assert_eq!(out(&["ps", "-a", "--external", "-q"]), "");
    assert_eq!(out(&["volume", "ls", "-q"]), "");
    assert_eq!(
        out(&[
            "images",
            "-q",
            "--filter",
            &format!("label={LABEL_SANDBOX}")
        ]),
        ""
    );
    assert_eq!(
        out(&["images", "--format", "{{.Repository}}:{{.Tag}}"]),
        IMG
    );
    sb.destroy().unwrap();
}
