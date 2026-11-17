//! Integração do 13º e último grupo (estudo/missões), Etapa 3.
//!
//! Prova que as fachadas dos casos de uso são alcançáveis de FORA do crate (o ponto de
//! `pub mod study` / `pub mod missions`): o crate de teste só vê `dxtutor_ide_lib`, não
//! `tutor_core`/`tutor_eval`/`tutor_llm`. Exercita a parte testável headless — as regras
//! puras (classificação de passos, política, despacho de drill) e os erros de contrato
//! tipados — SEM compilar/correr código do aluno (os caminhos pesados de `tutor_eval::assess`
//! e dos runners validam-se na máquina do utilizador / nos e2e `#[ignore]` do `tutor-eval`).

use dxtutor_ide_lib::missions::{drill_language, DrillLang};
use dxtutor_ide_lib::study::{self, StudyError};

#[test]
fn the_editor_project_loads_through_the_public_facade() {
    let project = study::load_project().expect("conteúdo embutido do editor");
    assert_eq!(project.id, study::PROJECT_ID);
    assert!(!project.phases.is_empty(), "o projecto tem fases");
}

#[test]
fn content_loaders_type_their_contract_errors() {
    // Pelo menos o curso/glossário de Rust existe; uma linguagem inventada dá o erro tipado
    // com a mensagem histórica EXACTA (o adaptador IPC mapeia-a crua para `String`).
    assert!(study::course("rust").is_ok());
    assert_eq!(
        study::course("klingon").unwrap_err(),
        StudyError::NoCourse("klingon".to_string())
    );
    assert_eq!(
        study::glossary("klingon").unwrap_err().to_string(),
        "no glossary for language `klingon`"
    );
    assert_eq!(
        study::study_guide("klingon", "u1").unwrap_err().to_string(),
        "no study guide for language `klingon` unit `u1`"
    );
    assert!(!study::courses().is_empty());
}

#[test]
fn grading_an_unknown_target_errors_before_compiling() {
    // Alvos inexistentes falham ANTES de qualquer compilação → o teste é rápido e não precisa
    // de toolchain. As mensagens são as que `submit`/`submit_step` emitiam.
    assert_eq!(
        study::grade_step("no-such-step", "fn main() {}").unwrap_err(),
        StudyError::StepNotFound("no-such-step".to_string())
    );
    assert_eq!(
        study::grade_step("no-such-step", "")
            .unwrap_err()
            .to_string(),
        "step `no-such-step` not found"
    );
    assert_eq!(
        study::grade_phase("no-such-phase", "fn main() {}").unwrap_err(),
        StudyError::PhaseNotFound("no-such-phase".to_string())
    );
}

#[test]
fn step_classification_and_policy_hold_the_contract() {
    // Id desconhecido → autónomo (falha fechada) e linguagem por omissão "rust".
    assert!(study::step_is_autonomous(Some("no-such-step")));
    assert!(study::step_is_autonomous(None));
    assert_eq!(study::step_language("no-such-step"), "rust");

    // A política de estudo serializa num objecto (o contrato que o webview recebe); modo
    // inválido cai no default de `Mode::parse` sem entrar em pânico.
    let policy = serde_json::to_value(study::study_policy("tutor", Some("no-such-step")))
        .expect("StudyPolicy serializa");
    assert!(policy.is_object());
}

#[test]
fn drill_language_dispatches_go_vs_rust_through_the_facade() {
    assert_eq!(drill_language("go"), DrillLang::Go);
    assert_eq!(drill_language("  GoLang \n"), DrillLang::Go); // trim + case-insensitive
    assert_eq!(drill_language("rust"), DrillLang::Rust);
    assert_eq!(drill_language("python"), DrillLang::Rust); // tudo o resto → Rust
}
