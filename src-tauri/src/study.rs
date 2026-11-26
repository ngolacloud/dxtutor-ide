//! Caso de uso «estudo» — **independente de Tauri** (Etapa 3, 13º grupo).
//!
//! O núcleo do «cérebro» dxtutor (currículo + avaliação) vivia em `lib.rs` dentro dos
//! `#[tauri::command]`. As *regras* que não pertencem a nenhum mecanismo externo mudam-se
//! para cá como funções puras/testáveis, deixando os adaptadores (`commands::study`) só
//! com a fronteira IPC (serde + `spawn_blocking` + mapeamento erro→`String`):
//!
//! - a **classificação pedagógica** de um passo guiado ([`course_step`], [`step_language`],
//!   [`step_is_autonomous`]) e a **política de estudo** que daí decorre ([`study_policy`]);
//!   estas servem também o grupo `assistant` (`crate::study::step_language` /
//!   `step_is_autonomous`), por isso vivem aqui, não no adaptador;
//! - o **carregamento** do projecto/curso/glossário/guia com o seu erro de contrato
//!   ([`StudyError`]) — o que antes eram `ok_or_else(|| format!(...))` dispersos;
//! - a **avaliação honesta** de uma submissão ([`grade_phase`] para a fase do projecto,
//!   [`grade_step`] para um desafio de curso): localizam o alvo, constroem o `Phase` e
//!   reusam `tutor_eval::assess` (a fonte de verdade); devolvem o `Assessment` + o `Phase`
//!   avaliado (o gabarito viaja com a fase) para o adaptador mapear no DTO.
//!
//! O mecanismo de avaliação/conteúdo já era Tauri-free (`tutor_core`, `tutor_eval`,
//! `tutor_llm`); esta fatia é a fachada que o adaptador IPC e o crate de teste atravessam
//! sem ver tipos Tauri. Os provedores LLM de `request_hint`/`plan`/`fix` ficam no adaptador
//! (constrói o pedido e chama `tutor_llm`), mas a *regra* offline de sugestão curada
//! ([`curated_hint`]) e o contexto do passo ([`hint_context`]) vivem aqui.
//!
//! Os DTOs serializáveis (`ProjectDto`, `AssessmentDto`, …) continuam em `lib.rs`
//! `pub(crate)`: são a fronteira de serialização para o webview, partilhados entre grupos.

use std::collections::BTreeMap;

use tutor_core::{Course, Glossary, Level, Phase, Project, StepKind, StudyGuide};
use tutor_eval::Assessment;
use tutor_llm::policy::{policy_for, Mode, StudyPolicy};

/// O projecto que o editor carrega. Mantido num só sítio para um futuro selector ser fácil.
pub const PROJECT_ID: &str = "rust-word-frequency";

// ── Fonte única de cursos: embutidos + plugins instalados ────────────────────────────

/// Os cursos embutidos no binário, lidos uma só vez (antes cada consulta re-parseava o TOML).
fn builtin() -> &'static [Course] {
    static BUILTIN: std::sync::OnceLock<Vec<Course>> = std::sync::OnceLock::new();
    BUILTIN.get_or_init(tutor_core::builtin_courses)
}

/// Os cursos dos plugins instalados, em cache até o registo (`installed.json`) mudar — uma
/// instalação pelo `dxt` com a app aberta também é vista.
fn plugin_courses() -> Vec<Course> {
    type Cache = Option<(
        std::path::PathBuf,
        Option<std::time::SystemTime>,
        Vec<Course>,
    )>;
    static CACHE: std::sync::Mutex<Cache> = std::sync::Mutex::new(None);
    let Ok(store) = tutor_plugins::Store::open_default() else {
        return Vec::new();
    };
    let stamp = store.fingerprint();
    let mut cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((root, s, courses)) = cache.as_ref() {
        if root == store.root() && *s == stamp {
            return courses.clone();
        }
    }
    let courses: Vec<Course> = store.courses().into_iter().map(|(_, c)| c).collect();
    *cache = Some((store.root().to_path_buf(), stamp, courses.clone()));
    courses
}

/// Todos os cursos: os embutidos primeiro, depois os dos plugins. A instalação recusa ids de
/// curso/passo repetidos, por isso um plugin nunca faz sombra a um curso embutido.
///
/// Um curso de plugin com o MESMO id de um embutido substitui-o: é assim que um plugin oficial
/// (`ngolacloud/dxtutor-course-rust`) entrega conteúdo mais recente do que o que veio com a app.
pub fn all_courses() -> Vec<Course> {
    let plugins = plugin_courses();
    let mut all: Vec<Course> = builtin()
        .iter()
        .filter(|b| !plugins.iter().any(|p| p.id == b.id))
        .cloned()
        .collect();
    all.extend(plugins);
    all
}

/// Os cursos embutidos (a instalação de plugins precisa deles para detectar ids repetidos).
pub fn builtin_courses() -> &'static [Course] {
    builtin()
}

/// Erro tipado da fatia de estudo. As variantes com mensagem de contrato passam pelo
/// [`Display`], que reproduz EXACTAMENTE as mensagens que `lib.rs` emitia (o adaptador
/// mapeia-as para `String` na fronteira IPC, sem as reescrever).
///
/// [`Display`]: std::fmt::Display
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StudyError {
    /// `load_project` não encontrou o projecto com este id.
    ProjectNotFound(String),
    /// A fase pedida não existe no projecto.
    PhaseNotFound(String),
    /// Nenhum passo de curso tem este id.
    StepNotFound(String),
    /// O passo existe mas não é um desafio (`challenge`) — não dá para avaliar.
    NotAChallenge(String),
    /// Não há curso para esta linguagem.
    NoCourse(String),
    /// Não há curso para este framework/ferramenta (`subject`).
    NoSubjectCourse(String),
    /// Foram entregues ficheiros para um passo que não é de projecto.
    NotAProject(String),
    /// Não há glossário para esta linguagem.
    NoGlossary(String),
    /// Não há guia de estudo para esta linguagem/unidade.
    NoStudyGuide { language: String, unit: String },
    /// A avaliação (`tutor_eval::assess`) falhou — erro cru anexado.
    Eval(String),
}

impl std::fmt::Display for StudyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StudyError::ProjectNotFound(id) => write!(f, "project `{id}` not found"),
            StudyError::PhaseNotFound(id) => write!(f, "phase `{id}` not found"),
            StudyError::StepNotFound(id) => write!(f, "step `{id}` not found"),
            StudyError::NotAChallenge(id) => write!(f, "step `{id}` is not a challenge"),
            StudyError::NoCourse(lang) => write!(f, "no course for language `{lang}`"),
            StudyError::NoSubjectCourse(s) => write!(f, "no course for `{s}`"),
            StudyError::NotAProject(id) => write!(f, "step `{id}` is not a project step"),
            StudyError::NoGlossary(lang) => write!(f, "no glossary for language `{lang}`"),
            StudyError::NoStudyGuide { language, unit } => {
                write!(f, "no study guide for language `{language}` unit `{unit}`")
            }
            StudyError::Eval(e) => write!(f, "evaluation failed: {e}"),
        }
    }
}

impl std::error::Error for StudyError {}

// ── Classificação pedagógica + política de estudo (regras puras, partilhadas) ────────

/// Encontra um passo de curso guiado por id em todos os cursos embutidos; devolve a
/// linguagem do curso ao lado do passo. O frontend endereça hints/diagnósticos por id de
/// passo (passado como `phaseId`/`stepId`).
pub fn course_step(step_id: &str) -> Option<(String, tutor_core::Step)> {
    for course in all_courses() {
        if let Some(step) = course.step(step_id) {
            return Some((course.language.clone(), step.clone()));
        }
    }
    None
}

/// Linguagem do curso do passo (por omissão `"rust"` quando o id é desconhecido).
pub fn step_language(step_id: &str) -> String {
    course_step(step_id)
        .map(|(lang, _)| lang)
        .unwrap_or_else(|| "rust".to_string())
}

/// É `step_id` um exercício de aplicação autónoma (um desafio que o aluno tem de
/// implementar), por oposição a um drill de transcrição ou conceito? Ids desconhecidos
/// tratam-se como autónomos (falha fechada para o contrato mais estrito).
pub fn step_is_autonomous(step_id: Option<&str>) -> bool {
    match step_id {
        Some(id) => course_step(id)
            .map(|(_, s)| matches!(s.kind, StepKind::Challenge))
            .unwrap_or(true),
        None => true,
    }
}

/// A política de estudo activa para o modo + passo dados. O frontend usa-a para esconder
/// superfícies de solução/escrita enquanto um exercício está aberto (defesa em profundidade);
/// o backend aplica a mesma política independentemente do que a UI mostra.
pub fn study_policy(mode: &str, step_id: Option<&str>) -> StudyPolicy {
    policy_for(Mode::parse(mode), step_is_autonomous(step_id))
}

// ── Carregamento de conteúdo (erro de contrato tipado) ───────────────────────────────

/// Carrega o projecto que o editor abre, ou [`StudyError::ProjectNotFound`].
pub fn load_project() -> Result<Project, StudyError> {
    tutor_core::load_project(PROJECT_ID)
        .ok_or_else(|| StudyError::ProjectNotFound(PROJECT_ID.to_string()))
}

/// Carrega uma fase (owned) do projecto por id, ou um erro legível.
pub fn load_phase(phase_id: &str) -> Result<Phase, StudyError> {
    load_project()?
        .phase(phase_id)
        .cloned()
        .ok_or_else(|| StudyError::PhaseNotFound(phase_id.to_string()))
}

/// Carrega o curso guiado de uma linguagem (ex. `"rust"`), ou [`StudyError::NoCourse`].
/// Só cursos de LINGUAGEM: um curso de Django também se avalia em `python`, mas não é «o
/// curso de Python».
pub fn course(language: &str) -> Result<Course, StudyError> {
    find_course(&all_courses(), language, None)
}

/// [`course`] ou, com `subject`, o curso do framework/ferramenta com esse id
/// ([`StudyError::NoSubjectCourse`] quando não há).
pub fn course_for(language: &str, subject: Option<&str>) -> Result<Course, StudyError> {
    find_course(&all_courses(), language, subject)
}

fn find_course(
    courses: &[Course],
    language: &str,
    subject: Option<&str>,
) -> Result<Course, StudyError> {
    match subject.map(str::trim).filter(|s| !s.is_empty()) {
        Some(sub) => courses
            .iter()
            .find(|c| c.category.has_subject() && c.subject.eq_ignore_ascii_case(sub))
            .cloned()
            .ok_or_else(|| StudyError::NoSubjectCourse(sub.to_string())),
        None => courses
            .iter()
            .find(|c| !c.category.has_subject() && c.language.eq_ignore_ascii_case(language.trim()))
            .cloned()
            .ok_or_else(|| StudyError::NoCourse(language.to_string())),
    }
}

/// Todos os cursos embutidos (um por currículo/linguagem), para o onboarding construir o
/// selector de linguagens dinamicamente.
pub fn courses() -> Vec<Course> {
    all_courses()
}

/// Carrega o glossário curado de uma linguagem, ou [`StudyError::NoGlossary`].
pub fn glossary(language: &str) -> Result<Glossary, StudyError> {
    tutor_core::load_glossary(language).ok_or_else(|| StudyError::NoGlossary(language.to_string()))
}

/// Carrega o guia de estudo (remediação) de uma unidade numa linguagem, ou
/// [`StudyError::NoStudyGuide`].
pub fn study_guide(language: &str, unit_id: &str) -> Result<StudyGuide, StudyError> {
    tutor_core::load_study_guide(language, unit_id).ok_or_else(|| StudyError::NoStudyGuide {
        language: language.to_string(),
        unit: unit_id.to_string(),
    })
}

// ── Avaliação honesta (reusa `tutor_eval::assess`, a fonte de verdade) ───────────────

/// Avalia o código do aluno para uma fase do projecto: corre os testes ocultos (fonte de
/// verdade) e, em sucesso, mede complexidade. Devolve o `Assessment` + o `Phase` avaliado
/// (o gabarito viaja com a fase) para o adaptador revelar o gabarito só em sucesso.
pub fn grade_phase(phase_id: &str, code: &str) -> Result<(Assessment, Phase), StudyError> {
    let phase = load_phase(phase_id)?;
    let assessment =
        tutor_eval::assess(&phase, code).map_err(|e| StudyError::Eval(e.to_string()))?;
    Ok((assessment, phase))
}

/// Avalia um passo `challenge`: localiza-o em todas as unidades dos cursos, constrói um
/// `Phase` a partir dele e reusa o avaliador honesto (`tutor_eval::assess`).
pub fn grade_step(step_id: &str, code: &str) -> Result<(Assessment, Phase), StudyError> {
    grade_step_in(step_id, None, code)
}

/// [`grade_step`] restrito aos cursos de uma linguagem. Rust e Go repetem ids de passo
/// (`ch1-greet`, `ch3-sign`, …): sem a linguagem, um desafio Go com um desses ids era
/// avaliado contra o passo Rust (o primeiro curso encontrado).
pub fn grade_step_in(
    step_id: &str,
    language: Option<&str>,
    code: &str,
) -> Result<(Assessment, Phase), StudyError> {
    grade_in(&all_courses(), step_id, language, Submission::Code(code))
}

/// Avalia um passo de PROJECTO com os ficheiros editáveis que o aluno entrega (caminho →
/// conteúdo). Os que faltam ficam como no starter; um ficheiro só de leitura ou desconhecido
/// é recusado (ver `tutor_core::ProjectFiles::learner_tree`). Um passo de um só ficheiro dá
/// [`StudyError::NotAProject`].
pub fn grade_step_files(
    step_id: &str,
    language: Option<&str>,
    files: &BTreeMap<String, String>,
) -> Result<(Assessment, Phase), StudyError> {
    grade_in(&all_courses(), step_id, language, Submission::Files(files))
}

/// O que o aluno entrega: o código de um ficheiro (num passo de projecto, o ficheiro
/// principal) ou os ficheiros de um passo de projecto.
#[derive(Debug, Clone, Copy)]
pub enum Submission<'a> {
    Code(&'a str),
    Files(&'a BTreeMap<String, String>),
}

/// A regra da avaliação sobre uma lista de cursos dada (testável sem o registo de plugins).
pub fn grade_in(
    courses: &[Course],
    step_id: &str,
    language: Option<&str>,
    submission: Submission<'_>,
) -> Result<(Assessment, Phase), StudyError> {
    let wanted = language.map(|l| l.trim().to_ascii_lowercase());
    for course in courses {
        if wanted
            .as_deref()
            .is_some_and(|l| !course.language.eq_ignore_ascii_case(l))
        {
            continue;
        }
        if let Some(step) = course.step(step_id) {
            let phase = step
                .as_phase(&course.language, Level::Basico)
                .ok_or_else(|| StudyError::NotAChallenge(step_id.to_string()))?;
            // Sem avaliador para a linguagem, o `tutor_eval` cairia no Rust e compilaria o
            // desafio como Rust: melhor um erro honesto e claro.
            if !tutor_eval::language_supported(&course.language) {
                return Err(StudyError::Eval(format!(
                    "grading for {} is not available yet",
                    course.language
                )));
            }
            let assessment = match submission {
                Submission::Code(code) => tutor_eval::assess(&phase, code),
                Submission::Files(files) => {
                    if phase.project.is_none() {
                        return Err(StudyError::NotAProject(step_id.to_string()));
                    }
                    tutor_eval::assess_project(&phase, files)
                }
            }
            .map_err(|e| StudyError::Eval(e.to_string()))?;
            return Ok((assessment, phase));
        }
    }
    Err(StudyError::StepNotFound(step_id.to_string()))
}

// ── Sugestão (a regra offline curada; o provedor LLM fica no adaptador) ──────────────

/// Sugestão curada e offline-safe quando a fase embarca uma (ex. o cenário «contar
/// caracteres»): devolve `(texto, nível ajustado a 1..3)`. Determinística e sem modelo — o
/// caminho essencial funciona sem provedor. `None` → o adaptador cai para o provedor.
pub fn curated_hint(phase_id: &str, level: u8) -> Option<(String, u8)> {
    let phase = tutor_core::find_phase(phase_id)?;
    phase
        .hint(level)
        .map(|hint| (hint.to_string(), level.clamp(1, 3)))
}

/// Contexto `(instructions, entry)` de um passo guiado, para alimentar o pedido ao
/// provedor quando não há sugestão curada. Vazio quando o id é desconhecido.
pub fn hint_context(phase_id: &str) -> (String, String) {
    match course_step(phase_id) {
        Some((_, step)) => (step.instructions.clone(), step.entry.clone()),
        None => (String::new(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_loads_and_unknown_language_errors_are_typed() {
        // O projecto do editor existe (conteúdo embutido).
        assert!(load_project().is_ok());
        assert_eq!(load_project().unwrap().id, PROJECT_ID);

        // Cursos: pelo menos o de Rust existe; linguagem inexistente → erro de contrato.
        assert!(course("rust").is_ok());
        assert_eq!(
            course("klingon").unwrap_err(),
            StudyError::NoCourse("klingon".to_string())
        );
        assert_eq!(
            glossary("klingon").unwrap_err().to_string(),
            "no glossary for language `klingon`"
        );
        assert_eq!(
            study_guide("klingon", "u1").unwrap_err().to_string(),
            "no study guide for language `klingon` unit `u1`"
        );
        assert!(!courses().is_empty());
    }

    #[test]
    fn grading_an_unknown_target_is_a_typed_error_without_compiling() {
        // Alvos inexistentes falham ANTES de qualquer compilação (rápido e determinístico).
        assert_eq!(
            grade_step("no-such-step", "fn main() {}").unwrap_err(),
            StudyError::StepNotFound("no-such-step".to_string())
        );
        assert_eq!(
            grade_phase("no-such-phase", "fn main() {}").unwrap_err(),
            StudyError::PhaseNotFound("no-such-phase".to_string())
        );
    }

    fn fixture_course() -> Course {
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../crates/tutor-plugins/tests/fixtures/framework-project/courses/minishop.toml"
        ))
        .expect("fixture");
        Course::parse(&raw, tutor_core::CourseFormat::Toml).unwrap()
    }

    #[test]
    fn framework_courses_are_found_by_subject_never_as_the_language_course() {
        let mut courses = vec![fixture_course()];
        // Nem com o curso de framework PRIMEIRO na lista o «curso de Python» passa a ser ele.
        courses.extend(tutor_core::builtin_courses());
        assert_eq!(
            find_course(&courses, "python", None).unwrap().id,
            "python-basics"
        );
        assert_eq!(
            find_course(&courses, "python", Some("minishop"))
                .unwrap()
                .id,
            "minishop-fixture"
        );
        assert_eq!(
            find_course(&courses, "python", Some("django"))
                .unwrap_err()
                .to_string(),
            "no course for `django`"
        );
    }

    #[test]
    fn project_steps_grade_files_and_refuse_files_for_single_file_steps() {
        let courses = vec![fixture_course()];
        let files = |pairs: &[(&str, &str)]| -> BTreeMap<String, String> {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        };
        // Ficheiros para um passo que não é de projecto: erro tipado, sem correr nada.
        let mut single = fixture_course();
        single.units[0].steps[2].project = None;
        single.units[0].steps[2].gabarito = Some(tutor_core::Gabarito {
            solution: String::new(),
            time: String::new(),
            space: String::new(),
            justification: String::new(),
        });
        assert_eq!(
            grade_in(
                &[single],
                "msf-p1-cart",
                Some("python"),
                Submission::Files(&files(&[]))
            )
            .unwrap_err(),
            StudyError::NotAProject("msf-p1-cart".into())
        );
        // Um ficheiro só de leitura é recusado antes de avaliar.
        let err = grade_in(
            &courses,
            "msf-p1-cart",
            Some("python"),
            Submission::Files(&files(&[("shop/config.py", "VAT = 0\n")])),
        )
        .unwrap_err();
        assert!(err.to_string().contains("read-only"), "{err}");
        // A linguagem que filtra é a do runtime (python), não o subject.
        assert_eq!(
            grade_in(
                &courses,
                "msf-p1-cart",
                Some("minishop"),
                Submission::Files(&files(&[]))
            )
            .unwrap_err(),
            StudyError::StepNotFound("msf-p1-cart".into())
        );
        if !tutor_eval::find_plugin("python").is_some_and(|p| p.host_available()) {
            return;
        }
        let project = courses[0]
            .step("msf-p1-cart")
            .unwrap()
            .project
            .clone()
            .unwrap();
        let (good, phase) = grade_in(
            &courses,
            "msf-p1-cart",
            Some("python"),
            Submission::Files(&project.solution),
        )
        .unwrap();
        assert!(good.correctness.passed, "{}", good.correctness.raw);
        assert!(phase.project.is_some());
        let (bad, _) = grade_in(
            &courses,
            "msf-p1-cart",
            Some("python"),
            Submission::Files(&files(&[])),
        )
        .unwrap();
        assert!(!bad.correctness.passed);
        // A forma antiga (`code`) num passo de projecto: é o ficheiro principal.
        let (main_only, _) = grade_in(
            &courses,
            "msf-p1-cart",
            Some("python"),
            Submission::Code(&project.solution["shop/cart.py"]),
        )
        .unwrap();
        assert!(!main_only.correctness.passed, "prices.py is still the stub");
    }

    #[test]
    fn step_classification_and_policy_follow_the_contract() {
        // Id desconhecido → autónomo (falha fechada) e linguagem por omissão "rust".
        assert!(step_is_autonomous(Some("no-such-step")));
        assert!(step_is_autonomous(None));
        assert_eq!(step_language("no-such-step"), "rust");

        // A política de um passo autónomo esconde mais do que a de um não-autónomo; o
        // modo inválido cai no default de `Mode::parse`. (Comparamos a serialização para
        // não depender dos campos internos de `StudyPolicy`.)
        let autonomous = serde_json::to_value(study_policy("tutor", Some("no-such-step"))).unwrap();
        let free = serde_json::to_value(study_policy("livre", None)).unwrap();
        assert!(autonomous.is_object() && free.is_object());
    }
}
