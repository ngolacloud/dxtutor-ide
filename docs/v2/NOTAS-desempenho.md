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

## A seguir

- **P2 — memória e I/O ao abrir uma pasta:** o conteúdo de todos os ficheiros (até 4000 × 768 KB) vai para a página
  numa só transferência (a página: ~400 MB e 1,6 s de JavaScript no arranque); o JavaScript é um pacote só (> 500 KB).
  Ler o conteúdo quando o ficheiro abre; carregar à parte as features raras.
- **P3 — vigilância:** um passo do auto-teste com a sonda, que falha acima de limites (bloqueio da thread da UI, CPU em
  repouso, memória).
