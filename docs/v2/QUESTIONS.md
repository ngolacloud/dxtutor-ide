# Perguntas em aberto (Parte A)

Decisões que são do dono. Cada uma indica o que fica bloqueado e a recomendação.

**Q1 · ~~Onde estão os documentos de backend?~~ — respondida (2026-11-24).**
O dono pediu que eu escrevesse o contrato: `docs/v2/RF-CODEV-STREAM.md`. Falta a aprovação dele antes da
A2, e as decisões abertas D1–D4 desse documento (mudança do modo Assistido, Auto sem validação, crate de
diff, retirar o caminho `liveChat`).

**Q2 · ~~Ordem das fases~~ — respondida (2026-11-24).**
Segue a ordem da auditoria: A0.5 (base honesta) → A2 → A5 → A1 → A3 → A6/A4 → A7/A8/A9/A10.

**Q3 · Remover as simulações existentes? — o backlog respondido (2026-11-26).**
Missões guionadas, "conselho de modelos", Debug assistant guionado, métricas PRNG do Infra/Observe e o
painel Testing por regex contrariam "nada de demo data". Recomendação: removê-los fase a fase, à medida
que a versão real de cada um entra, e nunca deixar um ecrã vazio sem explicar porquê.

Decisão do dono para os dois backlogs (o quadro Tasks antigo, `tasks.sqlite3`, e o Project,
`board.sqlite3`): **juntam-se no Project.** Cada item do backlog pertence a um projecto (nunca solto),
cada issue fica ligada aos ficheiros e commits em que mexe, e o Co-Dev, ao trabalhar uma issue, sabe os
seus componentes, ficheiros e commits. Por fases, um PR cada:
1. **Feita (este PR).** Nada de issues soltas: «Nova issue» e «Gerar backlog» recusam sem pasta de projecto
   aberta (e dizem-no), e o `board_load`/`board_save` já não têm um backlog `"default"` sem pasta. O prompt
   da issue (`project_issue_prompt`) ganha o bloco «Ligações da issue»: ramo, épico, componente (lugar
   reservado), dependências com título e estado, os commits ligados (sha + assunto, os 8 mais recentes) e
   os ficheiros já alterados nos change sets da issue — listas com tecto, sem diffs. O `persist.ts` do
   quadro deixa de perder `role`/`soThat`/`acceptance`/`prompt`.
2. Ligação automática dos commits: a chave tirada do nome do ramo (`feature/DXT-12-…`) e depois de cada
   commit da app (hoje só pelo «Sync commits», que lê o assunto).
3. Os ficheiros de cada issue a partir dos diffs reais dos commits ligados, e os resultados dos testes por
   issue.
4. A coluna «componente» na issue, vinda do nó do Studio.
5. Um só backlog: o quadro Tasks passa a ser uma vista sobre o Project; sai o `tasks.sqlite3` e os comandos
   `board_load`/`board_save` (actualizar a `IPC-MATRIX.md` e os A1–A3 do `arch-check`).

As outras simulações continuam como recomendado acima.

**Q4 · ~~Goldens~~ — respondida (2026-11-24).**
Em cada fase listo os goldens afectados com o diff, e só regenero com o "sim" do dono. Primeira aplicação:
o dono aprovou os 8 goldens da A0.5 (visualizer e Under the hood sem as frases "The desktop app traces
real binaries." e "The desktop app adds measured CPU, memory and I/O from a real run.").

**Q5 · Debug: DAP substitui o driver gdb/MI3?**
Recomendação: cliente DAP único (CodeLLDB/lldb-dap, debugpy, Delve, js-debug, java-debug); o gdb/MI3
fica só como fallback para C/C++ sem lldb, ou sai.

**Q6 · Desenhos dos Studios: ficheiro do projecto ou SQLite?**
Hoje estão em localStorage. Recomendação: `.dxtutor/` no projecto (versionado com o código, partilhado
pela equipa); SQLite só para dados da instalação (histórico de testes, sessões de debug, quadro).

**Q7 · ~~Quadro: projecto em SQLite local ou ficheiro versionado?~~ — resolvida por omissão (2026-11-24), reversível.**
O dono mandou seguir para a A5 sem responder; aplicou-se a recomendação abaixo: o Project vive em SQLite
local (`app_local_data_dir/board.sqlite3`, `tutor_board::project`, com migrações). A exportação/importação
para `.dxtutor/board.json` fica para depois.

Texto original:
Uma equipa a trabalhar no mesmo repo não partilha um SQLite local. Recomendação: SQLite local agora
(o `tutor-board` já existe), com exportação/importação para `.dxtutor/board.json` e sincronização como
passo futuro. Confirmar.

**Q8 · ~~Nome do produto nos textos~~ — respondida (2026-11-24): `dxtutor-ide`.**
O prompt e o protótipo dizem "delonix-ide"; a app e o código dizem "dxtutor IDE". O dono decidiu
`dxtutor-ide`: onde um prompt ou RF disser `delonix` (pasta `.delonix/`, trailers), usa-se `dxtutor`.
