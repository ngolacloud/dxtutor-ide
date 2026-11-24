//! `tutor-plugins` — plugins de curso do dxtutor.
//!
//! Um plugin é um repositório (normalmente em github.com/dxtutor-courses) com um manifesto
//! `dxtutor-plugin.json` e um ou mais cursos no formato de `tutor_core::Course` (TOML ou
//! JSON). Este crate é partilhado pela app desktop (comandos Tauri `plugin_*`) e pelo CLI
//! (`dxt plugin …`), para os dois validarem e instalarem exactamente da mesma forma.
//!
//! Guia para autores: `docs/plugins/README.md`.

pub mod manifest;
pub mod scaffold;
pub mod source;
pub mod store;
pub mod validate;

pub use manifest::{LanguageInfo, Manifest, MANIFEST_FILE, SCHEMA_VERSION};
pub use source::{Source, OFFICIAL_ORG};
pub use store::{Entry, Installed, Outcome, Store};
pub use validate::{validate_dir, Report, Taken};
