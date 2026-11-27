//! `dxt plugin test` contra o plugin-fixture de framework com um passo de projecto
//! (`crates/tutor-plugins/tests/fixtures/framework-project`): o binário real, o avaliador
//! real (`python3` do anfitrião). Os ficheiros da solução passam e os iniciais falham; e uma
//! cópia em que o starter já passa é reprovada.

use std::path::{Path, PathBuf};
use std::process::Command;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../tutor-plugins/tests/fixtures/framework-project")
}

fn python_available() -> bool {
    Command::new("python3")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
}

fn dxt(args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_dxt"))
        .args(args)
        .output()
        .expect("run dxt");
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out.status.success(), text)
}

#[test]
fn the_fixture_validates_strictly_and_every_step_passes() {
    let dir = fixture();
    let (ok, out) = dxt(&["plugin", "validate", dir.to_str().unwrap(), "--strict"]);
    assert!(ok, "{out}");
    if !python_available() {
        eprintln!("python3 missing: skipping the grading half");
        return;
    }
    let (ok, out) = dxt(&["plugin", "test", dir.to_str().unwrap()]);
    assert!(ok, "{out}");
    assert!(
        out.contains("framework `minishop`, graded as python"),
        "{out}"
    );
    assert!(out.contains("✓ challenge msf-p1-cart (4 files, "), "{out}");
    assert!(out.contains("3 ok, 0 failed"), "{out}");
}

#[test]
fn a_project_whose_starter_already_passes_is_rejected() {
    if !python_available() {
        return;
    }
    let tmp = std::env::temp_dir().join(format!("dxt-fixture-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("courses")).unwrap();
    std::fs::copy(
        fixture().join("dxtutor-plugin.json"),
        tmp.join("dxtutor-plugin.json"),
    )
    .unwrap();
    let course = std::fs::read_to_string(fixture().join("courses/minishop.toml")).unwrap();
    // O teste do carrinho vazio passa a ser o único, e o starter de `total` já o cumpre: os
    // testes deixam de provar alguma coisa.
    let weak = course
        .replace(
            "def total(items):\n    raise NotImplementedError",
            "def total(items):\n    return 0",
        )
        .replace(
            "def with_vat(amount):\n    raise NotImplementedError",
            "def with_vat(amount):\n    return 0",
        );
    let start = weak.find("[unit.step.project.tests]").unwrap();
    let end = weak.find("[unit.step.project.solution]").unwrap();
    let weak = format!(
        "{}[unit.step.project.tests]\n\"test_shop.py\" = '''\nimport unittest\nfrom shop.cart import total\n\nclass Cart(unittest.TestCase):\n    def test_empty(self):\n        self.assertEqual(total([]), 0)\n'''\n\n{}",
        &weak[..start],
        &weak[end..]
    );
    std::fs::write(tmp.join("courses/minishop.toml"), weak).unwrap();
    let (ok, out) = dxt(&["plugin", "test", tmp.to_str().unwrap()]);
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(!ok, "{out}");
    assert!(
        out.contains("the starter files already pass the tests"),
        "{out}"
    );
}
