---
session: f34aedf4-a955-4dc1-bfec-2f8a1f214cb4
opened: 2026-11-15T18:17:46+01:00
branch: main
status: open
---

# Objective
Migrar o backend do dxtutor (crates tutor-* e os ~129 comandos Tauri do desktop
original) para o dxtutor-ide como workspace Cargo organizado às boas práticas
Tauri 2 + Rust, com o frontend TS/Vite de referência incluído para componentes
reutilizáveis — sem quebrar a UI v7 que embarca de `ui/`.

# Done when
- [x] `cargo build` passa com o workspace (crates tutor-* + src-tauri) e o app
      regista a união dos comandos: os da origem + os locais (pair_*), mantendo
      as implementações locais onde colidem. (observado: BUILD_EXIT=0, binário
      target/debug/dxtutor-ide gerado; generate_handler com pair_* + ~130 da origem)
- [x] `cargo test` do workspace passa (crates migrados + app). (observado:
      EXIT=0, 183 passed / 0 failed)
- [ ] `tauri dev` abre a UI v7 actual (frontendDist `../ui`) com janela visível,
      e o frontend TS de referência compila sem alterar o que embarca.

# Out of scope
- Renomear o projecto para «delonix-ide» (decisão do utilizador, sessão própria).
- Reescrever a UI v7 em componentes TS (componentização incremental futura).
- Religar na UI v7 superfícies que na origem ainda correm o protótipo
  (LSP, Debug, Remote/devcontainers, Explain/CodeMap na interface).
- Instaladores de release (`tauri build`) e CI.

# Handoff
(pending)
