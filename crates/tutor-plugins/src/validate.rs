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
}

impl Report {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Ids já ocupados por cursos que não pertencem a este plugin (os embutidos e os de
/// outros plugins instalados). Um passo com o mesmo id tornaria a avaliação ambígua,
/// porque o backend procura o passo pelo id.
#[derive(Debug, Clone, Default)]
pub struct Taken {
    pub course_ids: HashSet<String>,
    pub step_ids: HashSet<String>,
}

impl Taken {
    pub fn from_courses<'a>(courses: impl IntoIterator<Item = &'a Course>) -> Taken {
        let mut t = Taken::default();
        for c in courses {
            t.course_ids.insert(c.id.clone());
            for u in &c.units {
                for s in &u.steps {
                    t.step_ids.insert(s.id.clone());
                }
            }
        }
        t
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
        let course = match Course::parse(&raw, format) {
            Ok(c) => c,
            Err(e) => {
                r.errors.push(format!("{rel}: {e}"));
                continue;
            }
        };
        check_course(
            rel,
            &course,
            &manifest,
            taken,
            &mut course_ids,
            &mut step_ids,
            &mut r,
        );
        r.courses.push(course);
    }
    r.manifest = Some(manifest);
    r
}

fn check_course(
    rel: &str,
    c: &Course,
    m: &Manifest,
    taken: &Taken,
    course_ids: &mut HashSet<String>,
    step_ids: &mut HashSet<String>,
    r: &mut Report,
) {
    let e = |r: &mut Report, msg: String| r.errors.push(format!("{rel}: {msg}"));
    let w = |r: &mut Report, msg: String| r.warnings.push(format!("{rel}: {msg}"));

    if c.language != m.language.id {
        e(
            r,
            format!(
                "course language `{}` differs from the manifest's language.id `{}`",
                c.language, m.language.id
            ),
        );
    }
    if !course_ids.insert(c.id.clone()) {
        e(
            r,
            format!("course id `{}` is repeated in this plugin", c.id),
        );
    }
    if taken.course_ids.contains(&c.id) {
        e(
            r,
            format!(
                "course id `{}` is already used by another installed course",
                c.id
            ),
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
            if taken.step_ids.contains(&s.id) {
                e(
                    r,
                    format!("{at}: id is already used by another installed course"),
                );
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
