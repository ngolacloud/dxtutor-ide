//! `tutor-core` — modelo de domínio e conteúdo curado do dxtutor.

pub mod build;
pub mod content;
pub mod course;
pub mod curriculum;
pub mod glossary;
pub mod model;
pub mod project;
pub mod study;
pub mod support;
pub mod toolcheck;

pub use build::{pip_requirement, BuildEnv, CacheKind, CourseBuild, CourseCache, PipRequirement};
pub use content::{builtin_projects, find_phase, load_project};
pub use course::{
    builtin_courses, load_course, Course, CourseCategory, CourseFormat, Step, StepKind, Unit,
};
// `curriculum::Unit` keeps its own name (course::Unit already occupies `Unit`).
pub use curriculum::{Competency, Curriculum, EvidenceKind, Program};
pub use glossary::{builtin_glossaries, load_glossary, Glossary, GlossaryEntry};
pub use model::{Gabarito, Level, Phase, Probe, Project};
pub use project::{safe_project_path, ProjectFiles};
pub use study::{load_study_guide, StudyGuide};
