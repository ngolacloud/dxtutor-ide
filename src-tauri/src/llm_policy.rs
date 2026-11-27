//! The model-call policy of this machine and the open project: whether the organisation's
//! gateway is required, and which gateway to use ([`tutor_llm::gateway`]).
//!
//! Every path that calls a model asks here first, in the backend — the Co-Dev and its
//! reviewer (`codev_agent::make_provider`), `llm_chat`, `assistant_chat_stream` and the study
//! hint/plan/fix commands. A refused call never reaches the network.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tutor_llm::gateway::{GatewaySpec, Policy, Sources, PROJECT_FILE};

/// The folder the IDE has open (set by `llm_policy_status`), for the paths that do not get a
/// project root of their own (chat, streaming, study).
static OPEN_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Remember the open folder (`None` when it closes).
pub fn set_open_root(root: Option<PathBuf>) {
    *OPEN_ROOT.lock().unwrap_or_else(|e| e.into_inner()) = root;
}

fn open_root() -> Option<PathBuf> {
    OPEN_ROOT.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The effective policy for `root` (or the open folder when `None`).
pub fn current(root: Option<&Path>) -> Policy {
    let project_root = root.map(Path::to_path_buf).or_else(open_root);
    policy_for(
        tutor_llm::gateway::system_policy_path(),
        tutor_llm::chat::load_config().user_gateway(),
        project_root,
        tutor_agent::trust::default_store().as_deref(),
    )
}

/// The policy from explicit sources: the organisation's file, the person's gateway, the
/// project and the trust store.
fn policy_for(
    system: PathBuf,
    user_gateway: Option<GatewaySpec>,
    project_root: Option<PathBuf>,
    trust_store: Option<&Path>,
) -> Policy {
    let project_trusted = match (&project_root, trust_store) {
        (Some(r), Some(store)) => tutor_agent::trust::is_trusted(store, r, PROJECT_FILE),
        _ => false,
    };
    Policy::load(&Sources {
        system: Some(system),
        user_gateway,
        project_root,
        project_trusted,
    })
}

/// Whether `provider` may be called for `root` (or the open folder).
pub fn check(provider: &str, ollama_host: Option<&str>, root: Option<&Path>) -> Result<(), String> {
    current(root).check(provider, ollama_host)
}

/// The gateway to call for `root`, with its key (`llm:gateway` in the keychain, or
/// `DXTUTOR_GATEWAY_KEY`).
pub fn gateway_with_key(
    config_dir: &Path,
    root: Option<&Path>,
) -> Result<(GatewaySpec, String), String> {
    let policy = current(root);
    policy.check("gateway", None)?;
    let spec = policy.gateway.expect("checked above");
    let key = crate::keys::resolve(config_dir, "gateway").ok_or(
        "no gateway key: save it in Settings → Models and providers, or set DXTUTOR_GATEWAY_KEY",
    )?;
    Ok((spec, key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_llm::gateway::GatewayApi;

    #[test]
    fn a_trusted_project_file_brings_its_gateway() {
        let dir = tempfile::tempdir().unwrap();
        let sys = dir.path().join("absent.json");
        let proj = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(proj.path().join(".dxtutor")).unwrap();
        std::fs::write(
            proj.path().join(PROJECT_FILE),
            r#"{"require_gateway": true, "gateway": {"url": "https://ai.client.example", "api": "openai"}}"#,
        )
        .unwrap();
        let store = dir.path().join("trusted.json");
        let mine = Some(GatewaySpec {
            url: "https://mine.example".into(),
            api: GatewayApi::Anthropic,
        });

        let before = policy_for(
            sys.clone(),
            mine.clone(),
            Some(proj.path().to_path_buf()),
            Some(&store),
        );
        assert!(before.require_gateway);
        assert_eq!(before.gateway.as_ref().unwrap().url, "https://mine.example");
        assert!(before.check("claude", None).is_err());

        tutor_agent::trust::trust(&store, proj.path(), PROJECT_FILE).unwrap();
        let after = policy_for(sys, mine, Some(proj.path().to_path_buf()), Some(&store));
        assert_eq!(after.gateway.unwrap().url, "https://ai.client.example");
    }

    #[test]
    fn the_organisation_file_on_this_machine_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let sys = dir.path().join("llm.json");
        std::fs::write(&sys, r#"{"require_gateway": true, "allow_local": false}"#).unwrap();
        let p = policy_for(sys, None, None, None);
        assert!(p.check("ollama", None).is_err());
        assert!(
            p.check("gateway", None).is_err(),
            "required, but none configured"
        );
    }
}
