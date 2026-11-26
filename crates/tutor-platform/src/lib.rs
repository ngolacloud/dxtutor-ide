//! The platform side of the IDE that touches secrets (r23 F4c): the OS keychain and Vault. Tauri-free.

pub mod deploy;
pub mod keychain;
pub mod vault;
