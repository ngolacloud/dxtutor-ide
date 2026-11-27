//! O sandbox de contentores real (Learn P3a), sem rede: uma raiz temporária, uma imagem construída
//! a partir do `busybox` estático do anfitrião, limites verificados, etiquetas, limpeza por corrida
//! e dos restos, e nada tocado fora da raiz. Salta (com uma nota) numa máquina sem `podman`, sem
//! sessão systemd ou sem `busybox` estático.

use std::time::Duration;

use tutor_eval::sandbox::{testing, Run, LABEL_RUN, LABEL_SANDBOX, PURPOSE_GRADE};

fn args(s: &[&str]) -> Vec<String> {
    s.iter().map(|x| x.to_string()).collect()
}

fn lines(sb: &tutor_eval::sandbox::Sandbox, a: &[&str]) -> Vec<String> {
    let out = sb.exec(&args(a), Duration::from_secs(60)).unwrap();
    assert!(out.ok(), "podman {a:?}: {}", out.stderr);
    out.stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// A pasta do armazenamento do Podman do utilizador: a data do `db.sql` não pode mudar.
fn owner_db_mtime() -> Option<std::time::SystemTime> {
    let home = std::env::var_os("HOME")?;
    std::fs::metadata(std::path::Path::new(&home).join(".local/share/containers/storage/db.sql"))
        .and_then(|m| m.modified())
        .ok()
}

#[test]
fn the_sandbox_runs_limited_labelled_containers_and_cleans_up_after_itself() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("sandbox");
    let Some(sb) = testing::sandbox_or_skip(&root) else {
        return;
    };
    let _cleanup = testing::DestroyOnDrop(sb.clone());
    let owner_before = owner_db_mtime();
    let v = sb.version().expect("podman --version");
    assert!(v.starts_with("podman version"), "{v}");

    let img = "localhost/fixture/busybox:1";
    let digest = testing::busybox_image(&sb, img).expect("fixture image");
    assert!(digest.starts_with("sha256:"), "{digest}");
    assert!(sb.has_image(img).unwrap());
    assert!(!sb.has_image("localhost/fixture/nothing:1").unwrap());
    // Everything stays inside the root: storage, config, and the user's HOME is never used.
    assert!(root.join("storage").is_dir() && root.join("config/containers.conf").is_file());

    sb.verify_limits(img).expect("the limits apply");

    // A leftover of an earlier, interrupted grading run…
    let leftover = sb
        .exec(
            &args(&[
                "run",
                "-d",
                "--network",
                "none",
                "--label",
                &format!("{LABEL_SANDBOX}={PURPOSE_GRADE}"),
                "--label",
                &format!("{LABEL_RUN}=0123456789ab"),
                img,
                "sleep",
                "600",
            ]),
            Duration::from_secs(60),
        )
        .unwrap();
    assert!(leftover.ok(), "{}", leftover.stderr);
    // …and something with another purpose (a kind cluster of Learn P3b), which must survive.
    let other = sb
        .exec(
            &args(&[
                "volume",
                "create",
                "--label",
                &format!("{LABEL_SANDBOX}=kind"),
                "keepme",
            ]),
            Duration::from_secs(60),
        )
        .unwrap();
    assert!(other.ok(), "{}", other.stderr);

    let run_id;
    {
        let run = Run::start(&sb).expect("start a run");
        run_id = run.id.clone();
        assert!(
            lines(&sb, &["ps", "-a", "-q"]).is_empty(),
            "the leftover grading container is gone"
        );
        let labels: Vec<String> = run
            .labels()
            .iter()
            .flat_map(|(k, v)| ["--label".to_string(), format!("{k}={v}")])
            .collect();
        let mut a = args(&["volume", "create"]);
        a.extend(labels.clone());
        a.push(format!("dx-{run_id}-data"));
        assert!(sb.exec(&a, Duration::from_secs(60)).unwrap().ok());
        let mut a = args(&["run", "-d", "--name", &format!("dx-{run_id}-web")]);
        let mut lim = tutor_eval::ContainerLimits::grading();
        lim.labels = run.labels();
        a.extend(lim.run_args());
        a.extend(args(&[
            "--network",
            "none",
            "-v",
            &format!("dx-{run_id}-data:/data"),
            img,
            "sh",
            "-c",
            "echo hi > /data/x; sleep 600",
        ]));
        let started = sb.exec(&a, Duration::from_secs(60)).unwrap();
        assert!(started.ok(), "{}", started.stderr);
        // The memory/pids limits are those of the grading profile, inside the container.
        let inside = lines(
            &sb,
            &[
                "exec",
                &format!("dx-{run_id}-web"),
                "cat",
                "/sys/fs/cgroup/pids.max",
                "/proc/self/status",
            ],
        );
        assert_eq!(inside[0], "128");
        assert!(
            inside
                .iter()
                .any(|l| l.starts_with("CapEff:") && l.ends_with("0000000000000000")),
            "no capabilities: {inside:?}"
        );
        // No network: only the loopback interface.
        let net = sb
            .exec(
                &args(&["exec", &format!("dx-{run_id}-web"), "ls", "/sys/class/net"]),
                Duration::from_secs(30),
            )
            .unwrap();
        assert_eq!(net.stdout.split_whitespace().collect::<Vec<_>>(), ["lo"]);
    } // the run ends: its cleanup runs here

    let filter = format!("label={LABEL_RUN}={run_id}");
    assert!(lines(&sb, &["ps", "-a", "-q", "--filter", &filter]).is_empty());
    assert!(lines(&sb, &["volume", "ls", "-q", "--filter", &filter]).is_empty());
    assert_eq!(
        lines(&sb, &["volume", "ls", "-q"]),
        ["keepme"],
        "only another purpose's volume is left"
    );
    // The fixture image (like a prepared base image) stays: only labelled images go.
    assert!(sb.has_image(img).unwrap());

    assert_eq!(
        owner_db_mtime(),
        owner_before,
        "the user's own Podman storage was not touched"
    );
    sb.destroy().expect("remove the sandbox");
    assert!(!root.exists());
}
