# dxtutor IDE — desktop (Tauri 2 + Rust)

A aplicação desktop do protótipo dxtutor IDE (v7). A interface é a mesma do protótipo; aqui as partes que no browser eram simuladas passam a ser reais: pastas no disco, terminal, git, modelos de LLM, Docker/Podman e Kubernetes.

## Pré-requisitos

| Sistema | O que instalar |
|---|---|
| Todos | [Rust](https://rustup.rs) estável, Node.js 20+ e git |
| Linux (Debian/Ubuntu) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev patchelf` |
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Windows | Microsoft C++ Build Tools e WebView2 (já vem no Windows 11) |

Opcional, para as funções de infra: `docker` (ou `podman`) com compose, `kubectl`, e `kind`/`minikube`/`k3d` se o cluster for local.

## Correr

```bash
npm install
npm run dev        # abre a aplicação em modo de desenvolvimento
npm run build      # gera o instalador em target/release/bundle/
npm test           # testes da UI (vitest) + backend Rust (cargo test --workspace)
npm run ui:test    # só os testes da UI
npm run lint       # ESLint: estrito nos domínios (features/*/domain), avisos no código legado
npm run format     # Prettier no código novo
npm run arch:check # fronteiras de arquitectura e matriz IPC
```

Por ser um workspace Cargo, os artefactos saem em `<raiz>/target/` (um só
`target/` para toda a app); ignora o `src-tauri/target/` órfão.

Para abrir logo uma pasta: `target/debug/dxtutor-ide /caminho/do/projecto`.
A última pasta aberta é reaberta no arranque seguinte.

## Chaves dos modelos

Em **Definições → Modelos e provedores**, cola a chave no campo de cada provedor e usa **Test connection**.
As chaves ficam em `keys.json` na pasta de configuração da aplicação (só legível pelo teu utilizador) e nunca passam pela interface depois de guardadas. Em alternativa, a aplicação lê as variáveis de ambiente:

| Provedor | Variável | Formato da API |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` | Anthropic Messages |
| Codex / OpenAI | `OPENAI_API_KEY` | OpenAI Chat Completions |
| Gemini | `GEMINI_API_KEY` | endpoint compatível com OpenAI da Google |
| Ollama | — (local, `http://localhost:11434`) | OpenAI Chat Completions |

O modelo e o endpoint de cada provedor editam-se nas Definições (por omissão: `claude-opus-5-5`, `gpt-4.1`, `gemini-2.5-flash`, `qwen2.5-coder:14b`).

## O que é real e o que continua a ser protótipo

**Real no desktop**
- **Pastas**: *File → Open Folder…* (Ctrl+O), pastas recentes, *Close Folder*. Ignora `.git`, `node_modules`, `target`, `dist`, etc.; carrega até 4000 ficheiros de texto até 768 KB.
- **Auto Save** para o disco; criar, renomear e apagar ficheiros reflecte-se no disco. Os caminhos nunca saem da pasta aberta.
- **Terminal**: shell real na pasta do projecto, saída em tempo real, `cd`, Ctrl+C para parar.
- **Git**: o grafo, os ramos e as tags vêm do repositório; commit, checkout, merge e o gitflow (feature/release/hotfix, com tag na release) correm `git` de verdade. Num conflito, o merge é abortado e o IDE diz como resolver no terminal. Pastas sem git oferecem `git init`.
- **Co-Dev ao vivo** com Claude, Codex, Gemini ou Ollama (o que estiver seleccionado e configurado), com ferramentas para ler e escrever ficheiros e uma ferramenta `run_command` que corre comandos na pasta. Nos modos Manual e Assistido cada comando pede aprovação; comandos destrutivos (`git push`, `rm -rf`, `--force`…) pedem sempre.
- **Infra**: *Connect* testa o socket do Docker/Podman/Delonix e o `KUBECONFIG` com `docker info` e `kubectl`; os contextos vêm do kubeconfig real.
- **RUN** (Ctrl+F5) corre `docker compose up --build -d` e mostra os serviços reais; **Stop** corre `compose down`.
- **Deploy** constrói as imagens, carrega-as no cluster local (kind/minikube/k3d), aplica `deploy/k8s` e espera pelos rollouts.
- **Logs**: na vista de observabilidade, *Stream in terminal* segue os logs reais (`compose logs -f` ou `kubectl logs -f`).
- **Extensões VSIX**: o JSZip vem com a aplicação, por isso instalar um `.vsix` funciona offline.

**Continua a ser protótipo (modelado no browser)**
- As missões guionadas, o conselho de modelos com juiz e as execuções de sprint. Com uma pasta real aberta ficam bloqueadas, para não escreverem código de demonstração no teu repositório; funcionam no workspace de exemplo (*Close Folder*).
- As métricas e gráficos da observabilidade, a narração do Debug assistant, o modelo do *Visualize execution* e as verificações do Learning Track.
- O indicador de testes da barra de estado e o `/test` e `/lint` do chat referem-se ao projecto de exemplo.

## PairCode (pair programming XP)

*Pair → host a session* (Ctrl+Alt+P) gera um token `dxp_…` para enviar ao outro developer; ele faz *Pair → join with a token* e cola-o.

- **Workspace remoto**: o convidado vê o projecto do anfitrião em tempo real. A pasta dele fica guardada à parte e volta quando sai da sessão.
- **Driver e navigator**: um conduz (escreve no editor e no terminal partilhado), o outro segue o ficheiro aberto, o scroll e o cursor do driver, com o editor só de leitura. *Follow* desliga o seguimento para explorar à vontade.
- **Passar o comando**: o navigator carrega em *Request control*; o driver recebe o pedido e escolhe *Give control* ou *Not now*. O driver também pode dar o controlo por iniciativa própria, e o anfitrião pode retomá-lo (*Take back*), porque a máquina é dele.
- **O anfitrião é a fonte de verdade**: as edições do convidado são gravadas no disco do anfitrião. O terminal partilhado corre na máquina do anfitrião. O git fica com o anfitrião: o convidado usa-o pelo terminal partilhado quando conduz.
- **Videochamada**: abre ao ligar, numa janela pequena que se arrasta, com a câmara do outro, a tua em miniatura, e botões para mic, câmara, controlo e sair. Usa WebRTC quando os dois lados o têm (Windows, macOS). O WebKitGTK da maioria das distribuições Linux vem sem WebRTC; aí a chamada passa pelo próprio canal do PairCode (vídeo JPEG a 8 fps e áudio de 16 kHz), o que chega numa rede local ou VPN mas gasta mais rede. O selo **relay** na janela indica esse modo.
- **Segurança**: o token traz os endereços do anfitrião, a porta (47821 por omissão) e uma chave de 256 bits gerada para a sessão. Todo o tráfego, incluindo a sinalização da chamada, vai cifrado com ChaCha20-Poly1305 com essa chave; quem não tiver o token não entra nem lê nada. Um convidado de cada vez. Trata o token como uma palavra-passe.
- **Rede**: as duas máquinas têm de se ver, seja na mesma rede ou numa VPN como Tailscale ou WireGuard. Pela internet sem VPN, o anfitrião abre a porta TCP no router e o convidado preenche o campo *via* com `endereço:porta`. Ainda não há um servidor de relay público.
- **Câmara e microfone**: o macOS pede autorização na primeira chamada (texto em `src-tauri/Info.plist`); no Linux a aplicação liga a câmara e o microfone no WebKitGTK.

## Estrutura

O repositório é um workspace Cargo: o «cérebro» dxtutor (crates `tutor-*`) +
a casca desktop Tauri. **A UI oficial e activa é o `ui-app/`** (ver
`docs/architecture/ADR-0001-ui-app-oficial.md`) — o protótipo v7
componentizado em módulos TypeScript (Vite): `npm run ui:build` compila com
`tsc` e empacota para `ui-app/dist`, que o Tauri embute (`frontendDist`).

As pastas `ui/` e `ui-next/` são referências históricas/experimentais, fora do
grafo de build activo; não as alterar como se fossem a UI de produção. As
regras de manutenção estão em `AGENTS.md` e a arquitectura em
`docs/architecture/`.

```
crates/
  tutor-core           modelo de domínio + currículo (competências/CS2023/labs)
  tutor-eval           avaliador (testes isolados), sonda de complexidade, review,
                       CodeMap, LSP, git (DAG + worktree isolada), arch (System Design)
  tutor-llm            fornecedores de dica/plano/correcção, chat, policy do tutor
  tutor-track          registo institucional de tentativas (SQLite)
  tutor-board          Board kanban durável por workspace (SQLite)
  tutor-tui            editor TUI (ratatui)
  tutor-cli            prova ponta-a-ponta do cérebro (dxt demo)
ui-app/index.html      interface que embarca (protótipo v7 componentizado)
ui-app/src/boot.ts     arranque: globais no window que o resto consome por nome
ui-app/src/app.ts      corpo da aplicação (painéis, editor, comandos)
ui-app/src/bridge.ts   liga a interface ao backend (só actua dentro da aplicação)
ui-app/src/pair.ts     PairCode: sessão, sincronização, controlo, chamada
ui-app/public/         estáticos servidos tal-e-qual (styles.css, jszip.min.js)
src-tauri/src/
  main.rs              entrada fina; lib.rs regista os 133 comandos IPC
  lib.rs               comandos ricos do dxtutor (estudo, git, debug, LSP, agent,
                       devcontainers, arch, board) + PairCode
  bridge.rs            comandos genéricos da v7 (workspace/exec/llm/keys/vsix)
  fsops.rs lsp.rs pty.rs debug.rs board.rs …  módulos por domínio
  pair.rs              PairCode: token, canal WebSocket cifrado, um convidado de cada vez
src-tauri/Info.plist   textos de autorização da câmara e do microfone (macOS)
scripts/selftest.sh    teste de fumo ponta a ponta
scripts/pairtest.sh    duas instâncias emparelhadas, com câmara e microfone falsos
.github/workflows/     builds para Linux, Windows e macOS (instaladores numa release em rascunho)
```

## Teste de fumo

`sh scripts/selftest.sh` (em Linux sem ecrã: `xvfb-run sh scripts/selftest.sh`) cria um repositório temporário, abre-o na aplicação, grava um ficheiro, faz um commit, corre um gitflow completo e o terminal, e imprime o relatório e o grafo resultante.

`sh scripts/pairtest.sh` abre duas instâncias na mesma máquina. Testa a entrada com o token, o modo só-leitura, o seguimento, o pedido e a aceitação de controlo, a edição do convidado gravada no disco do anfitrião, o terminal partilhado e o vídeo e áudio nos dois sentidos.

## Segurança

A CSP só permite scripts da própria aplicação; o protótipo usa scripts e handlers inline, por isso `script-src` inclui `'unsafe-inline'` e a modificação automática da CSP pelo Tauri está desligada. A interface não faz pedidos de rede: as chamadas aos modelos saem do backend Rust.

## Resolução de problemas

- **A janela abre vazia (só o fundo escuro).** Em Linux, uma cache de tipos de letra
  incompatível (`~/.cache/fontconfig`, escrita por um fontconfig mais novo, por exemplo de
  uma app Flatpak/Snap) faz o WebKitGTK bloquear antes de desenhar a página. Regenera-a:
  `mv ~/.cache/fontconfig ~/.cache/fontconfig.bak && fc-cache -r`.
- **Retomar uma conversa do Co-Dev.** Com uma pasta aberta e um provedor seleccionado,
  escreve `/retomar` no painel do Co-Dev para escolher uma conversa anterior do projecto.
  As conversas ficam em `~/.config/dxtutor/sessions/` (fora do repositório).
- **Comandos do Co-Dev (agente v2).** `/plano <pedido>` — investiga só com leitura e
  propõe um plano para aprovares antes de mexer em ficheiros; `/reverter` — repõe os
  ficheiros como estavam antes de um pedido (só em repositórios git; a conversa fica);
  `/retomar` — continua uma conversa anterior.
- **Estender o Co-Dev por projecto** (`/comandos` mostra o que existe):
  - `.dxtutor/commands/<nome>.md` — um comando `/nome`; o texto é o pedido, `$ARGUMENTS`
    recebe o resto da linha;
  - `.dxtutor/skills/<nome>/SKILL.md` — instruções especializadas (cabeçalho `name:` e
    `description:`), lidas pelo agente quando se aplicam;
  - `.dxtutor/memory/*.md` — memória do projecto, lida no início de cada conversa;
  - `.dxtutor/hooks.json` — comandos antes/depois das ferramentas e no fim do turno;
  - `.dxtutor/mcp.json` (e `~/.config/dxtutor/mcp.json`) — servidores MCP
    (`{"mcpServers": {"nome": {"command": "...", "args": [...]}}}`).
  Hooks e servidores MCP do projecto correm comandos definidos pelo repositório: só
  arrancam depois de confiares neles em `/comandos`, e voltam a pedir confiança se o
  ficheiro mudar.
- **Co-Dev com outros provedores.** O agente (ferramentas reais, permissões, checkpoints,
  `/plano`, `/reverter`, `/retomar`, hooks, MCP, skills) funciona com Claude, Codex/OpenAI,
  Gemini e Ollama — escolhe no seletor de modelo da conversa. Só o Claude tem raciocínio
  visível, compactação automática de conversas longas e fallback do servidor; a primeira
  resposta de outro provedor diz o que falta. Modelos do Ollama sem suporte a ferramentas
  (ex.: `gemma2:2b`) passam sozinhos ao modo de texto; para o agente completo usa um com
  ferramentas (`qwen2.5-coder`, `llama3.1`, `qwen3`).
- **Board → agente.** Num cartão do Board, «⚡ Agente» entrega a issue ao Co-Dev: investiga,
  propõe um plano para aprovares e implementa.
- **Voltar ao harness antigo do Co-Dev.** Na consola da página:
  `localStorage.setItem("dx2.codevLegacy", "true")` (e `removeItem` para voltar).
