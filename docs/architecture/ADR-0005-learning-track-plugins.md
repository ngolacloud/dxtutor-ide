# ADR-0005 — Learning Track em plugins de curso (10 linguagens, texto de conceitos, VS Code)

- **Estado:** aceite; Fases 1–4 implementadas (branch `feat/learning-plugins`); emendado a
  2026-11-26 (frameworks e ferramentas, passos de projecto — ver «Emenda» no fim)
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

Manifesto, validação, origem (`python` → `github:ngolacloud/dxtutor-course-python`, `owner/repo@ref`,
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
2. **Rust/Go como plugins oficiais.** Feito (falta publicar nos repositórios):
   - A fonte única passa a ser `courses/<id>/` (plugin completo). O `tutor-core` embute esse TOML
     (`include_str!`). O JSON da UI é gerado por `scripts/sync-ui-courses.py`, e o teste
     `tutor-core/tests/ui_json.rs` falha se divergirem. Os TOML antigos em
     `crates/tutor-core/content/` saíram.
   - Há `concepts` em todas as 58 unidades (cerca de 30 mil palavras) e `overview` nos dois
     cursos. Os exemplos foram compilados (Rust com `rustc`, Go com `go vet`/`gofmt`).
   - Um plugin com o MESMO id de curso de um embutido substitui-o (`study::all_courses`; a UI
     prefere o backend quando um plugin traz a linguagem). A validação regista-o como *nota*,
     que não reprova o `--strict`.
   - Bug que já existia, corrigido: Rust e Go repetem 21 ids de passo (`ch1-greet`, `ch3-sign`,
     …), e `grade_step` avaliava um desafio Go contra o passo Rust. Agora `submit_step` aceita
     `language` (opcional) e procura só nos cursos dessa linguagem. A unicidade de ids de passo
     na validação passou a ser por linguagem. **Não corrigido:** `request_hint`/`study_policy`
     resolvem o passo só pelo id (`course_step`) e têm a mesma ambiguidade.
   - Publicação: `scripts/publish-course.sh <id>` faz `git subtree split` de `courses/<id>` e
     push para `ngolacloud/dxtutor-course-<id>` com a tag `v<versão>`.
3. **As 8 linguagens novas**, como cursos completos (paridade com Rust/Go), uma por sessão. Cada
   linguagem precisa do seu avaliador em `tutor_eval` (compilar/correr os testes ocultos) e do
   toolchain disponível, de preferência num dev-container.
   - **Ferramentas (feito):**
     - `dxt plugin test`: corre cada drill e avalia cada desafio com o avaliador real; o
       gabarito tem de passar e o starter tem de falhar.
     - `tutor_eval::run_program`: os drills de qualquer linguagem com descritor deixam de cair
       no `rustc`.
     - `tutor_eval::language_supported`: o `grade_step` dá um erro claro em vez de compilar
       como Rust uma linguagem sem avaliador. O fallback histórico do `runner_for` continua
       lá, para os outros consumidores.
   - **Python (feito):**
     - Avaliador por descritor embutido (`unittest` da stdlib, `python3 -m unittest`;
       diagnósticos de `SyntaxError` com linha e coluna).
     - Curso `courses/python/`: 34 unidades e 170 passos. 6 unidades básicas; 15 intermédias,
       incluindo 6 de bases de dados com `sqlite3`; 13 avançadas (decorators, functools,
       protocols, threads, filas, asyncio, multiprocessing e estruturas de dados/algoritmos).
     - `dxt plugin test` dá 170/170 em 3 execuções seguidas.
     - Embutido só no backend (`tutor-core`), sem JSON na UI: no browser fica «Coming soon»,
       no desktop está disponível.
   - **C++ (feito):**
     - Descritor embutido com um mini-framework de testes no prelúdio (`TEST(nome)`,
       `CHECK`, `CHECK_EQ`, auto-registo e `main` próprio; nenhuma dependência a instalar).
       Compila com g++ C++20 e `-pthread`; o `-lsqlite3` só entra quando o código inclui
       `sqlite3.h`, porque a imagem `gcc:13` do motor de contentores não traz o SQLite.
     - Curso `courses/cpp/`: 34 unidades e 170 passos, com RAII, smart pointers, move
       semantics, a API C do SQLite embrulhada em RAII, templates, concepts, threads, atomics
       e futures. `dxt plugin test` dá 170/170 duas vezes seguidas. Embutido só no backend.
   - **TypeScript (feito):**
     - Corre no Node ≥ 22.18 retirando os tipos (`--experimental-transform-types`), sem `tsc`.
       O ficheiro do aluno é concatenado com um harness (`dxt.test/equal/check/throws`) e os
       testes. Os diagnósticos usam o `tsc` só se estiver instalado.
     - O descritor ganhou `host_path_hints` (`~/.nvm/versions/node/*/bin`, Volta, fnm,
       Homebrew), porque o `node` instalado pelo utilizador fica fora do PATH endurecido do
       avaliador e do PATH de uma app aberta pelo menu do sistema.
     - Curso `courses/typescript/`: 34 unidades e 170 passos (unions e narrowing, generics,
       utility types, async, `node:sqlite`, conditional/mapped types, event loop, estruturas
       de dados). `dxt plugin test` dá 170/170 duas vezes seguidas, e `tsc --strict` passa nos
       136 ficheiros (drills, e solução + harness + testes) com `@types/node`. Embutido só no
       backend.
   - **SQL (feito):**
     - Descritor que usa o SQLite do Python (`sqlite3` da stdlib, 3.45 nesta máquina), por isso
       basta o `python3`. Os drills correm instrução a instrução e imprimem como o CLI
       (`col|col`). Os testes são `unittest` com os ajudantes `query/script/connect`. Os
       diagnósticos dão o primeiro erro SQLite na linha da instrução.
     - Curso `courses/sql/`: 34 unidades e 170 passos (joins, subqueries, constraints,
       normalização, lógica de NULL, transacções, índices e planos, N+1, paginação, views,
       upserts, CTEs e CTEs recursivas, window functions, JSON, datas, triggers, optimização,
       hierarquias, gaps & islands, pivoting, limpeza de dados, analytics). `dxt plugin test` dá
       170/170 duas vezes. Embutido só no backend.
   - **Java (feito):**
     - Descritor sobre o *source launcher* do JDK 21 (`java File.java`), sem Maven nem Gradle.
       O `test_cmd` monta um `Run.java`: imports juntos no topo, o
       harness (cuja primeira classe tem o `main`), os testes dentro de `define()`, e as
       classes do aluno. Diagnósticos do `javac` com a linha.
     - Curso `courses/java/`: 34 unidades e 170 passos. O bloco de bases de dados dá lugar a
       **Java para produção** (Optional, java.time, NIO, regex, equals/hashCode/Comparator,
       imutabilidade), porque o JDK não traz driver SQLite e o curso usa só o JDK.
       `dxt plugin test` dá 170/170 duas vezes. Embutido só no backend.
   - **Kotlin (feito):**
     - Descritor: `kotlinc` + `java`. O harness tem os métodos como membros de uma classe e os
       testes correm numa extensão dela, para não chocar com os nomes do aluno nem fazer
       sombra ao `check`/`require` da stdlib. O `kotlinx-coroutines-core-jvm.jar` que vem com o
       compilador entra no classpath. `-J-XX:TieredStopAtLevel=1` corta cerca de metade do
       tempo de compilação, que é uma JVM nova de cada vez.
     - Curso `courses/kotlin/`: 34 unidades e 170 passos, com um bloco de Kotlin para produção
       no lugar das bases de dados, e coroutines, Flow, channels, DSLs e value classes.
       `dxt plugin test` dá 170/170. Embutido só no backend.
   - **C# (feito):**
     - Descritor: compila com o Roslyn do SDK (`csc.dll`) contra as assemblies de referência
       do .NET 8, sem MSBuild nem NuGet, em cerca de 1 s. O código do aluno e os testes são
       dois ficheiros do mesmo programa, e o harness tem os métodos como membros de uma classe
       parcial.
     - Curso `courses/csharp/`: 34 unidades e 170 passos, com um bloco de C# para produção no
       lugar das bases de dados (o SQLite precisa de NuGet), pattern matching, async/await,
       channels e spans. `dxt plugin test` dá 170/170 duas vezes. Embutido só no backend.
     - Corrigido pelo caminho: o `Show()` do harness rebentava com `InvalidCastException` ao
       mostrar um `Dictionary<K,V>` num `Equal` falhado. Agora usa o enumerador de
       `IDictionary`; há um teste de regressão.
   - **Swift (feito):**
     - Descritor: `swiftc -O -swift-version 6`. O aluno escreve só declarações
       (`Student.swift`), e os testes vão para um `main.swift` com um harness `@MainActor`
       (testes `async`). Procura a toolchain real do swiftly, porque o proxy do swiftly no PATH
       precisa do `$HOME` verdadeiro. Por isso as pastas de `host_path_hints` passaram a vir
       antes do binário encontrado no PATH.
     - Curso `courses/swift/`: 34 unidades e 170 passos, com um bloco de Swift para produção no
       lugar das bases de dados (generics, Codable, datas, Regex, Hashable, semântica de
       valor), async/await, task groups, actors, AsyncStream, result builders e ARC.
       `dxt plugin test` dá 170/170 duas vezes. Embutido só no backend.
   - **Fase 3 concluída: as 10 linguagens oficiais têm curso completo** (Rust, Go, Python,
     TypeScript, Java, Kotlin, Swift, C#, C++, SQL; 8 × 170 passos novos), avaliador real e
     `dxt plugin test` verde.
   - **Aviso de ambiente:** o instalador do swiftly acrescenta `. ~/.local/share/swiftly/env.sh`
     ao `~/.profile`. Esse ficheiro usa sintaxe de bash e faz rebentar `sh -l` (dash). O executor
     de testes do projecto (`testexec.rs`, `sh -lc`) e o teste `tests_run` falham nessa máquina
     até a linha ser guardada com `[ -n "$BASH_VERSION" ] && …`.
   - **Melhoria futura:** o manifesto do plugin de curso poder trazer o seu próprio descritor de
     avaliador (hoje um descritor da comunidade vai para `~/.config/dxtutor/plugins/`).
4. **Extensões VS Code.** Feito. Fica de fora um extension host Node completo: o JavaScript das
   extensões não corre, e a página de detalhe di-lo com clareza.
   - **Contribuições declarativas** (`features/ext/domain/` + `application/contributions-engine.ts`,
     tipado, governado por A7/A8):
     - **JSONC:** comentários e vírgulas finais, nos ficheiros das extensões.
     - **Temas:** `colors` e `tokenColors` passam a CSS confinado ao editor (`.ed`), com a
       regra de prefixo mais específica do VS Code. Os selectores descendentes ou com
       exclusões ficam de fora, porque só valem num contexto (regressão do Dracula). Também
       segue o `include` entre ficheiros. Só aceita cores `#hex`, e o tema escolhe-se na
       paleta (`Color Theme: …`).
     - **Gramáticas TextMate «lite»:** não usam `vscode-textmate` nem Oniguruma (seria uma
       dependência wasm). Um tokenizador próprio traduz regex Oniguruma para JavaScript,
       com `match`, `begin`/`end` com estado entre linhas e retro-referências, capturas
       (incluindo capturas com `patterns`), `#repository` e `$self`. Os padrões que não
       compilam são ignorados. Medido com gramáticas reais: 90–100% dos padrões compilam
       (falham as classes aninhadas do Oniguruma), em cerca de 2 ms por documento.
     - **Snippets:** tabstops, padrões aninhados, escolhas, `$0`, variáveis `TM_*` e
       `CURRENT_*`, escapes e indentação. Expandem com o Tab no editor.
     - **language-configuration:** o `lineComment` do Ctrl+/, com marcadores por omissão
       quando nenhuma extensão o declara.
     - O `loadVsix` lê estes ficheiros, guarda-os em LS e mostra na página de detalhe o que a
       extensão aplica e os avisos (gramática plist, ficheiro em falta).
   - **LSP:**
     - Tabela `KNOWN_LANGUAGE_SERVERS` (id da extensão → servidor).
     - O `lsp.rs` ganhou `clangd`, `sourcekit-lsp` (vem na toolchain do swiftly), `csharp-ls`,
       `jdtls`, `kotlin-language-server` e `sqls`, cada um resolvido no PATH ou em pastas
       conhecidas, com um erro legível se faltar.
   - **Open VSX:**
     - `vsix_fetch_open_vsx` (bridge.rs, 153→154) descarrega o VSIX mais recente de
       `publisher.name`. Só fala com open-vsx.org, valida o ficheiro e limita-o a 100 MiB.
     - No desktop, o painel de extensões ganha «Install from Open VSX». Testado ao vivo com
       `editorconfig.editorconfig` (teste `#[ignore]`).
   - **Verificação com extensões reais** do Open VSX: tema Dracula (cores certas para fundo,
     keywords, strings, números, funções e tipos) e Even Better TOML (comentários, strings
     multi-linha, números, booleanos, chaves e tabelas).

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

## Emenda (2026-11-26): frameworks e ferramentas; passos de projecto

- **Decisor:** responsável do projecto. **Implementação:** fase P0, branch `feat/learn-frameworks`.

### Contexto

O dono quer cursos de frameworks e ferramentas: Dxjs, Seiva, Django, Delonix Engine, Docker,
Podman, Kubernetes (sandbox: kind sobre Podman rootless) e Odoo 18–20 (Community, e Enterprise só
com licença). A auditoria do Learning Track (2026-11-26) mostrou dois bloqueios: (1) o catálogo de
10 linguagens está cheio e um curso de Django teria de fingir ser a «linguagem» `django`, o que
desfaz o sentido da decisão das 10; (2) um desafio é um só ficheiro (`starter`, `tests`,
`submit_step(code)`), e estes cursos precisam de vários (um módulo, um manifesto e a sua
configuração).

### Decisão

1. **Frameworks e ferramentas são uma categoria SEPARADA das linguagens.** O tecto de 10 fica só
   para as linguagens (`MAX_OFFICIAL_LANGUAGES`, o teste continua a exigir as 10). Os frameworks e
   ferramentas têm o seu catálogo oficial (`FRAMEWORK_CATALOG` em `learn/domain/catalog.ts`: id,
   nome, ícone, categoria, documentação oficial, o que instalar, repositório
   `ngolacloud/dxtutor-course-<id>`) e a sua secção no selector («Frameworks & tools»).
2. **O modelo: `category` + `subject` + `language`.** `Course.category` (`language`, o omisso;
   `framework`; `tool`) e `Course.subject` (o id do que se ensina, `django`). O `language`
   continua a ser a linguagem que **avalia** os passos (`python` num curso de Django): é por ele
   que se escolhe o avaliador e que se garante a unicidade dos ids de passo. Assim não há segundo
   eixo de avaliação, e um curso de framework reusa os descritores que já existem. O manifesto
   ganha `category` e `subject {id, name, icon, docs}`, ambos opcionais: um plugin antigo é de
   linguagem e serializa como antes.
3. **Regras de validação (no Rust, `tutor-plugins`):** `subject` só com `framework`/`tool`, e
   obrigatório aí; `subject.id` válido e diferente de `language.id`; `docs` em `https://`; cada
   curso com a categoria e o `subject` do manifesto; `language` do curso igual a `language.id`
   (agora com o sentido de «avaliado em»); um curso de linguagem sem `subject`. Um plugin que
   substitui um curso embutido tem de ter a mesma categoria e `subject`.
4. **O backend não confunde os dois:** `study::course(language)` só devolve cursos de linguagem
   (um curso de Django avaliado em Python nunca passa a ser «o curso de Python»);
   `get_course(language, subject?)` dá o do framework. `list_courses`/`get_course` levam
   `category` e `subject`. Nenhum comando novo (os parâmetros são opcionais).
5. **Antes de um curso existir**, o cartão de um framework oficial mostra-se exactamente como o
   de uma linguagem oficial sem plugin: «Coming soon», desactivado, sem progresso nem conteúdo
   de demonstração (ADR-0006).
6. **Passos de projecto.** Um desafio pode trazer `project` (`tutor_core::ProjectFiles`) em vez de
   `starter`/`tests`/`gabarito`: `starter` (caminho → conteúdo), `tests` ocultos, `solution` (o
   gabarito em ficheiros), `main` (aberto primeiro) e `readonly`. As regras vivem no modelo
   (`ProjectFiles::check`, `learner_tree`): caminhos relativos seguros, `main`/`solution`
   editáveis, testes separados dos ficheiros iniciais, limites (64 ficheiros, 256 KiB cada, 2 MiB).
   Na avaliação, só se aceitam ficheiros editáveis; os que faltam ficam como no início e os só de
   leitura com a cópia do curso. O descritor escreve a árvore e os testes numa pasta nova
   (`create_new`, pastas verificadas dentro da pasta de trabalho) e corre o seu
   `project_test_cmd` (o do Python: `unittest discover`). `submit_step` ganhou `files`; a forma
   `code` continua (num projecto, é o ficheiro principal). `dxt plugin test`: a solução passa e os
   ficheiros iniciais falham. Os testes e a solução nunca vão para o webview; a solução em
   ficheiros só depois de passar.
7. **Prova sem curso real:** um plugin-fixture só de testes
   (`crates/tutor-plugins/tests/fixtures/framework-project`, categoria `framework`, um projecto
   Python em dois módulos) atravessa `dxt plugin test`, `submit_step` (fachada `study`, com o
   registo de plugins real) e a UI (`ui-app/tests/learn.frameworks.test.ts`).

### Fica para as fases seguintes (pontos de extensão deixados)

- **Endurecimento do contentor** (memória, pids, `cap-drop`, só leitura) no `ContainerSpec`.
- **Imagens de curso** (Django, Odoo com PostgreSQL, Dxjs com o `cdn` vendido, Rust com registo
  e `target` aquecidos) e tempos maiores: o descritor já tem `image`, `network`,
  `container_timeout_secs`; um descritor de framework (ex. `django`) declara o seu
  `project_test_cmd`.
- **A sandbox das ferramentas** (Docker/Podman aninhados, kind sobre Podman rootless com um
  `KUBECONFIG` próprio, Delonix) e os seus avaliadores.
- **Os 8 cursos**, cada um com `dxt plugin test courses/<id>` a 0 falhas antes de entrar.
- Um passo de projecto que crie ficheiros novos (hoje o passo traz todos os ficheiros) e passos
  de projecto nas outras linguagens (falta-lhes o `project_test_cmd`).
- O `dxt plugin test` dizer as versões das ferramentas usadas (auditoria, ponto 5).

