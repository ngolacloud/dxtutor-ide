//! `tutor-plugins` — plugins de curso do dxtutor.
//!
//! Um plugin é um repositório (os oficiais em github.com/ngolacloud/dxtutor-course-<id>) com um manifesto
//! `dxtutor-plugin.json` e um ou mais cursos no formato de `tutor_core::Course` (TOML ou
//! JSON). Este crate é partilhado pela app desktop (comandos Tauri `plugin_*`) e pelo CLI
//! (`dxt plugin …`), para os dois validarem e instalarem exactamente da mesma forma.
//!
//! Guia para autores: `docs/plugins/README.md`.

pub mod manifest;
pub mod scaffold;
pub mod source;
pub mod store;
pub mod support;
pub mod validate;

pub use manifest::{LanguageInfo, Manifest, SubjectInfo, MANIFEST_FILE, SCHEMA_VERSION};
pub use source::{official_repo, Source, OFFICIAL_ORG, OFFICIAL_REPO_PREFIX};
pub use store::{Entry, Installed, Outcome, Store};
pub use validate::{validate_dir, Report, Taken};
