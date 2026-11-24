# ADR-0007 — Studio de arquitectura de sistema

- **Estado:** aceite (2026-11-24), implementado nas fases F0–F7.
- **Contexto de origem:** pedido para o Studio conseguir desenhar os diagramas de
  arquitectura interna do Delonix e do Seiva, tomando como referência visual a imagem
  «Docker vs Kubernetes» (painéis comparativos, fronteiras tracejadas aninhadas, cartões
  com ícone, setas com protocolo).

## Contexto

O modelo `tutor_eval::arch` só descrevia desenho orientado a eventos (service, store,
broker, consumer, relay, gateway) e o canvas que o usava vivia no `ui-next`, removido em
`e2a89b3`. O Studio do `ui-app` (`features/studio.ts`) é outra coisa: o catálogo cloud que
alimenta os geradores e o «Generate backlog», com `@ts-nocheck` e um desenho de
demonstração. Nenhuma UI chamava `arch_validate`.

## Decisão

1. **Feature nova e tipada, `ui-app/src/features/arch/`**, separada do Studio cloud
   (separador «Architecture», menu Project e paleta). Camadas da ADR-0002, governada por
   A7/A8, sem `@ts-nocheck` e sem globais novas no `window` (quem abre importa `openArch`).
2. **O modelo e as regras ficam no Rust.** `arch.rs` ganha os Kind de sistema (cli,
   process, daemon, runtime, socket, state, kernel, external, client, worker, port,
   adapter), `groups` aninháveis, `views` (até dois painéis), e nas setas `label`,
   `protocol`, `style`; `relation` passa a opcional. Regras novas: `group-cycle`,
   `group-unknown-parent`, `component-in-unknown-group`, `view-unknown-group`,
   `edge-crosses-panel`, `daemonless-claim` e `unconfirmed-element`. As regras de eventos
   só olham para os Kind de eventos. Retrocompatível: um desenho antigo entra e sai
   byte-idêntico e gera o mesmo scaffold; o scaffold ignora os Kind de sistema.
3. **A verdade do diagrama faz parte do modelo:** `source` em componentes, grupos e setas;
   um painel `strict` avisa por cada caixa ou seta sem fonte.
4. **Mermaid no Rust (`arch::mermaid`)**, nunca no cliente: exporta `graph TB` normal e
   guarda em linhas `%% dxt:` o que a sintaxe não tem, para a ida e volta ser exacta;
   importa graph/flowchart com subgraph, as formas e os rótulos habituais. Comandos
   `arch_export_mermaid` e `arch_import_mermaid`.
5. **Geometria, encaminhamento e auto-layout no domínio TypeScript, sem dependências**
   (elkjs foi recusado: mais de 1 MB para diagramas desta dimensão). Setas rectas quando
   não tocam em nada; senão ortogonais numa grelha esparsa (Dijkstra com penalização por
   curva), com saída e entrada perpendiculares à borda e as pílulas dos grupos como
   obstáculos. Rótulos em espaço livre. Auto-layout por camadas, recursivo por grupo.
6. **Exportações:** SVG autónomo (o mesmo do canvas, com as cores do tema resolvidas), PNG
   a 2×, Mermaid e o ficheiro do desenho (`.arch.json`, modelo + posições). No desktop vão
   para `docs/architecture/` no projecto, com confirmação, pelo comando novo
   `arch_save_export` (só dentro da pasta, só svg/png/mmd/md/json); no browser, download.
7. **O agente do Co-Dev propõe, o humano decide.** Ferramenta `arch_propose` (só leitura):
   valida com as regras do Studio, devolve os achados ao modelo e entrega a proposta à UI
   (`arch://proposal`). A proposta aparece por cima do desenho actual, que só muda com
   «Accept». Entra no conjunto de ferramentas versão 4, para as sessões gravadas antes
   retomarem com o prefixo intacto.

## Consequências

- **162 comandos Tauri** (3 novos em `commands/agent.rs`) e 16 eventos; IPC-MATRIX e
  `arch-check` actualizados.
- As posições são estado de cliente (localStorage por raiz, chave do Studio original
  `dxnext-studio:<raiz>`, e o `.arch.json`); o modelo enviado ao backend não as tem.
- A rede de segurança é `crates/tutor-eval` (regras, round-trip Mermaid, os três diagramas
  `graph` do ARCHITECTURE.md do Delonix como fixtures), `src-tauri` (confinamento das
  exportações, `arch_propose`, versão 4) e `ui-app/tests/arch.*.test.ts` + os e2e
  `arch*.e2e.ts`. O e2e `arch-recreate` recria a referência só pela UI e verifica que
  nenhuma seta atravessa um cartão.

## Limites conhecidos

- As setas podem cruzar-se entre si (o guia só proíbe atravessar cartões). Num desenho
  arrumado automaticamente, setas longas (ex.: plano de controlo → nós) e o caminho dos
  pedidos do cliente podem ficar longe do que servem — a revisão da referência apontou-o.
- Não há «desfazer»: o «⇅ Arrange» e o import pedem confirmação.
- Uma proposta do agente vive só em memória até ser aceite.
- No browser não há validação, scaffold nem Mermaid (precisam do backend); o Studio diz-o.
