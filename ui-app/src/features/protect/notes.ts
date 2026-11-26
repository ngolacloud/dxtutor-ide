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
      flow: ["As regras próprias correm sempre; se o gitleaks estiver instalado, junta-lhes as dele (uma linha que os dois apontam aparece uma vez). A excepção vale um commit durante 2 minutos."],
      limits: ["Um commit feito à mão no teu próprio terminal só passa por aqui com o hook de pre-commit instalado (abaixo)."],
      covers: ["protect:secret-scan"],
    },
    {
      title: "Hook de pre-commit — o mesmo scan nos commits do terminal",
      where: ["paleta: «Protect: Install the Pre-commit Hook…»"],
      what: "Instala no repositório aberto um hook de pre-commit que corre `dxt secret-scan --staged`: as mesmas regras da app, sobre o que o commit leva. Um commit feito num terminal com um segredo ou um `.env` fica bloqueado, com os achados mascarados.",
      howTo: [
        "Instala o `dxt` uma vez, a partir do repositório do dxtutor-ide: `cargo install --path crates/tutor-cli`.",
        "Abre a pasta do projecto, corre o comando na paleta e aprova: o diálogo mostra o ficheiro e o texto exactos que vão ser escritos.",
        "Para o tirar, apaga o ficheiro `pre-commit` da pasta de hooks do repositório.",
      ],
      flow: [
        "O backend descobre a pasta de hooks pelo git (respeita worktrees e `core.hooksPath`), regista a instalação no registo de auditoria antes de escrever o ficheiro, e a UI regista o resultado.",
        "O `dxt secret-scan` usa as regras próprias (mais as do gitleaks, se estiver instalado) e junta os valores secretos dos `.env` do repositório. Sai com 0 (limpo), 1 (achados) ou 2 (não conseguiu correr).",
      ],
      tips: ["`dxt secret-scan --all` verifica o que um `git commit -a` levaria; `--working`, todas as mudanças."],
      limits: [
        "Um hook de pre-commit que não seja do dxtutor (husky, lint-staged…) nunca é substituído: acrescenta-lhe `dxt secret-scan --staged` à mão.",
        "Sem o `dxt` no PATH, o hook bloqueia o commit e diz porquê.",
        "O git deixa saltar qualquer hook com `git commit --no-verify`; o hook não é uma barreira contra quem o quer contornar.",
      ],
      covers: ["protect:hook", "cmd:Protect: Install the Pre-commit Hook…"],
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
