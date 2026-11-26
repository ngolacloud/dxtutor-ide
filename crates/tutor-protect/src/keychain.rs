//! The OS keychain (r23 F4c, docs/v2/AUDIT-r23.md §4.4 — K01, §5 Q8/Q15e): where the Vault token and
//! the model API keys live. On Linux the Secret Service over D-Bus (GNOME Keyring, KWallet), on macOS
//! the Keychain, on Windows the Credential Manager — through the `keyring` crate.
//!
//! A secret goes in and is read back only by the backend; no command returns one to the UI.
//! The service name is `dxtutor`, or `DXTUTOR_KEYCHAIN_SERVICE` (the self-test uses its own, so it
//! never reads or writes the human's entries).

use std::collections::HashMap;
use std::sync::Mutex;

/// Where secrets are kept: the OS keychain, or memory in tests.
pub trait Store: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    /// Removing what is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// The keychain's service name.
pub fn service() -> String {
    std::env::var("DXTUTOR_KEYCHAIN_SERVICE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dxtutor".into())
}

/// The OS keychain.
pub struct OsStore {
    service: String,
}

impl OsStore {
    pub fn new() -> Self {
        OsStore { service: service() }
    }

    pub fn with_service(service: &str) -> Self {
        OsStore {
            service: service.into(),
        }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, account).map_err(|e| unavailable(&e))
    }

    /// Whether the keychain answers (a daemon is running and unlocked).
    pub fn available(&self) -> Result<(), String> {
        self.get("dxtutor-probe").map(|_| ())
    }
}

impl Default for OsStore {
    fn default() -> Self {
        Self::new()
    }
}

fn unavailable(e: &keyring::Error) -> String {
    format!("the OS keychain is not available ({e}): on Linux it needs a Secret Service (GNOME Keyring or KWallet) running and unlocked")
}

impl Store for OsStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match self.entry(account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(unavailable(&e)),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|e| unavailable(&e))
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(unavailable(&e)),
        }
    }
}

/// Secrets in memory (tests).
#[derive(Default)]
pub struct MemStore(Mutex<HashMap<String, String>>);

impl Store for MemStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trip() {
        let s = MemStore::default();
        assert_eq!(s.get("a").unwrap(), None);
        s.set("a", "x").unwrap();
        assert_eq!(s.get("a").unwrap().as_deref(), Some("x"));
        s.delete("a").unwrap();
        s.delete("a").unwrap();
        assert_eq!(s.get("a").unwrap(), None);
    }

    /// The real keychain of this session, under a service of its own (removed at the end). Skipped
    /// when no Secret Service answers (CI without a session bus).
    #[test]
    fn the_os_keychain_keeps_and_forgets() {
        let s = OsStore::with_service(&format!("dxtutor-test-{}", std::process::id()));
        if let Err(e) = s.available() {
            eprintln!("skipped: {e}");
            return;
        }
        s.set("vault:http://127.0.0.1:8200#", "hvs.test-token")
            .unwrap();
        assert_eq!(
            s.get("vault:http://127.0.0.1:8200#").unwrap().as_deref(),
            Some("hvs.test-token")
        );
        s.delete("vault:http://127.0.0.1:8200#").unwrap();
        assert_eq!(s.get("vault:http://127.0.0.1:8200#").unwrap(), None);
    }
}
