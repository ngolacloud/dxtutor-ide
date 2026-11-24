/* ═══════════ feature `board` — motor dos casos de uso (ADR-0002, Fase 3) ═══════════
   O runner, o CRUD e o PRODUTOR Studio→backlog, livres de `window`/DOM: todo o mundo
   exterior entra por `BoardDeps` (ver `ports.ts`), injectado na composição
   (`features/board.ts`). Importa só o domínio puro, `esc` (puro) e as portas.

   O motor constrói as STRINGS de HTML (dados) mas nunca lê/escreve o DOM — segura os
   handles opacos devolvidos por `chat.card`/`chat.tl` e devolve-os a
   `toolResult`/`cardAppend`/`cardSet`. As arestas internas decoradas (delegate→runIssue,
   runSprint→runIssue, dropIssue→approveIssue) passam por `orchestration`.

   ADR-0006, R3a: sem runner guionado. Saem os produtores de ficheiros das issues (`gen`/`fix`
   sobre os geradores de templates), os testes-predicado sobre o FS, o encaminhamento de modelo
   e as contagens de tokens inventadas, as pausas encenadas e as sub-issues «fora do escopo».
   Correr uma issue (Delegar, Sprint) é: ramo gitflow (git real) → o agente real implementa-a
   (`agent.story`, modo plano: o humano aprova o plano) → commit do que o agente mudou → os
   testes do projecto (`projectTests`) → validação funcional ou volta a desenvolvimento. Sem
   agente (browser, sem pasta, provedor sem ferramentas), di-lo e não corre. «Gerar backlog»
   cria issues simples a partir dos componentes planeados no Studio — sem código: quem as
   implementa é o agente. */

import { esc } from "../../../core";
import type { Issue, DesignNode, TechSpec } from "../domain/types";
import { slug } from "../domain/slug";
import { makeIssue } from "../domain/issue";
import { nodeStatus, sprintCounts } from "../domain/kanban";
import type { BoardDeps, BoardEngine, Host } from "./ports";

export function makeBoardEngine(deps: BoardDeps): BoardEngine {
  const { store, catalog, generators, directory, scm, runctl, chat, agent, terminal, view, notifier, nav, orchestration, copy } = deps;
  const BL = () => store.backlog();

  function mkIssue(o: Partial<Issue>): Issue { const it = makeIssue(BL().seq++, o); BL().issues.push(it); return it; }

  function openBoard(): void { nav.openTab({ id: "board", title: "Quadro", kind: "board" }); }

  function setStage(it: Issue, st: string): void {
    it.stage = st;
    if (it.node) { const n = store.design().nodes.find((x) => x.id === it.node); if (n) { n.st = nodeStatus(BL().issues, it.node); store.saveDesign(); } }
    view.rerender("board"); view.rerenderCodev();
  }

  async function autoTest(it: Issue, host: Host | null): Promise<boolean> {
    const d = host ? chat.tl(host, "auto-test", it.id + " · disparado ao entrar em Teste") : null; /* sem a pausa encenada (era `sleep(380)`, um global nunca publicado — o runner rebentava aqui; ADR-0006, R3a) */
    /* os testes do projecto (comandos detectados, a correr a sério no desktop); sem nenhum, a
       issue não passa — nada de resultados inventados (ADR-0006, R1c1/R3a) */
    const res = await terminal.projectTests(), ok = res.length > 0 && res.every((r) => r.ok), f = res.filter((r) => !r.ok).length; it.res = res;
    if (!res.length) notifier.log("auto-test", `${it.id}: sem testes — abre a pasta do projecto na app desktop (comando de testes detectado ou .dxtutor/commands.json)`);
    if (terminal.getVar("--panel-h") !== "0px") terminal.setPanelTab("terminal", true); terminal.echoCmd("dx test " + it.id); terminal.echo(`<span class="dim">running ${res.length} tests (${esc(it.branch || scm.branch())})</span>\n` + res.map((r) => `test ${r.n} ... ${r.ok ? '<span class="ok">ok</span>' : '<span class="er">FAILED</span>'}`).join("\n") + `\n\ntest result: ${ok ? '<span class="ok">ok</span>' : '<span class="er">FAILED</span>'}. ${res.length - f} passed; ${f} failed`); terminal.newInput(true);
    if (d) chat.toolResult(d, `<span class="${ok ? "okc" : "bad"}">${ok ? "✓" : "✖"} ${res.length - f}/${res.length}</span>`); notifier.log("auto-test", `${it.id}: ${res.length - f}/${res.length} ${ok ? "— passa para validação funcional" : "— volta a desenvolvimento"}`); return ok;
  }

  /** Corre uma issue com o agente real: ramo → implementação (o humano aprova o plano) →
   *  commit do que o agente mudou → testes do projecto → validação ou volta a desenvolvimento. */
  async function runIssue(it: Issue): Promise<void> {
    const ag = directory.agents()[it.agent] || { n: it.agent, col: "var(--fg-muted)", max: 0, task: "" };
    runctl.setAuthor(it.agent); runctl.label(`${it.id} · ${ag.n}`);
    const c = chat.card(ag.n.toLowerCase(), `<p><code>${it.id}</code> <b>${esc(it.title)}</b></p>`);
    if (!agent.available()) {
      chat.cardAppend(c.bd, "<p>Não há um agente disponível para implementar a issue: precisa da app desktop, com uma pasta aberta e um provedor com ferramentas (Definições).</p>");
      return;
    }
    const b = scm.gfStart(it.type === "fix" ? "fix" : "feature", it.id + "-" + slug(it.title).slice(0, 22));
    it.branch = b || null;
    if (b) chat.toolResult(chat.tl(c.tools, "gitflow", "checkout -b " + b), '<span class="okc">✓</span>');
    setStage(it, "dev");
    try {
      await scm.settle(); /* o checkout do ramo tem de acontecer ANTES de o agente escrever */
      const before = new Set(scm.changes());
      const run = agent.story({ id: it.id, title: it.title, type: it.type, pts: it.pts, note: it.note });
      if (!run) { chat.cardAppend(c.bd, "<p>O agente não aceitou o pedido.</p>"); return; }
      await run;
      await scm.settle();
      const changed = scm.changes().filter((p) => !before.has(p));
      if (!changed.length) {
        it.note = "o agente não alterou ficheiros";
        chat.cardAppend(c.bd, `<p><span class="tag">${copy("noChanges")}</span> o agente terminou sem mudar ficheiros — a issue fica em desenvolvimento.</p>`);
        return;
      }
      scm.staged().clear(); changed.forEach((p) => scm.staged().add(p));
      const msg = `${it.type === "fix" ? "fix" : "feat"}: ${it.title} (${it.id})`, k = scm.commit(msg, it.agent);
      if (k) chat.toolResult(chat.tl(c.tools, "git commit", msg), `<span class="okc">${esc(k.h)}</span>`);
      await scm.settle(); /* os testes correm sobre o disco: o commit (e a gravação) primeiro */
      setStage(it, "test");
      const ok = await autoTest(it, c.tools);
      if (ok) { it.note = ""; setStage(it, "func"); chat.cardAppend(c.bd, `<p><span class="tag live">${copy("testsPassed")}</span> ${copy("waitingForYourFunctional")}</p>`); }
      else { const bad = (it.res || []).filter((x) => !x.ok).map((x) => x.n).join(", "); it.note = bad ? "reprovado em teste: " + bad : "sem testes do projecto"; setStage(it, "dev"); chat.cardAppend(c.bd, '<p><span class="tag bad">testes falharam</span> a issue volta a desenvolvimento.</p>'); }
    } finally {
      if (it.branch && scm.branch() !== "develop") scm.checkout("develop");
      runctl.setAuthor("w");
    }
  }

  async function delegate(id: string): Promise<void> {
    if (runctl.active()) { notifier.toast("Há uma execução em curso"); return; } const it = BL().issues.find((i) => i.id === id); if (!it) return; chat.focusAgent(true);
    chat.user(`Delega ${it.id} a ${directory.agents()[it.agent].n}.`); runctl.setActive(true, it.id); try { await orchestration.runIssue(it); } catch (e: any) { if (e === runctl.stop()) chat.card("co-dev", "Execução parada a teu pedido."); else { console.error(e); chat.card("sistema", "Erro: " + esc(e.message || e)); } } finally { if (scm.branch() !== "develop") scm.checkout("develop"); runctl.setAuthor("w"); runctl.setActive(false); view.refresh(); view.rerender("board"); chat.scrollMsgs(); }
  }

  async function runSprint(s: number): Promise<void> {
    if (runctl.active()) { notifier.toast("Há uma execução em curso"); return; } BL().issues.forEach((i) => { if (i.sprint === s && i.stage === "backlog") i.stage = "todo"; }); view.rerender("board"); const todo = (): Issue | undefined => BL().issues.find((i) => i.sprint === s && i.stage === "todo");
    if (!todo()) { notifier.toast("Não há issues por fazer no Sprint " + (s + 1)); return; } chat.focusAgent(true); chat.user(`Executa o Sprint ${s + 1}.`); runctl.setActive(true, "Sprint " + (s + 1)); let n = 0;
    try { let it: Issue | undefined; while ((it = todo())) { if (runctl.mode() === "manual") { const c = chat.card("co-dev", `<p>${copy("nextIssue")} <code>${it.id}</code> ${esc(it.title)} → <b>${directory.agents()[it.agent].n}</b></p>`); const v = await chat.ask(c.bd, [{ l: "Delegar", v: 1, pri: 1, done: "✓ delegada por ti" }, { l: "Parar o sprint", v: 0 }]); if (!v) throw runctl.stop(); } await orchestration.runIssue(it); n++; }
      const { func: f, dev: b } = sprintCounts(BL().issues, s); chat.card("co-dev", `<p><b>Sprint ${s + 1}</b>: ${n} issues trabalhadas. <b>${f}</b> passaram nos testes automáticos e esperam a tua validação funcional${b ? `; <b>${b}</b> ficaram bloqueadas em desenvolvimento` : ""}.</p><p style="color:var(--fg-dim)">${copy("eachIssueIsOn")} <code>feature/…</code>${copy("theMergeInto")} <code>develop</code> ${copy("happensWhenYouValidate")}</p><div class="gate"><button class="gb pri" data-action="board:openBoard">${copy("validateOnTheBoard")}</button><button class="gb" data-action="board:openGraph">${copy("viewTheGraph")}</button></div>`); notifier.note(`Sprint ${s + 1}: ${f} issues à espera de validação funcional`);
    } catch (e: any) { if (e === runctl.stop()) chat.card("co-dev", "Sprint parado a teu pedido."); else { console.error(e); chat.card("sistema", "Erro: " + esc(e.message || e)); } } finally { if (scm.branch() !== "develop") scm.checkout("develop"); runctl.setAuthor("w"); runctl.setActive(false); view.refresh(); view.rerender("board"); chat.scrollMsgs(); }
  }

  function approveIssue(id: string): void {
    const it = BL().issues.find((i) => i.id === id); if (!it || it.stage !== "func") return; if (runctl.active()) { notifier.toast("Espera que a execução termine"); return; } if (it.branch && scm.refs()[it.branch]) { const m = scm.gfFinish(it.branch, "w"); it.merged = m ? m.h : null; } it.note = ""; setStage(it, "done"); notifier.toast(`${it.id} validada · merge em develop`);
  }

  function rejectIssue(id: string): void {
    const it = BL().issues.find((i) => i.id === id); if (!it) return; nav.palette("", { ph: "Porque rejeitas? (fica como nota na issue)", verb: "Rejeitar", text: (q) => { it.note = "rejeitada na validação funcional" + (q.trim() ? ": " + q.trim() : ""); it.res = null; setStage(it, "dev"); } });
  }

  async function dropIssue(id: string, st: string): Promise<void> {
    const it = BL().issues.find((i) => i.id === id); if (!it || it.stage === st) return; if (runctl.active()) { notifier.toast("Espera que a execução termine"); return; }
    if (st === "done") { if (it.stage !== "func") { notifier.toast("Só passa a Concluído depois da validação funcional"); return; } orchestration.approveIssue(id); return; }
    if (st === "test" || st === "func") { if (st === "func") notifier.toast("Antes da validação funcional correm os testes automáticos"); if (it.branch && scm.refs()[it.branch] && scm.branch() !== it.branch) scm.checkout(it.branch); setStage(it, "test"); const ok = await autoTest(it, null); if (scm.branch() !== "develop") scm.checkout("develop"); it.note = ok ? "" : "reprovado em teste: " + it.res!.filter((r) => !r.ok).map((r) => r.n).join(", "); setStage(it, ok ? "func" : "dev"); notifier.toast(ok ? `${it.id}: testes passaram → validação funcional` : `${it.id}: testes falharam → volta a desenvolvimento`); return; }
    setStage(it, st);
  }

  function newIssue(): void {
    nav.palette("", { ph: 'Título da issue (prefixo "fix:" para correcções)', verb: "Criar issue", text: (q) => { q = q.trim(); if (!q) return; const fx = /^fix:/i.test(q); mkIssue({ custom: true, type: fx ? "fix" : "feature", title: q.replace(/^fix:\s*/i, ""), agent: "lead", sprint: BL().view < 0 ? 0 : BL().view, stage: "todo", pts: 2 }); view.rerender("board"); } });
  }

  /** As issues de um conjunto de componentes planeados no Studio — a mesma decomposição de
   *  antes (o ADR do arquitecto; um serviço/aplicação web/esquema por componente desses tipos;
   *  os artefactos de execução, que cobrem os restantes componentes, e o teste de fumo), mas só
   *  o enunciado e o contexto do desenho (na nota, que segue para o agente) — sem código: quem
   *  implementa é o agente real (ADR-0006, R3a). */
  function genBacklogIssues(plan: DesignNode[]): Issue[] {
    const D = store.design(), made: Issue[] = [], name = (id: string): string => (D.nodes.find((n) => n.id === id) || { n: id }).n;
    const names = plan.slice(0, 3).map((p) => p.n).join(", ") + (plan.length > 3 ? ` +${plan.length - 3}` : "");
    made.push(mkIssue({ agent: "arq", pts: 2, sprint: 0, node: null, title: "ADR: " + names,
      note: `Regista a decisão de arquitectura dos componentes desenhados no Studio: ${plan.map((p) => `${p.n} (${catalog.tech()[p.tech].n})`).join(", ")}.` }));
    plan.forEach((n) => {
      const T: TechSpec = catalog.tech()[n.tech], links = D.edges.filter((e) => e[0] === n.id).map((e) => name(e[1]));
      const ctx = `Componente do Studio «${n.n}» (${T.n}, pasta ${catalog.appDir(n)}/)${links.length ? `; liga a: ${links.join(", ")}` : ""}.`;
      if (T.kind === "app") made.push(mkIssue({ agent: "be", pts: 5, sprint: 0, node: n.id, title: `${n.n}: serviço (${T.n})`, note: ctx }));
      if (T.kind === "web") made.push(mkIssue({ agent: "fe", pts: 3, sprint: 1, node: n.id, title: `${n.n}: aplicação web (${T.n})`, note: ctx }));
      if (T.kind === "sql" || T.kind === "mssql") made.push(mkIssue({ agent: "db", pts: 3, sprint: 0, node: n.id, title: `${n.n}: esquema e primeira migração`, note: ctx }));
    });
    made.push(mkIssue({ agent: "ops", pts: 5, sprint: 1, node: null, infra: true, title: "Artefactos de execução: compose, variáveis de ambiente e Kubernetes",
      note: `Um serviço por componente do desenho: ${D.nodes.map((n) => `${n.n} (${catalog.tech()[n.tech].n})`).join(", ")}.` }));
    if (D.nodes.some((n) => catalog.isApp(n))) made.push(mkIssue({ agent: "qa", pts: 2, sprint: 1, node: null, title: "Teste de fumo da stack a correr", note: "Cada aplicação responde no seu endpoint de saúde." }));
    return made;
  }

  /** «Gerar backlog»: as issues dos componentes planeados no Studio (ver genBacklogIssues). */
  function genBacklog(): void {
    if (runctl.active()) { notifier.toast("Há uma execução em curso"); return; }
    const plan = store.design().nodes.filter((n) => n.st === "plan" && !BL().issues.some((i) => i.node === n.id)), errs = generators.validateDesign().filter((f) => f[0] === "e");
    chat.focusAgent(true);
    if (errs.length) { chat.card("quadro", `<p>O desenho tem erros, por isso não gero issues a partir dele:</p>${errs.map((e) => `<div class="fixl"><b>✖</b><span>${esc(e[1])}</span></div>`).join("")}`); return; }
    if (!plan.length) { chat.card("quadro", "Não há componentes <b>planeados</b> novos no desenho. Acrescenta um no Studio (contorno tracejado) e gera de novo."); return; }
    const made = genBacklogIssues(plan);
    plan.forEach((n) => { store.design().nodes.find((x) => x.id === n.id)!.st = "wip"; });
    made.forEach((i) => { i.stage = i.sprint === 0 ? "todo" : "backlog"; });
    store.saveDesign();
    chat.card("quadro", `<p>Criei <b>${made.length}</b> issues a partir de <b>${plan.length}</b> componentes planeados no Studio. Cada uma é implementada pelo agente quando a delegares (o plano passa por ti).</p>${made.map((i) => `<div class="fixl"><code>${i.id}</code><span>${esc(i.title)} → ${esc((directory.agents()[i.agent] || { n: i.agent }).n)}</span></div>`).join("")}`);
    notifier.log("quadro", `backlog gerado do Studio: ${made.length} issues`); view.rerender("board"); openBoard();
  }

  return { mkIssue, setStage, autoTest, runIssue, delegate, runSprint, approveIssue, rejectIssue, dropIssue, newIssue, openBoard, genBacklog, genBacklogIssues };
}
