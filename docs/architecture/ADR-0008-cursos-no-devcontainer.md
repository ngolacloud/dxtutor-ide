# ADR-0008 — Os cursos correm no devcontainer do curso, não na IDE

- **Estado:** aceite (2026-11-28). F1 implementada; F2–F4 por fazer.
- **Substitui em parte:** o ADR-0005 (onde e como se avalia um curso). Os plugins de curso continuam a
  ser dados num repositório `ngolacloud/dxtutor-course-<id>`; muda quem os corre.

## Contexto

Hoje o binário da IDE traz, além do editor e do LSP:

- o texto de 18 cursos, embutido com `include_str!` (`tutor_core::course`), e ficheiros de apoio vendorizados
  (o `dxjs.js` e um bundle do happy-dom, no curso Dxjs);
- um avaliador por linguagem (`tutor_eval::plugin`, `runner`, `go_runner`, `js_runner`), que corre os compiladores
  e intérpretes **da máquina do aluno**;
- os avaliadores dos cursos de ferramentas (`tool_runner`, `container_check`, `odoo_check`);
- ambientes próprios: a sandbox Podman sem root (`tutor_eval::sandbox`) e o cluster kind (`kindbox`);
- as caches preparadas de cargo, pip e imagens (`course_cache`);
- a avaliação simulada de Rust e Go no browser, com o JSON dos cursos gerado para a UI.

Cada tecnologia nova de um curso era código novo na IDE e uma ferramenta nova na máquina de quem estuda. A IDE
crescia com toolchains e runtimes que nada têm a ver com editar código.

## Decisão (do dono, 2026-11-28)

1. **O executor é o devcontainer do curso, e só ele.** A avaliação nunca corre no processo da IDE. A máquina precisa
   de um runtime de contentores; as ferramentas do curso (compiladores, delonix, kubectl, node com o dxjs, …) vêm
   instaladas na imagem do devcontainer, montada no setup do curso.
2. **Nenhum curso embutido** no binário: nem o texto, nem os testes ocultos, nem os ficheiros de apoio. Os cursos
   instalam-se dos repositórios oficiais (ou de outro repositório, como hoje).
3. **A sandbox Podman própria e o cluster kind saem da IDE.** Os cursos de contentores exigem o delonix instalado, ou
   correm no devcontainer; o setup do curso verifica-o e diz o que falta.
4. **O browser não avalia.** Sai a avaliação simulada e o JSON gerado dos cursos.
5. A IDE fica com a UI do Learning Track, a instalação dos cursos e o LSP (que corre no anfitrião: editar não precisa
   do contentor).

## O contrato

### O repositório do curso

```text
dxtutor-plugin.json            o manifesto (como hoje)
courses/<id>.toml              o curso, com os testes ocultos (como hoje)
support/…                      ficheiros de apoio (como hoje; deixam de ser embutidos)
.devcontainer/devcontainer.json  "build": { "dockerfile": "Containerfile" }
.devcontainer/Containerfile    a imagem do curso, com as bases fixadas por digest
```

O `Containerfile` instala as ferramentas do curso com versões fixadas e traz o avaliador:

```dockerfile
FROM docker.io/library/python:3.12-slim-bookworm@sha256:…
COPY --from=ghcr.io/ngolacloud/dxtutor-grade:0.7.0@sha256:… /dxtutor-grade /usr/local/bin/dxtutor-grade
USER 1000
```

**Porque `COPY --from` e não uma *devcontainer feature*:** o motor de devcontainers da IDE
(`src-tauri/src/devcontainer.rs`) só conhece `image` e `build.dockerfile`, não features. Um `COPY --from` fica fixado
por digest e funciona igual no podman, no docker, no delonix e no CLI `devcontainer`.

As dependências de um curso (crates, rodas pip, pacotes npm, imagens) passam a ser instaladas na imagem quando ela é
construída. O `[build] prepare` e a cache preparada (`course_cache`) deixam de ser precisos (F3): preparar o curso é
construir a imagem.

### O avaliador: `dxtutor-grade` (crate `tutor-grade`)

Lê um pedido no stdin e escreve um relatório no stdout, os dois em JSON (`tutor_core::grade`, protocolo 1):

```json
{"protocol":1,"step":"ch1-greet","language":"python","submission":{"kind":"code","code":"…"}}
{"protocol":1,"step":"p1","submission":{"kind":"files","files":{"src/app.py":"…"}}}
```

```json
{"protocol":1,"step":"ch1-greet","course":"python-basics","outcome":"passed",
 "correctness":{"passed":true,"summary":"…","raw":"…"},"grader":"dxtutor-grade 0.7.0"}
```

- `outcome` é `passed`, `failed` (os testes correram; `correctness.raw` diz o que falhou) ou `error` (não houve
  avaliação; `error.code` é um de `tutor_core::grade::codes`: `BAD_REQUEST`, `PROTOCOL`, `COURSE_INVALID`,
  `STEP_NOT_FOUND`, `NOT_A_CHALLENGE`, `NOT_A_PROJECT`, `LANGUAGE_UNSUPPORTED`, `COURSE_NOT_PREPARED`,
  `LIVE_UNAVAILABLE`, `EVAL`).
- Um lado que recebe outro número de protocolo recusa com `PROTOCOL` antes de ler o resto.
- **O relatório nunca traz a solução.** A IDE tem o curso instalado e só a mostra depois de os testes passarem: o
  contrato de honestidade continua do lado dela.
- A IDE recusa um relatório incoerente (`passed` com testes que falharam, `error` sem erro, …).
- Saída 0: avaliado (passou ou falhou). Saída 3: relatório de erro. Saída 2: argumentos errados, sem relatório.
- O avaliador procura o passo, constrói o `Phase` com os ficheiros de apoio e avalia-o com o mesmo motor de sempre
  (`tutor_eval::assess`/`assess_project`), com o motor `Host`: já está no contentor e nunca lança outro.

### A imagem do avaliador

`ghcr.io/ngolacloud/dxtutor-grade:<versão>` tem só o binário estático (musl, `FROM scratch`, `grader/Containerfile`),
para entrar em qualquer imagem de curso (Debian, Alpine, distroless). O `.github/workflows/grader-image.yml` compila-o,
constrói a imagem e prova-a em cada PR que lhe toca — numa imagem de curso (`grader/smoke/`) corrida com as opções
abaixo, a solução do curso de Python passa e o início falha — e publica-a numa tag `grader-v<versão>` (a versão do
crate; nunca `latest`, nunca substitui uma versão publicada), com a atestação da proveniência e o digest no resumo.
Só `linux/amd64` por agora.

Para o binário ser estático, o keychain do `tutor-protect` passou a uma feature (`keychain`, ligada por omissão):
o `tutor-eval` usa-o sem ela, e o avaliador nunca guarda um segredo.

### Como a IDE o corre (F2)

- `run --rm -i --network none` da imagem do devcontainer, e não um `exec` no devcontainer em uso: um `exec` não
  consegue desligar a rede, e o código do aluno não deve ter rede nem deixar nada para a avaliação seguinte.
- O curso montado **só de leitura** em `/dxtutor/course`. Nada da pasta do aluno é montado: os ficheiros entregues vão
  dentro do pedido.
- Raiz só de leitura (`--read-only`) com um `/tmp` em memória **executável** (`--tmpfs /tmp:rw,exec,nosuid`: o
  `--tmpfs` do docker é `noexec` por omissão, e os cursos que compilam correm o binário lá); limites de memória,
  processos e CPU, `--cap-drop=ALL`, `no-new-privileges`, utilizador sem root, e o tempo limite do lado da IDE
  (mata o contentor).
- O setup do curso: verificar o runtime (podman, docker ou delonix) e dizer o que falta; construir a imagem — a
  **única ida à rede**, aprovada e auditada como o «Prepare course» de hoje; confirmar que a imagem responde a
  `dxtutor-grade --protocol` com o número que a IDE fala.

### Pontos que ficam para a F3

- **Contentores dentro do contentor** (cursos de Docker, Podman e Kubernetes ao vivo): *docker-in-docker* privilegiado
  no devcontainer, ou o runtime do anfitrião (o delonix instalado) a correr os contentores de prática ao lado. Decide o
  que «o delonix tem de estar instalado» quer dizer, e fica decidido antes de migrar esses cursos.
- **Odoo Enterprise:** a cópia do aluno entra numa segunda montagem só de leitura; nunca na imagem nem no repositório.

## Fases

| Fase | O quê | Estado |
|---|---|---|
| F1 | Este ADR; o contrato (`tutor_core::grade`); o avaliador `dxtutor-grade` (`crates/tutor-grade`); `tutor_plugins::load_dir` (ler um curso de uma pasta com erros explícitos) | feito |
| F2 | A imagem do avaliador (`ghcr.io/ngolacloud/dxtutor-grade`, feita); na IDE, o setup do curso e a avaliação por contentor, ao lado do caminho actual; o curso de Python migrado de ponta a ponta | por fazer |
| F3 | Os outros cursos migrados (devcontainer + dependências na imagem) e republicados com versão major nova; o `dxt plugin test` a correr no devcontainer, o que serve de CI aos repositórios dos cursos | por fazer |
| F4 | Remover da IDE: os `include_str!` dos cursos, os avaliadores por linguagem, `tool_runner`, `sandbox`, `kindbox`, `container_check`, `odoo_check`, `course_cache`, o JSON da UI, o `sync-ui-courses.py` e a avaliação no browser (antes, confirmar que nada fora dos cursos usa os runners de Rust, Go e JS) | por fazer |

Durante a transição, as regras de procura do passo vivem em dois sítios: `tutor_grade::grade` e o `study::grade_in`
da IDE. A F4 apaga o segundo.

## Consequências

- **A favor:** a IDE deixa de carregar toolchains e runtimes de cada curso; um curso avalia-se igual em qualquer
  máquina e no CI do seu repositório; uma tecnologia nova num curso é uma linha no `Containerfile`, não código na IDE;
  o código do aluno corre sem rede num contentor descartável.
- **Contra:** sem runtime de contentores não há avaliação (o setup diz o que instalar); a primeira preparação de um
  curso descarrega a imagem (centenas de MB); o browser deixa de avaliar.
