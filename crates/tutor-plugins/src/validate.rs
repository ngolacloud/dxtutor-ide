//! Validação de um plugin numa pasta: manifesto + cada curso que ele declara.
//!
//! Erros impedem a instalação; avisos não (são conselhos de qualidade do conteúdo, como
//! uma unidade sem texto de conceitos). A mesma função serve `dxt plugin validate`, a
//! instalação e o CI dos repositórios de cursos.

use std::collections::HashSet;
use std::path::Path;

use tutor_core::{Course, CourseFormat, StepKind};

use crate::manifest::{Manifest, LEVELS, MANIFEST_FILE};

/// Resultado da validação de um plugin.
#[derive(Debug, Clone, Default)]
pub struct Report {
    /// O manifesto, quando foi possível lê-lo.
    pub manifest: Option<Manifest>,
    /// Os cursos que passaram o parse (mesmo que tenham erros de conteúdo).
    pub courses: Vec<Course>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    /// Informação que não é defeito (ex.: o plugin substitui um curso embutido). Não reprova
    /// o `--strict`.
    pub notes: Vec<String>,
}

impl Report {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Um curso que já existe fora deste plugin, resumido ao que a validação compara.
#[derive(Debug, Clone)]
pub struct Existing {
    pub id: String,
    pub language: String,
    /// `language`/`framework`/`tool` e o `subject` (vazio numa linguagem).
    pub category: tutor_core::CourseCategory,
    pub subject: String,
    pub step_ids: HashSet<String>,
    /// Embutido na app (pode ser SUBSTITUÍDO por um plugin com o mesmo id de curso) ou de
    /// outro plugin instalado (nunca).
    pub builtin: bool,
}

/// Os cursos que já existem fora do plugin a validar.
///
/// Regras: (1) um curso de plugin com o id de um curso EMBUTIDO substitui-o (é como um plugin
/// oficial actualiza o conteúdo que veio com a app), desde que seja da mesma linguagem;
/// (2) o id de um curso de OUTRO plugin não pode ser reutilizado; (3) os ids de passo têm de
/// ser únicos entre cursos da MESMA linguagem, porque a avaliação procura o passo por
/// (linguagem, id). Linguagens diferentes podem repetir ids (Rust e Go já o fazem).
#[derive(Debug, Clone, Default)]
pub struct Taken {
    pub courses: Vec<Existing>,
}

impl Taken {
    pub fn new<'a>(
        builtin: impl IntoIterator<Item = &'a Course>,
        others: impl IntoIterator<Item = &'a Course>,
    ) -> Taken {
        let summary = |c: &Course, builtin: bool| Existing {
            id: c.id.clone(),
            language: c.language.clone(),
            category: c.category,
            subject: c.subject.clone(),
            step_ids: c
                .units
                .iter()
                .flat_map(|u| u.steps.iter().map(|s| s.id.clone()))
                .collect(),
            builtin,
        };
        let mut courses: Vec<Existing> = builtin.into_iter().map(|c| summary(c, true)).collect();
        courses.extend(others.into_iter().map(|c| summary(c, false)));
        Taken { courses }
    }

    /// Só cursos embutidos (o caso do `dxt plugin validate` num repositório de cursos).
    pub fn builtin<'a>(courses: impl IntoIterator<Item = &'a Course>) -> Taken {
        Taken::new(courses, [])
    }
}

/// Aplica as regras de [`Taken`] aos cursos do plugin.
fn check_taken(courses: &[Course], taken: &Taken, r: &mut Report) {
    let mine: HashSet<&str> = courses.iter().map(|c| c.id.as_str()).collect();
    for c in courses {
        for ex in taken.courses.iter().filter(|ex| ex.id == c.id) {
            if !ex.builtin {
                r.errors.push(format!(
                    "course `{}`: id is already used by another installed plugin",
                    c.id
                ));
            } else if ex.language != c.language {
                r.errors.push(format!(
                    "course `{}`: a built-in course with this id teaches `{}`, not `{}`",
                    c.id, ex.language, c.language
                ));
            } else if ex.category != c.category || ex.subject != c.subject {
                r.errors.push(format!(
                    "course `{}`: a built-in course with this id is a `{}` course{}, not `{}`{}",
                    c.id,
                    ex.category.as_str(),
                    subject_note(&ex.subject),
                    c.category.as_str(),
                    subject_note(&c.subject)
                ));
            } else {
                r.notes.push(format!(
                    "course `{}` replaces the built-in course with the same id",
                    c.id
                ));
            }
        }
        let steps = c.units.iter().flat_map(|u| &u.steps);
        for ex in taken
            .courses
            .iter()
            .filter(|ex| ex.language == c.language && !mine.contains(ex.id.as_str()))
        {
            let clash: Vec<&str> = steps
                .clone()
                .filter(|s| ex.step_ids.contains(&s.id))
                .map(|s| s.id.as_str())
                .collect();
            if !clash.is_empty() {
                r.errors.push(format!(
                    "course `{}`: step ids already used by the installed {} course `{}`: {}",
                    c.id,
                    c.language,
                    ex.id,
                    clash.join(", ")
                ));
            }
        }
    }
}

fn subject_note(subject: &str) -> String {
    if subject.is_empty() {
        String::new()
    } else {
        format!(" (`{subject}`)")
    }
}

/// Valida o plugin na pasta `dir`.
pub fn validate_dir(dir: &Path, host_version: &str, taken: &Taken) -> Report {
    let mut r = Report::default();
    let raw = match std::fs::read_to_string(dir.join(MANIFEST_FILE)) {
        Ok(s) => s,
        Err(_) => {
            r.errors.push(format!(
                "{MANIFEST_FILE} not found at the root of the plugin"
            ));
            return r;
        }
    };
    let manifest = match Manifest::parse(&raw) {
        Ok(m) => m,
        Err(e) => {
            r.errors.push(e);
            return r;
        }
    };
    r.errors.extend(manifest.check(host_version));

    let mut step_ids: HashSet<String> = HashSet::new();
    let mut course_ids: HashSet<String> = HashSet::new();
    for rel in &manifest.courses {
        let Some(format) = CourseFormat::from_path(rel) else {
            continue;
        };
        if !crate::manifest::safe_relative(rel) {
            continue;
        }
        let raw = match std::fs::read_to_string(dir.join(rel)) {
            Ok(s) => s,
            Err(_) => {
                r.errors.push(format!("{rel}: file not found"));
                continue;
            }
        };
        let mut course = match Course::parse(&raw, format) {
            Ok(c) => c,
            Err(e) => {
                r.errors.push(format!("{rel}: {e}"));
                continue;
            }
        };
        // Os ficheiros de apoio (`[support]`): lidos como a instalação os lê, para o
        // `dxt plugin test` avaliar com eles e um ficheiro em falta ser um erro aqui.
        if let Err(errs) = crate::support::load_support(dir, &mut course) {
            r.errors
                .extend(errs.into_iter().map(|e| format!("{rel}: {e}")));
        }
        check_course(
            rel,
            &course,
            &manifest,
            &mut course_ids,
            &mut step_ids,
            &mut r,
        );
        r.courses.push(course);
    }
    let courses = std::mem::take(&mut r.courses);
    check_taken(&courses, taken, &mut r);
    r.courses = courses;
    r.manifest = Some(manifest);
    r
}

fn check_course(
    rel: &str,
    c: &Course,
    m: &Manifest,
    course_ids: &mut HashSet<String>,
    step_ids: &mut HashSet<String>,
    r: &mut Report,
) {
    let e = |r: &mut Report, msg: String| r.errors.push(format!("{rel}: {msg}"));
    let w = |r: &mut Report, msg: String| r.warnings.push(format!("{rel}: {msg}"));

    // `language` é a linguagem que avalia os passos, em TODAS as categorias.
    if c.language != m.language.id {
        e(
            r,
            format!(
                "course language `{}` differs from the manifest's language.id `{}`",
                c.language, m.language.id
            ),
        );
    }
    if c.category != m.category {
        e(
            r,
            format!(
                "course category `{}` differs from the manifest's category `{}`",
                c.category.as_str(),
                m.category.as_str()
            ),
        );
    }
    if c.category.has_subject() {
        let want = m.subject.as_ref().map(|s| s.id.as_str()).unwrap_or("");
        if c.subject != want {
            e(
                r,
                format!(
                    "course subject `{}` differs from the manifest's subject.id `{want}`",
                    c.subject
                ),
            );
        }
    } else if !c.subject.is_empty() {
        e(
            r,
            format!(
                "course subject `{}` is only for framework and tool courses",
                c.subject
            ),
        );
    }
    if !course_ids.insert(c.id.clone()) {
        e(
            r,
            format!("course id `{}` is repeated in this plugin", c.id),
        );
    }
    if c.title.trim().is_empty() {
        e(r, "course title is empty".into());
    }
    if c.overview.trim().is_empty() {
        w(
            r,
            "course has no `overview` (a reading text that introduces the language)".into(),
        );
    }
    if c.units.is_empty() {
        e(r, "course has no units".into());
    }
    // `[build]`: as dependências de todos os passos e a cache preparada uma vez.
    for msg in c.build.check() {
        e(r, msg);
    }
    if c.build.prepare && tutor_core::CacheKind::of(&c.language).is_none() {
        e(
            r,
            format!(
                "build.prepare: a prepared course cache is only available for courses graded in rust (cargo) or python (pip) (this one is graded in `{}`)",
                c.language
            ),
        );
    }
    for u in &c.units {
        let at = format!("unit `{}`", u.id);
        if !LEVELS.contains(&u.level.as_str()) {
            e(
                r,
                format!(
                    "{at}: level `{}` must be basic, intermediate or advanced",
                    u.level
                ),
            );
        }
        if u.steps.is_empty() {
            e(r, format!("{at}: has no steps"));
        }
        if u.concepts.trim().is_empty() {
            w(
                r,
                format!("{at}: no `concepts` text (the reading that explains this topic)"),
            );
        }
        for s in &u.steps {
            let at = format!("step `{}`", s.id);
            if !step_ids.insert(s.id.clone()) {
                e(r, format!("{at}: id is repeated in this plugin"));
            }
            if s.title.trim().is_empty() {
                e(r, format!("{at}: title is empty"));
            }
            if !matches!(s.placeholder_policy.as_str(), "shown" | "on_demand") {
                e(
                    r,
                    format!("{at}: placeholder_policy must be `shown` or `on_demand`"),
                );
            }
            if s.points == 0 {
                w(r, format!("{at}: awards 0 points"));
            }
            if s.project.is_some() && s.kind != StepKind::Challenge {
                e(
                    r,
                    format!("{at}: only challenge steps can have a `project`"),
                );
            }
            match s.kind {
                StepKind::Concept => {
                    if s.body.trim().is_empty() {
                        e(r, format!("{at}: concept step needs a `body`"));
                    }
                }
                StepKind::Drill => {
                    if s.target.trim().is_empty() {
                        e(r, format!("{at}: drill step needs a `target` program"));
                    }
                    let lines = s
                        .target
                        .trim_start_matches('\n')
                        .trim_end_matches('\n')
                        .lines()
                        .count();
                    if s.line_comments.len() > lines {
                        e(
                            r,
                            format!(
                                "{at}: {} line_comments for a {lines}-line target",
                                s.line_comments.len()
                            ),
                        );
                    }
                }
                StepKind::Challenge if s.project.is_some() => {
                    let p = s.project.as_ref().expect("guarded");
                    if s.instructions.trim().is_empty() {
                        e(r, format!("{at}: challenge step needs `instructions`"));
                    }
                    for (field, v) in [("starter", &s.starter), ("tests", &s.tests)] {
                        if !v.trim().is_empty() {
                            e(
                                r,
                                format!(
                                    "{at}: a project step keeps its files in `project`; remove `{field}`"
                                ),
                            );
                        }
                    }
                    if s.gabarito.is_some() {
                        e(
                            r,
                            format!(
                                "{at}: a project step keeps its reference solution in `project.solution`; remove `gabarito`"
                            ),
                        );
                    }
                    for msg in p.check() {
                        e(r, format!("{at}: {msg}"));
                    }
                    for msg in tutor_core::support::project_clashes(&c.support, p) {
                        e(r, format!("{at}: {msg}"));
                    }
                    // Um curso avaliado por verificações (ferramentas): o `checks.toml` oculto
                    // lê-se, só corre comandos da lista permitida e só nomeia ficheiros do passo.
                    if tutor_core::toolcheck::graded_by_checks(&c.language) {
                        // Um curso de contentores: os comandos só correm imagens construídas no
                        // passo ou preparadas pelo curso.
                        let images = tutor_core::toolcheck::course_images(c);
                        let prepared = tutor_core::toolcheck::containerfile_language(&c.language)
                            .then_some(images.as_slice());
                        for msg in tutor_core::toolcheck::check_step_with(p, prepared) {
                            e(r, format!("{at}: {msg}"));
                        }
                    }
                }
                StepKind::Challenge if tutor_core::toolcheck::graded_by_checks(&c.language) => {
                    e(
                        r,
                        format!(
                            "{at}: a course graded by checks (`{}`) uses project steps: put the files in `project` and the checks in `project.tests.\"{}\"`",
                            c.language,
                            tutor_core::toolcheck::CHECKS_FILE
                        ),
                    );
                }
                StepKind::Challenge => {
                    for (field, v) in [
                        ("instructions", &s.instructions),
                        ("entry", &s.entry),
                        ("starter", &s.starter),
                        ("tests", &s.tests),
                    ] {
                        if v.trim().is_empty() {
                            e(r, format!("{at}: challenge step needs `{field}`"));
                        }
                    }
                    if s.gabarito.is_none() {
                        e(
                            r,
                            format!("{at}: challenge step needs a `gabarito` (reference solution)"),
                        );
                    }
                    if !s.entry.is_empty() && !s.starter.contains(&s.entry) {
                        w(
                            r,
                            format!("{at}: starter does not mention the entry `{}`", s.entry),
                        );
                    }
                }
            }
        }
    }
}
