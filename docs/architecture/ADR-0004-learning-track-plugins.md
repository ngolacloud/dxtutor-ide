# ADR-0004 — Learning Track em plugins de curso (10 linguagens, texto de conceitos, VS Code)

- **Estado:** aceite; Fase 1 implementada (branch `feat/learning-plugins`)
- **Data:** 2026-11-23
- **Decisor:** responsável do projecto
- **Relacionado:** `ADR-0002` (Clean Architecture das features), `IPC-MATRIX.md` §10d,
  guia de autoria `docs/plugins/README.md`

## Contexto

O Learning Track tinha dois cursos (Rust, Go) embutidos como JSON na UI
(`ui-app/src/content/courses/*.json`, ~580 KB) e uma lista fixa de linguagens em
`features/learn.ts`, três delas «Coming soon». Em paralelo, o backend tinha os mesmos cursos
em TOML (`crates/tutor-core/content/*.toml`), usados para avaliar desafios
(`submit_step`). Medido a 2026-11-23: o JSON da UI é uma **projecção exacta** do TOML, com os
mesmos 32 + 26 unidades, os mesmos passos e o mesmo conteúdo. Faltam-lhe só os campos de
toolchain (`install_commands`, `run_command`, `dependencies`) e `language`/`level` do curso.

O dono quer:
1. no máximo **10 linguagens** oficiais, das usadas pelas grandes empresas de tecnologia;
2. em cada tópico, um **texto de conceitos** para o leitor perceber o tópico e a linguagem;
3. uma **estrutura de plugins** documentada, para qualquer pessoa publicar um curso no GitHub
   e o instalar pela app ou pelo CLI `dxt`;
4. suporte a **extensões VS Code**.

## Decisão

### Formato: o `tutor_core::Course` é o schema do plugin

Não se inventa um formato novo: o curso de um plugin é um `tutor_core::Course` em TOML
(recomendado) ou JSON (aliases `units`/`steps`). Ganha dois campos opcionais:
`Course.overview` (apresentação da linguagem) e `Unit.concepts` (texto de leitura do tópico).
O mesmo tipo serve a validação, a avaliação (`submit_step`) e a UI (via `CourseDto`), por
isso não há segundo formato a divergir.

O manifesto `dxtutor-plugin.json` (`schema: 1`) descreve o plugin e a linguagem (id, nome,
ícone, extensão, indentação). Ver `crates/tutor-plugins/src/manifest.rs` e o JSON Schema em
`docs/plugins/`.

### Um crate partilhado: `crates/tutor-plugins`

Manifesto, validação, origem (`python` → `github:dxtutor-courses/python`, `owner/repo@ref`,
URLs GitHub, `.zip` HTTPS, pasta/zip locais), instalação atómica (staging → rename) e registo
(`installed.json`, com sha256). Usado pelos comandos Tauri `plugin_list`/`plugin_install`/
`plugin_remove` (`src-tauri/src/commands/plugins.rs`) e pelo CLI `dxt plugin
install|list|remove|validate|new`. Os dois escrevem no mesmo sítio: `$DXTUTOR_PLUGINS_DIR` ou
a pasta de dados do utilizador.

`study.rs` passa a ter uma fonte única, `all_courses()`: os embutidos (agora lidos uma só vez)
mais os dos plugins, em cache invalidada pelo mtime do registo. `list_courses`, `get_course`,
`course_step` e `grade_step` usam-na. Os ids de curso/passo repetidos são recusados na
instalação, por isso um plugin nunca faz sombra a um curso embutido.

### Segurança

Plugins são dados: a instalação não executa nada. Zip com `enclosed_name` (sem `..`/raiz),
symlinks ignorados, limites de 64 MiB e 5000 ficheiros, `take()` contra tamanhos declarados
falsos. Os testes de um desafio correm no avaliador, como os dos cursos embutidos. Os testes
ocultos e o gabarito não vão para o webview (já era assim no `step_dto`).

### UI: subárvore tipada `features/learn/`

Nova feature governada por A7/A8 (entra em `FEATURES` no `arch-check.sh`), nascida tipada:

```
features/learn/
  domain/          types.ts, catalog.ts (LANGUAGE_CATALOG — as 10 — + languageCards/
                   findLanguage/indentText), course-adapter.ts (CourseDto camelCase →
                   forma snake_case do motor; embutidos → domínio). PURO.
  application/     ports.ts (CourseGateway) + catalog-service.ts (loadCatalog/installPlugin/
                   removePlugin/gradeStep; deps injectadas).
  ui/              actions.ts (1 listener delegado, chave __learnActionHandler__).
  infrastructure/  legacy-bridge.ts — adaptador sobre platform/tauri/learn.ts.
features/learn.ts  RESÍDUO (motor + DOM): selector das 10 linguagens + painel de plugins,
                   cartões de leitura (overview/concepts), avaliação REAL dos desafios de
                   cursos servidos pelo backend.
```

As 10 linguagens: Rust, Go, Python, TypeScript, Java, Kotlin, Swift, C#, C++, SQL. Sai o C;
o JavaScript fica coberto pelo TypeScript. Linguagens fora do catálogo instaladas por plugin
aparecem como cartão «Community».

Rust e Go embutidos mantêm o comportamento actual do protótipo (avaliação simulada no
browser). Os cursos servidos pelo backend usam `submit_step`. Sem simulação: se a linguagem
ainda não tiver avaliador, a UI mostra o erro do backend.

## Fases

1. **Formato + loader + CLI + docs.** Feito: tutor-core, tutor-plugins, `dxt plugin`, 3
   comandos Tauri, UI, guia de autoria, template.
2. **Rust/Go como plugins oficiais.** Publicar `dxtutor-courses/rust` e `dxtutor-courses/go` a
   partir dos TOML do tutor-core, escrever o `concepts` de cada unidade e o `overview` de cada
   curso. Os embutidos ficam como fallback do browser.
3. **As 8 linguagens novas**, como cursos completos (paridade com Rust/Go), uma por sessão. Cada
   linguagem precisa do seu avaliador em `tutor_eval` (compilar/correr os testes ocultos) e do
   toolchain disponível, de preferência num dev-container.
4. **Extensões VS Code.** Contribuições declarativas: temas → tokens CSS, gramáticas TextMate
   (`vscode-textmate` + `vscode-oniguruma`), snippets, language-configuration. Mais as
   extensões que só arrancam um servidor LSP: uma tabela de servidores conhecidos ligada ao
   `lsp.rs`, porque o arranque do LSP numa extensão VS Code é código JS, não manifesto. Fica
   fora um extension host Node completo.

## Consequências

- Contribuir um curso passa a ser trabalho de conteúdo: um repo, `dxt plugin new`,
  `dxt plugin validate --strict` no CI.
- O schema do curso é contrato público: os campos novos entram como opcionais, e um campo
  obrigatório novo é um `schema: 2` do manifesto.
- Os ids de passo publicados não se podem renomear, porque o progresso do aluno (`LTS.done`)
  é indexado por eles.
- O template de CI instala o `dxt` com `cargo install --git
  https://github.com/ngolacloud/dxtutor-ide`. Isto exige que esse repositório seja público,
  ou que o `dxt` passe a ser publicado como binário de release.
