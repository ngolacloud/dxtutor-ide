# Desempenho do dxtutor-ide — notas medidas

Objectivo (do dono, 2026-11-26): o IDE é leve, rápido e seguro, e nunca trava a máquina. Cada mudança traz o antes e
o depois, medidos da mesma forma.

## Como se mede

`sample.py` (a sonda usada nestas notas) amostra de 50 em 50 ms a thread principal da app e a do `WebKitWebProcess`:
livre (à espera de eventos em `poll`) ou ocupada (a correr, ou bloqueada noutra coisa — `futex`, `fsync` com
`jbd2_log_wait_commit`…), e regista a memória (RSS) e o CPU. A app abre, num ecrã virtual (Xvfb) com um HOME novo, um
clone local deste repositório (1134 ficheiros, 22 MB). Para saber quem faz um `fsync`: `strace -f -k -e trace=fsync`.

## P1 — a thread da UI nunca espera (2026-11-26)

A captura do dono: «not responding» no arranque, com a máquina carregada (carga 11–13, outras sessões a compilar).

| Thread principal da app (binário debug) | Antes | Depois |
|---|---|---|
| Espera por `fsync` do SQLite | 0,65 s aos 3,8 s (92 `fsync` em rajada) | nenhuma |
| Maior bloqueio com a janela aberta | 0,65 s | 0,12 s |
| Arranque do GTK/WebKit (antes da janela) | 0,65 s | 0,5 s |
| CPU em repouso (app / página) | 0,2 % / 0,4 % | 0,1 % / 0,1 % |
| Memória (app / página) | 278 / 396 MB | 292 / 402 MB |

Causas e correcções:
- **SQLite em journal clássico:** dois `fsync` por commit, numa ligação nova por comando com a verificação das
  migrações. → WAL, `synchronous=NORMAL`, `busy_timeout` de 5 s, migrações uma vez por processo
  (`tutor_board::project::tune`; teste `tests/sqlite_tuning.rs`).
- **128 comandos síncronos** (correm na thread da UI), ~40 com I/O. → 94 passaram a `async`; ficam 32, da lista
  `SYNC_ALLOW` (A10 do `arch-check`): os que dependem da ordem de chegada e os puros.
- **`keys_status` síncrono no arranque**, antes de a pasta abrir: até ~16 leituras do keychain por D-Bus (5–40 ms cada;
  até 25 s se o Secret Service não responder). → `async`; a configuração antiga só é lida para quem lá tem campo.
- **O ambiente da shell de login** (`bash -ilc env`, 0,4 s; segundos com carga) era pago pelo primeiro comando que o
  pedisse. → aquecido numa thread no arranque.

## P2 — o que uma pasta custa à página (2026-11-26)

Medida nova: a memória PRIVADA de cada processo (`/proc/<pid>/smaps_rollup`, páginas privadas), porque o RSS conta as
bibliotecas do WebKit partilhadas com o resto do sistema. 70 s depois de abrir, binário debug, Xvfb, HOME novo. Entre
corridas iguais há ±20 MB de ruído.

| Página (privada) | Antes | Depois |
|---|---|---|
| Sem pasta | 205 MB | 226 MB (ruído) |
| Este repositório (1113 ficheiros, 16 MB de texto) | 246 MB | 273 MB (ruído: nada é ignorado) |
| Projecto com um `out/` gerado e ignorado (1500 ficheiros, 150 MB) | **358 MB** | **233 MB** |

A página guarda tanto quanto recebe (~1 MB por MB de texto), e o limite era 4000 × 768 KB = 3 GB. Correcções
(`src-tauri/src/workspace.rs`, `LoadPolicy`):
- **As pastas que o git ignora por inteiro não se carregam** (`git ls-files --others --ignored --exclude-standard
  --directory`): build, caches, coverage. O `--directory` só junta uma pasta quando nada nela está versionado, por isso um
  ficheiro versionado nunca desaparece; um ficheiro ignorado solto (o `.env`) continua no editor. Sem repositório ou sem
  git, nada muda.
- **Tecto de 48 MB no total**, além dos 4000 ficheiros de 768 KB: atingido, o resto não se carrega e a abertura di-lo
  («load limit reached»), como o limite de ficheiros.
- **O HEAD dos ficheiros alterados num processo** (`platform/desktop/git-batch.ts`): o `markChanged` pedia um `git show`
  por ficheiro, em série; agora um `git cat-file --batch`. Os tamanhos da resposta são em bytes e o `exec` devolve
  texto: se não baterem (um blob binário), volta ao `git show` por ficheiro.
- **O auto-teste (85 KB) é um chunk à parte**, carregado só com `DXTUTOR_SELFTEST` — o primeiro `import()` dinâmico da
  app (o CSP `script-src 'self'` aceita-o; o auto-teste prova-o ao arrancar).

Medido e deixado como está: o arranque da página em Chromium (perfil do CDP, mapeado pelo sourcemap) gasta ~600 ms de
JavaScript, o mais pesado a `show()` dos separadores (`innerHTML` + layout forçado, 160 ms), o xterm (50 ms) e os cursos
Rust/Go embutidos como literais (~700 KB, ~35 ms). Os ~2 s ocupados no WebKit são sobretudo desenho por software no Xvfb
(sem GPU). Partir mais o pacote dá pouco: o JavaScriptCore guarda o código-fonte de qualquer forma, e o `COURSES` do
Learning Track é lido de forma síncrona.

## A seguir

- **P3 — vigilância:** um passo do auto-teste com a sonda, que falha acima de limites (bloqueio da thread da UI, CPU em
  repouso, memória privada da página com uma pasta pesada).
- Por medir: a app cresce ~40 MB privados ao abrir este repositório (não é o `load_workspace`: a pasta de 150 MB só
  junta ~9 MB).
