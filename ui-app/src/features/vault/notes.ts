/* Notas para a documentação oficial do Vault (r23 F4c1). Ver `app/notes/types.ts`. */
import type { FeatureNotes } from "../../app/notes/types";

export const VAULT_NOTES: FeatureNotes = {
  id: "vault",
  title: "Vault — segredos, sessão e credenciais dinâmicas",
  summary:
    "O separador Vault liga o IDE ao HashiCorp Vault sem que o token alguma vez chegue ao ecrã: a sessão vive no keychain do sistema. Mostra os metadados dos segredos de todos os ambientes, os valores só de `local`, e emite credenciais de curta duração para um terminal.",
  code: ["crates/tutor-platform/src/keychain.rs", "crates/tutor-platform/src/vault.rs", "src-tauri/src/commands/vault.rs", "ui-app/src/features/vault/"],
  updated: "2026-11-26",
  actions: [
    {
      title: "Ligar e entrar",
      where: ["paleta: «Vault: Secrets, Sign-in and Dynamic Credentials»", "barra de estado › «Vault · …»"],
      what: "Aponta o IDE a um Vault (endereço, namespace, mount OIDC, papel) e entra pelo browser (OIDC) ou colando um token. O token vai para o keychain do sistema e nunca volta à interface.",
      howTo: [
        "Escreve o endereço e, se precisares, o namespace e o papel OIDC.",
        "«Sign in with the browser» abre o browser; volta sozinho quando entras.",
        "Ou «Paste a token…» (um campo escondido).",
        "«Renew» renova a sessão; «Sign out» revoga o token e apaga-o do keychain.",
      ],
      flow: [
        "OIDC: o Rust pede o URL ao Vault, abre o browser e espera em `127.0.0.1:8250/oidc/callback` (o mesmo que o CLI do Vault usa — o papel tem de o permitir).",
        "O token fica no keychain (Secret Service no Linux) na conta `vault:<endereço>#<namespace>`.",
        "A barra de estado mostra quem está ligado e quanto tempo falta.",
      ],
      limits: ["No Linux precisa de um GNOME Keyring ou KWallet a correr."],
      covers: ["vault:open-tab", "vault:field", "vault:oidc", "vault:token", "vault:renew", "vault:signout", "cmd:Vault: Secrets, Sign-in and Dynamic Credentials"],
    },
    {
      title: "Segredos (KV)",
      where: ["Vault › Segredos (KV)"],
      what: "Navega os segredos: metadados de todos os ambientes (versões, datas, metadados próprios); os nomes das chaves e os valores só de `local`. Os valores de staging e produção nunca saem do Vault.",
      howTo: [
        "Escreve o caminho (ex.: `apps/shop/local/db`) e «Browse»; as pastas abrem-se com um clique.",
        "Num segredo `local`, «Show…» pede um motivo e mostra o valor durante 20 segundos.",
        "«Patch in a terminal…» abre um terminal com `vault kv patch … chave=-`: escreves o valor novo lá, e o IDE nunca o vê.",
      ],
      flow: [
        "O ambiente lê-se do caminho (`…/local/…`, `…/staging/…`, `…/production/…`); um caminho sem ambiente é tratado como não-local. A recusa está no Rust.",
        "Mostrar um valor vai primeiro ao registo de auditoria; o valor passa a ser filtrado dos pedidos aos modelos e do terminal.",
        "O terminal recebe o token do backend (`VAULT_TOKEN`) e mascara-o na saída.",
      ],
      covers: ["vault:path", "vault:browse", "vault:open", "vault:up", "vault:reveal", "vault:hide", "vault:patch"],
    },
    {
      title: "Credenciais dinâmicas",
      where: ["Vault › Credenciais dinâmicas"],
      what: "Pede a um motor de segredos (ex.: `database`) credenciais de curta duração. O ecrã só vê o lease; os valores vão para um terminal e o lease é revogado quando esse terminal acaba.",
      howTo: ["Escreve o mount do motor e o papel e carrega «Issue credentials…» (pede um motivo).", "«Open a terminal with them» abre uma shell com `VAULT_DYN_*`.", "«Revoke» revoga já."],
      flow: ["O pedido vai ao registo de auditoria antes; os valores ficam no backend até o terminal os receber.", "Ao fechar o terminal, o backend revoga o lease e avisa."],
      covers: ["vault:dynamic", "vault:use-lease", "vault:revoke-lease"],
    },
  ],
};
