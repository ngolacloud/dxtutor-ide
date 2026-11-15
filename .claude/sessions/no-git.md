# Sessão: migrar o backend do dxtutor para o dxtutor-ide

## Objectivo

Trazer as funcionalidades do dxtutor (crates tutor-* e os ~129 comandos Tauri do
desktop original) para o dxtutor-ide, reorganizando o projecto segundo as boas
práticas Tauri 2 + Rust (workspace Cargo) com scaffold TS (Vite) para
componentes reutilizáveis — sem quebrar a UI v7 actual que embarca de `ui/`.

## Done when

- [ ] `cargo build` passa com o workspace a incluir os crates tutor-core,
      tutor-eval, tutor-llm, tutor-track e tutor-board, e o app expõe a união
      das superfícies de comandos (origem + os 18 locais: pair, vsix, llm_chat…),
      mantendo as implementações locais nos comandos que colidem.
- [ ] `tauri dev` continua a abrir a UI v7 actual (frontendDist `../ui`), e o
      scaffold TS/Vite dos componentes compila (`npm run build:components` ou
      equivalente) sem alterar o que embarca.
- [ ] `cargo test` do workspace passa (testes dos crates migrados + do app).

## Fora de âmbito

- Renomear o projecto para «delonix-ide» (decisão do utilizador, sessão própria).
- Reescrever a UI v7 em componentes TS (a componentização é incremental, em
  sessões futuras; aqui fica só o scaffold).
- Religar na UI v7 as superfícies que na própria origem ainda correm o
  protótipo (LSP, Debug, Remote/devcontainers, Explain/CodeMap na interface).
- Publicação/instaladores (`tauri build` de release) e CI.
