/* Notas para a documentação oficial do New Project. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const NEWPROJECT_NOTES: FeatureNotes = {
  id: "newproject",
  title: "Novo projecto: um projecto completo a partir dos templates do Delonix",
  summary:
    "Cria um projecto novo já completo — código, testes, Dockerfile, compose, CI, ADRs, runbooks e dotfiles — a partir dos mesmos templates do `delonix init -t` (Rust, Go, Node.js, FastAPI, Django, NestJS, Next.js, Laravel, nginx, Apache httpd, HAProxy, Odoo e WordPress), e abre-o logo como o teu workspace.",
  code: ["crates/tutor-scaffold/src/lib.rs", "src-tauri/src/commands/scaffold.rs", "templates/projects/", "scripts/sync-delonix-templates.sh", "ui-app/src/features/newproject/"],
  updated: "2026-11-27",
  actions: [
    {
      title: "Criar um projecto novo",
      where: ["Boas-vindas › Começar › Novo projecto…", "menu File › New Project…", "paleta › File: New Project…"],
      what: "Abre um diálogo com um cartão por template, agrupados em Linguagens, Frameworks, Servidores web e Aplicações. Escolhes um, dás o nome, a pasta onde fica e a versão, e o projecto é criado e aberto como workspace.",
      howTo: [
        "Abre o Novo projecto e escolhe o cartão (por exemplo, FastAPI).",
        "Escreve o nome (letras minúsculas, dígitos e hífenes), confirma a pasta onde fica e a versão.",
        "Carrega em «Criar projecto» e confirma no diálogo, que mostra exactamente o que vai acontecer.",
        "O projecto abre-se como o teu workspace; o resumo diz como ficou o git e o lockfile.",
      ],
      flow: [
        "Os templates são os do Delonix (`bins/delonix/templates`), copiados por `scripts/sync-delonix-templates.sh` para `templates/projects/` (o commit de origem fica em `SOURCE`) e embutidos no binário pelo crate `tutor-scaffold`.",
        "`project_new_plan` valida o nome (uma etiqueta DNS), a versão (as do `template.meta`) e a pasta (nova ou vazia), e diz o que vai acontecer; não escreve nada.",
        "`project_new` substitui os tokens (`__NAME__`, `__MODULE__`, `__PORT__`, `__TLS_PORT__`, `__TEMPLATE_VERSION__`, `__DISTROLESS_REGISTRY__`) nos conteúdos e nos caminhos, escreve o `.env` (0600) com segredos aleatórios a partir do `.env.tmpl`, gera o lockfile se o gestor de pacotes estiver instalado, faz `git init` em `main` e o commit `chore: scaffold`. Fica no registo de auditoria do projecto novo, antes e com o resultado.",
      ],
      tips: ["O `.env` nunca entra no commit (o `.gitignore` do template exclui-o); os segredos são só deste projecto."],
      limits: [
        "Só na app desktop.",
        "O certificado local dos templates com HTTPS (pasta `tls/`) não é gerado: cria-o com `scripts/tls.sh` ou com o `delonix init`.",
        "Sem o gestor de pacotes (uv, pnpm, cargo, composer) instalado, o lockfile não é gerado e o resumo diz que comando correr.",
      ],
      covers: ["welcome:newProject", "newproject:pick", "newproject:create", "newproject:parent"],
    },
  ],
};
