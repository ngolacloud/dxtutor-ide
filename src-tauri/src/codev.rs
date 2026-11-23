//! Caso de uso «Co-Dev» — **independente de Tauri** (Etapa 3).
//!
//! Os cinco comandos co-dev de `lib.rs` dividem-se em duas naturezas:
//!  - `codev_policy` trazia, embutida no `#[tauri::command]`, uma **regra**: traduzir a
//!    string da modebar (Manual/Assist/Auto, desconhecida → a mais estrita) na
//!    [`CoDevPolicy`] que o frontend consulta. Essa regra isola-se aqui em
//!    [`policy_for_mode`], deixando a fronteira IPC (`commands::codev`) um adaptador fino
//!    — como `review::run_review` ↔ `commands::review`.
//!  - `codev_session_*` eram passagens directas ao *mecanismo* de sessões (worktrees git
//!    isoladas em `codev/<slug>`), que vive em `tutor_eval::git` e NÃO tem regra para
//!    isolar — tal como as leituras sem regra do grupo git. Re-exportam-se aqui
//!    ([`session_start`]/[`session_deliver`]/[`session_discard`]/[`sessions`]) para que a
//!    fatia co-dev tenha UMA fachada Tauri-free: o adaptador IPC e o teste integrado
//!    atravessam a mesma fronteira (`crate::codev`), sem o runtime Tauri nem o crate
//!    `tutor_eval` exposto ao crate de teste.

use tutor_llm::policy::{codev_policy, CoDevMode, CoDevPolicy};

// Mecanismo de sessões (worktrees git) — puro, sem Tauri. Re-exportado como fachada da
// fatia; os tipos de retorno (`SessionInfo`/`DeliverInfo`, serde camelCase) acompanham.
pub use tutor_eval::git::{
    session_deliver, session_discard, session_start, sessions, DeliverInfo, SessionInfo,
};

/// Regra de `codev_policy`: a string da modebar → a política de aprovação Co-Dev. Faz o
/// parse (desconhecida → `Manual`, fail-closed) e deriva o retrato [`CoDevPolicy`] que a UI
/// consulta para saber se edições/comandos se aplicam sozinhos ou pedem aprovação. Acções
/// destrutivas e push pedem sempre, em qualquer modo (garantia da política, não do caso de uso).
pub fn policy_for_mode(mode: &str) -> CoDevPolicy {
    codev_policy(CoDevMode::parse(mode))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A string da modebar escolhe o modo; desconhecida cai no mais estrito (fail-closed),
    /// exactamente como o comando fazia via `CoDevMode::parse`.
    #[test]
    fn policy_parses_the_modebar_mode_and_fails_closed() {
        assert_eq!(policy_for_mode("manual").mode, "manual");
        assert_eq!(policy_for_mode("assist").mode, "assist");
        assert_eq!(policy_for_mode("auto").mode, "auto");
        // Desconhecida / vazia → Manual (o mais estrito).
        assert_eq!(policy_for_mode("weird").mode, "manual");
        assert_eq!(policy_for_mode("").mode, "manual");
    }

    /// Manual exige aprovação de tudo; Assist/Auto aplicam edições e comandos sozinhos.
    #[test]
    fn manual_asks_for_everything_assist_and_auto_do_not() {
        let m = policy_for_mode("manual");
        assert!(m.edits_need_approval && m.commands_need_approval);
        for mode in ["assist", "auto"] {
            let p = policy_for_mode(mode);
            assert!(
                !p.edits_need_approval,
                "{mode}: edições aplicam-se sozinhas"
            );
            assert!(
                !p.commands_need_approval,
                "{mode}: comandos aplicam-se sozinhos"
            );
        }
    }

    /// Só o Auto encadeia passos sem parar; Assist aplica um passo mas pára entre passos.
    #[test]
    fn only_auto_chains_steps() {
        assert!(!policy_for_mode("manual").chains);
        assert!(!policy_for_mode("assist").chains);
        assert!(policy_for_mode("auto").chains);
    }

    /// A garantia de segurança é independente do modo: destrutivo/push pedem sempre.
    #[test]
    fn destructive_always_asks_in_every_mode() {
        for mode in ["manual", "assist", "auto", "weird"] {
            assert!(
                policy_for_mode(mode).destructive_always_asks,
                "{mode}: destrutivo/push pede sempre"
            );
        }
    }
}
