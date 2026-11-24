//! Os cursos embutidos da UI (`ui-app/src/content/courses/<lang>.json`) são uma PROJECÇÃO dos
//! cursos canónicos (`courses/<lang>/courses/<lang>.toml`), gerada por
//! `scripts/sync-ui-courses.py`. Este teste falha se alguém editar um sem o outro: a UI do
//! browser e o backend (avaliação, plugins) ensinariam conteúdos diferentes.

use serde_json::Value;
use std::path::PathBuf;

const STEP_BACKEND_ONLY: [&str; 3] = ["install_commands", "run_command", "dependencies"];
const COURSE_BACKEND_ONLY: [&str; 2] = ["language", "level"];

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn project(mut course: Value) -> Value {
    let obj = course.as_object_mut().expect("curso é uma tabela");
    for k in COURSE_BACKEND_ONLY {
        obj.remove(k);
    }
    let mut units = obj.remove("unit").expect("[[unit]]");
    for u in units.as_array_mut().expect("unit é lista") {
        let u = u.as_object_mut().unwrap();
        let mut steps = u.remove("step").expect("[[unit.step]]");
        for s in steps.as_array_mut().unwrap() {
            let s = s.as_object_mut().unwrap();
            for k in STEP_BACKEND_ONLY {
                s.remove(k);
            }
        }
        u.insert("steps".into(), steps);
    }
    obj.insert("units".into(), units);
    course
}

#[test]
fn ui_json_e_projeccao_do_toml() {
    for lang in ["rust", "go"] {
        let toml_path = repo().join(format!("courses/{lang}/courses/{lang}.toml"));
        let json_path = repo().join(format!("ui-app/src/content/courses/{lang}.json"));
        let t: toml::Value = toml::from_str(&std::fs::read_to_string(&toml_path).unwrap()).unwrap();
        let expected = project(serde_json::to_value(t).unwrap());
        let got: Value =
            serde_json::from_str(&std::fs::read_to_string(&json_path).unwrap()).unwrap();
        assert!(
            expected == got,
            "{} está desactualizado em relação a {} — corre `python3 scripts/sync-ui-courses.py`",
            json_path.display(),
            toml_path.display()
        );
    }
}
