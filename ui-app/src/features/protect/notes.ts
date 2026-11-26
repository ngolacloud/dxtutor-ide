/* Notas para a documentação oficial da protecção de dados (r23 F4a). Ver `app/notes/types.ts`. */
import type { FeatureNotes } from "../../app/notes/types";

export const PROTECT_NOTES: FeatureNotes = {
  id: "protect",
  title: "Protecção de dados — nenhum segredo sai da máquina",
  summary:
    "O IDE tira os segredos de qualquer pedido a um modelo, verifica cada commit que faz à procura de segredos, mascara-os no terminal e no depurador, e avisa no editor quando um `.tf` guarda um segredo no estado. As regras vivem no backend.",
  code: ["crates/tutor-protect/", "crates/tutor-eval/src/iacfind.rs", "src-tauri/src/commands/protect.rs", "ui-app/src/features/protect/"],
  updated: "2026-11-26",
  actions: [
    {
      title: "Redacção antes de qualquer pedido a um modelo",
      where: ["barra de estado › «N redacted»"],
      what: "Antes de cada pedido ao Co-Dev, ao chat ou ao tutor, os segredos são tirados: os padrões conhecidos (URLs com credenciais, chaves de API…) e os valores dos `.env` da pasta aberta. A barra de estado conta quantos já saíram.",
      howTo: ["Não há nada a fazer: abre a pasta e trabalha. Passa o rato sobre a contagem para ver o total."],
      flow: ["O filtro corre no backend, no último passo antes de enviar; cada pedido que perdeu algum segredo fica no registo de auditoria."],
      covers: ["protect:redact"],
    },
    {
      title: "Secret scan antes de cada commit",
      where: ["Source Control › Commit", "Commit Composer, lanes, quadro, Co-Dev"],
      what: "Cada commit que a app faz é verificado: um segredo no que vai ser comitado, ou ficheiros como `.env`, `.tfstate` e chaves, bloqueiam-no. O diálogo mostra os achados mascarados.",
      howTo: ["Tira o segredo do código (para uma variável de ambiente ou para o Vault) e comita outra vez.", "Se for mesmo preciso, o diálogo deixa passar um commit com um motivo, que fica registado."],
      flow: ["Usa o gitleaks se estiver instalado, senão as regras próprias; a excepção vale um commit durante 2 minutos."],
      limits: ["Um commit feito à mão no teu próprio terminal não passa por aqui."],
      covers: ["protect:secret-scan"],
    },
    {
      title: "Segredos mascarados e ficheiros de estado",
      where: ["terminal", "depurador", "editor (`.tf`, `.tfstate`)"],
      what: "A saída do terminal e do programa depurado mostra `••••` no lugar de um segredo conhecido. Um `.tf` com um argumento secreto vindo de uma variável ou de um literal aparece como erro no editor e no Problems. Um `.tfstate` nunca se abre no editor.",
      howTo: ["Num `.tf`, usa argumentos write-only (`password_wo`) ou valores efémeros do Vault, e marca as variáveis secretas `sensitive = true`."],
      flow: ["A máscara do terminal trabalha pedaço a pedaço; os achados de `.tf` vêm do scan do Problems ao gravar."],
      limits: ["Um segredo partido entre duas leituras do terminal pode passar."],
      covers: ["protect:mask", "protect:tfstate"],
    },
  ],
};
