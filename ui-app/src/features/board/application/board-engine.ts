/* ═══════════ feature `board` — motor dos casos de uso (ADR-0002, Fase 3) ═══════════
   O runner, o CRUD e o PRODUTOR Studio→backlog, livres de `window`/DOM: todo o mundo
   exterior entra por `BoardDeps` (ver `ports.ts`), injectado na composição
   (`features/board.ts`). Importa só o domínio puro, `esc` (puro) e as portas.

   O motor constrói as STRINGS de HTML (dados) mas nunca lê/escreve o DOM — segura os
   handles opacos devolvidos por `chat.card`/`chat.tl` e devolve-os a
   `toolResult`/`cardAppend`/`cardSet`. As arestas internas decoradas (delegate→runIssue,
   runSprint→runIssue, dropIssue→approveIssue) passam por `orchestration`. */

import { esc } from "../../../core";
import type { Issue, IssueFile, Design, DesignNode, TechSpec } from "../domain/types";
import { slug } from "../domain/slug";
import { makeIssue } from "../domain/issue";
import { nodeStatus, sprintCounts } from "../domain/kanban";
import type { BoardDeps, BoardEngine, Host } from "./ports";

export function makeBoardEngine(deps: BoardDeps): BoardEngine {
  const { store, workspace, catalog, generators, directory, scm, runctl, chat, router, terminal, team, view, notifier, nav, orchestration } = deps;
  const BL = () => store.backlog();
  const exists = (p: string) => () => !!workspace.files()[p];

  function mkIssue(o: Partial<Issue>): Issue { const it = makeIssue(BL().seq++, o); BL().issues.push(it); return it; }

  function openBoard(): void { nav.openTab({ id: "board", title: "Quadro", kind: "board" }); }

  function setStage(it: Issue, st: string): void {
    it.stage = st;
    if (it.node) { const n = store.design().nodes.find((x) => x.id === it.node); if (n) { n.st = nodeStatus(BL().issues, it.node); store.saveDesign(); } }
    view.rerender("board"); view.rerenderCodev();
  }

  async function autoTest(it: Issue, host: Host | null): Promise<boolean> {
    const d = host ? chat.tl(host, "auto-test", it.id + " · disparado ao entrar em Teste") : null; await chat.sleep(380);
    const res = it.tests.length ? it.tests.map((t) => ({ n: t.n, ok: !!t.fn() })) : [{ n: "workspace::cargo_test", ok: terminal.runTests().ok }, { n: "workspace::design_lint", ok: !terminal.dsLint().length }], ok = res.every((r) => r.ok), f = res.filter((r) => !r.ok).length; it.res = res;
    if (terminal.getVar("--panel-h") !== "0px") terminal.setPanelTab("terminal", true); terminal.echoCmd("dx test " + it.id); terminal.echo(`<span class="dim">running ${res.length} tests (${esc(it.branch || scm.branch())})</span>\n` + res.map((r) => `test ${r.n} ... ${r.ok ? '<span class="ok">ok</span>' : '<span class="er">FAILED</span>'}`).join("\n") + `\n\ntest result: ${ok ? '<span class="ok">ok</span>' : '<span class="er">FAILED</span>'}. ${res.length - f} passed; ${f} failed`); terminal.newInput(true);
    if (d) chat.toolResult(d, `<span class="${ok ? "okc" : "bad"}">${ok ? "✓" : "✖"} ${res.length - f}/${res.length}</span>`); notifier.log("auto-test", `${it.id}: ${res.length - f}/${res.length} ${ok ? "— passa para validação funcional" : "— volta a desenvolvimento"}`); return ok;
  }

  async function runIssue(it: Issue): Promise<void> {
    const ag = directory.agents()[it.agent]; runctl.setAuthor(it.agent); runctl.label(`${it.id} · ${ag.n}`);
    const r = await router.route(it.agent, it.title); it.model = r.p; const c = chat.card(`${ag.n.toLowerCase()} · ${directory.provs()[r.p].name.toLowerCase()}`, `<p><code>${it.id}</code> <b>${esc(it.title)}</b></p>`);
    chat.toolResult(chat.tl(c.tools, "route_model", directory.taskProfiles()[ag.task].l.toLowerCase()), `<span class="okc">${directory.provs()[r.p].name}</span> <span style="color:var(--fg-muted)" title="${esc(r.why)}">${esc(r.by)}</span>`); await chat.beat(300);
    it.branch = scm.gfStart(it.type === "fix" ? "fix" : "feature", it.id + "-" + slug(it.title).slice(0, 22)); chat.toolResult(chat.tl(c.tools, "gitflow", "checkout -b " + it.branch), '<span class="okc">✓</span>'); setStage(it, "dev"); await chat.beat(300);
    const apply = async (genFiles: IssueFile[], msg: string): Promise<void> => {
      let n = 0;
      for (const f of genFiles) {
        if (!team.inScope(it.agent, f.p)) { const o = team.ownerOf(f.p), sub = mkIssue({ agent: o, pts: 2, sprint: it.sprint, stage: "todo", node: it.node, title: `${team.short(f.p).split("/").pop()} (delegated by ${it.id})`, gen: () => [{ p: f.p, content: f.content }], fix: f.fix ? () => [{ p: f.p, content: f.fix! }] : null, fixNote: f.fixNote, tests: f.tests || [{ n: `harness::${slug(team.short(f.p).split("/").pop()!).replace(/-/g, "_")}`, fn: exists(f.p) }] });
          chat.toolResult(chat.tl(c.tools, "harness", team.short(f.p)), `<span class="bad">✖ fora do escopo</span> → <span style="color:${directory.agents()[o].col}">${directory.agents()[o].n}</span> <code>${sub.id}</code>`); notifier.log("harness", `${ag.n} bloqueado em ${team.short(f.p)} → ${sub.id} para ${directory.agents()[o].n}`); view.rerender("board"); await chat.beat(350); continue; }
        if (++n > ag.max) { chat.toolResult(chat.tl(c.tools, "harness", "limite de ficheiros"), '<span class="bad">✖ excedido</span>'); break; } await terminal.doTool({ t: "edit", p: f.p, content: f.content }, c.tools);
      }
      scm.staged().clear(); genFiles.forEach((f) => { if (workspace.files()[f.p] && scm.statusOf(f.p) && team.inScope(it.agent, f.p)) scm.staged().add(f.p); }); if (scm.staged().size) { const k = scm.commit(msg, it.agent); if (k) chat.toolResult(chat.tl(c.tools, "git commit", msg), `<span class="okc">${k.h}</span>`); }
    };
    await apply(it.gen!(), `${it.type === "fix" ? "fix" : "feat"}: ${it.title} (${it.id})`);
    setStage(it, "test"); let ok = await autoTest(it, c.tools);
    if (!ok && it.fix) { it.attempts++; setStage(it, "dev"); const bad = it.res!.filter((x) => !x.ok).map((x) => x.n).join(", "); it.note = "reprovado em teste: " + bad; chat.cardAppend(c.bd, `<p><span class="tag bad">teste falhou</span> <code>${esc(bad)}</code> — a issue voltou a desenvolvimento. Correcção: ${it.fixNote}.</p>`); await chat.beat(500);
      await apply(it.fix!(), `fix: ${it.title} — fix test (${it.id})`); setStage(it, "test"); ok = await autoTest(it, c.tools); }
    if (ok) { it.note = it.attempts ? `passou à ${it.attempts + 1}.ª tentativa` : ""; setStage(it, "func"); chat.cardAppend(c.bd, '<p><span class="tag live">testes passaram</span> à espera da tua validação funcional no quadro.</p>'); }
    else { it.note = "testes continuam a falhar — precisa de orientação"; setStage(it, "dev"); chat.cardAppend(c.bd, '<p><span class="tag bad">bloqueada</span> os testes continuam a falhar.</p>'); }
    router.use(r.p, 2600); scm.checkout("develop"); runctl.setAuthor("w"); await chat.beat(250);
  }

  async function delegate(id: string): Promise<void> {
    if (runctl.active()) { notifier.toast("Há uma execução em curso"); return; } const it = BL().issues.find((i) => i.id === id); if (!it) return; chat.focusAgent(true);
    if (it.custom) { runctl.setAgent(it.agent); chat.agentPill(); setStage(it, "dev"); chat.handlePrompt(`Implementa a issue ${it.id}: ${it.title}`); return; }
    chat.user(`Delega ${it.id} a ${directory.agents()[it.agent].n}.`); runctl.setActive(true, it.id); try { await orchestration.runIssue(it); } catch (e: any) { if (e === runctl.stop()) chat.card("co-dev", "Execução parada a teu pedido."); else { console.error(e); chat.card("sistema", "Erro: " + esc(e.message || e)); } } finally { if (scm.branch() !== "develop") scm.checkout("develop"); runctl.setAuthor("w"); runctl.setActive(false); view.refresh(); view.rerender("board"); chat.scrollMsgs(); }
  }

  async function runSprint(s: number): Promise<void> {
    if (runctl.active()) { notifier.toast("Há uma execução em curso"); return; } BL().issues.forEach((i) => { if (i.sprint === s && i.stage === "backlog") i.stage = "todo"; }); view.rerender("board"); const todo = (): Issue | undefined => BL().issues.find((i) => i.sprint === s && i.stage === "todo" && !i.custom);
    if (!todo()) { notifier.toast("Não há issues por fazer no Sprint " + (s + 1)); return; } chat.focusAgent(true); chat.user(`Executa o Sprint ${s + 1}.`); runctl.setActive(true, "Sprint " + (s + 1)); let n = 0;
    try { let it: Issue | undefined; while ((it = todo())) { if (runctl.mode() === "manual") { const c = chat.card("co-dev", `<p>Próxima issue: <code>${it.id}</code> ${esc(it.title)} → <b>${directory.agents()[it.agent].n}</b></p>`); const v = await chat.ask(c.bd, [{ l: "Delegar", v: 1, pri: 1, done: "✓ delegada por ti" }, { l: "Parar o sprint", v: 0 }]); if (!v) throw runctl.stop(); } await orchestration.runIssue(it); n++; }
      const { func: f, dev: b } = sprintCounts(BL().issues, s); chat.card("co-dev", `<p><b>Sprint ${s + 1}</b>: ${n} issues trabalhadas. <b>${f}</b> passaram nos testes automáticos e esperam a tua validação funcional${b ? `; <b>${b}</b> ficaram bloqueadas em desenvolvimento` : ""}.</p><p style="color:var(--fg-dim)">Cada issue está no seu ramo <code>feature/…</code>; o merge em <code>develop</code> acontece quando validares.</p><div class="gate"><button class="gb pri" data-action="board:openBoard">Validar no quadro</button><button class="gb" data-action="board:openGraph">Ver o grafo</button></div>`); notifier.note(`Sprint ${s + 1}: ${f} issues à espera de validação funcional`);
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

  function genBacklogIssues(plan: DesignNode[]): Issue[] {
    const D = JSON.parse(JSON.stringify(store.design())) as Design, made: Issue[] = [], by = (id: string): DesignNode | undefined => D.nodes.find((n) => n.id === id), adr = catalog.root() + `.dxtutor/arquitectura/ADR-00${BL().adr++}-${slug(plan.slice(0, 3).map((p) => p.n).join(" ")).slice(0, 30)}.md`, apps = D.nodes.filter(catalog.isApp), C = catalog.root() + "docker-compose.yml"; let firstApp = true;
    made.push(mkIssue({ agent: "arq", pts: 2, sprint: 0, node: null, title: "ADR: " + plan.slice(0, 3).map((p) => p.n).join(", ") + (plan.length > 3 ? ` +${plan.length - 3}` : ""), gen: () => [{ p: adr, content: `# ${adr.split("/").pop()!.replace(".md", "")}\n\n**Status:** proposed\n\n**Context:** components designed in the Studio.\n\n**Decision:**\n${plan.map((p) => `- ${p.n} — ${catalog.tech()[p.tech].n}${catalog.tech()[p.tech].local ? ` (locally: ${catalog.tech()[p.tech].local})` : ""}`).join("\n")}\n\n**Dependencies:**\n${D.edges.map((e) => `- ${by(e[0])!.n} → ${by(e[1])!.n}`).join("\n")}\n` }], tests: [{ n: "adr::lists_decision_and_dependencies", fn: () => generators.has(adr, /\*\*Decision:\*\*/) && generators.has(adr, /\*\*Dependencies:\*\*/) }] }));
    plan.forEach((n) => { const T: TechSpec = catalog.tech()[n.tech], rs = catalog.nodeSlug(n).replace(/-/g, "_"), d = catalog.root() + catalog.appDir(n) + "/";
      if (T.kind === "app") { const bad = firstApp; firstApp = false; const main = ({ rust: "src/main.rs", go: "src/main.go", node: "src/server.js", python: "src/main.py" } as Record<string, string>)[T.rt as string]; made.push(mkIssue({ agent: "be", pts: 5, sprint: 0, node: n.id, title: `${n.n}: service skeleton (${T.n})`, gen: () => generators.appFiles(by(n.id), D, bad), tests: [{ n: `${rs}::exposes_healthz`, fn: () => generators.has(d + main, /healthz/) }, { n: `${rs}::reads_port_from_env`, fn: () => generators.has(d + main, /PORT/) }] })); }
      if (T.kind === "web") made.push(mkIssue({ agent: "fe", pts: 3, sprint: 1, node: n.id, title: `${n.n}: web app (${T.n})`, gen: () => generators.appFiles(by(n.id), D, true), fix: () => generators.appFiles(by(n.id), D, false), fixNote: "replace the fixed colour with the <code>--accent</code> token", tests: [{ n: `${rs}::builds_static_bundle`, fn: () => generators.has(d + "Dockerfile", /npm run build/) }, { n: `${rs}::uses_design_tokens`, fn: () => !!workspace.files()[d + "src/main.jsx"] && !generators.has(d + "src/main.jsx", /#[0-9a-fA-F]{6}\b/) }] }));
      if (T.kind === "sql" || T.kind === "mssql") { const m = catalog.root() + `db/migrations/000${BL().mig++}_${rs}.sql`; made.push(mkIssue({ agent: "db", pts: 3, sprint: 0, node: n.id, title: `${n.n}: schema and first migration`, gen: () => [{ p: m, content: `-- ${n.n} (${T.n})\nCREATE TABLE ${rs}_items (\n  id         VARCHAR(26) PRIMARY KEY,\n  payload    TEXT NOT NULL,\n  created_at BIGINT NOT NULL\n);\n\nCREATE INDEX idx_${rs}_items_created ON ${rs}_items (created_at DESC);\n` }], tests: [{ n: `db::${rs}_has_index`, fn: () => generators.has(m, /CREATE INDEX/) }] })); } });
    made.push(mkIssue({ agent: "ops", pts: 5, sprint: 1, node: null, infra: true, title: "Cloud-native artefacts: compose, env, Makefile, Kubernetes", gen: () => [{ p: C, content: generators.compose(D, true) }, { p: catalog.root() + ".env.example", content: "# Copy to .env — values for local development only.\nMSSQL_SA_PASSWORD=Change_me_123\n" }, { p: catalog.root() + "Makefile", content: ".PHONY: run stop logs test\n\nrun:\n\tdocker compose up --build -d\n\tdocker compose ps\n\nstop:\n\tdocker compose down\n\nlogs:\n\tdocker compose logs -f\n\ntest:\n\tsh tests/smoke.sh\n" }, { p: catalog.root() + "deploy/cloud-mapping.md", content: generators.cloudMap(D) }, ...apps.map((a) => ({ p: catalog.root() + `deploy/k8s/${catalog.nodeSlug(a)}.yaml`, content: generators.k8sYaml(a) })), { p: catalog.root() + "deploy/k8s/00-infra.yaml", content: generators.k8sInfra(D) }], fix: () => [{ p: C, content: generators.compose(D, false) }], fixNote: "make dependents wait for <code>service_healthy</code>",
      tests: [{ n: "compose::one_service_per_component", fn: () => D.nodes.every((n) => generators.has(C, new RegExp("^  " + catalog.nodeSlug(n) + ":", "m"))) }, { n: "compose::waits_for_healthy_dependencies", fn: () => !D.nodes.some((n) => (catalog.kind()[catalog.tech()[n.tech].kind] || ({} as { hc?: boolean })).hc && D.edges.some((e) => e[1] === n.id)) || generators.has(C, /condition: service_healthy/) }, { n: "k8s::one_manifest_per_app", fn: () => apps.every((a) => !!workspace.files()[catalog.root() + `deploy/k8s/${catalog.nodeSlug(a)}.yaml`]) }, { n: "make::run_target", fn: () => generators.has(catalog.root() + "Makefile", /^run:/m) }] }));
    const sm = catalog.root() + "tests/smoke.sh", gw = D.nodes.find((n) => catalog.tech()[n.tech].kind === "gateway"); made.push(mkIssue({ agent: "qa", pts: 2, sprint: 1, node: null, title: "Smoke test for the running stack", gen: () => [{ p: sm, content: `#!/bin/sh\n# Smoke test: every application answers on its health endpoint.\nset -e\n${apps.map((a) => { const T: TechSpec = catalog.tech()[a.tech], routed = gw && D.edges.some((e) => e[0] === gw.id && e[1] === a.id); return `curl -fsS http://localhost:${routed ? "8080" + (T.kind === "web" ? "/" : "/" + catalog.nodeSlug(a) + "/healthz") : (T.port! + apps.indexOf(a) * 10) + (T.kind === "web" ? "/" : "/healthz")} > /dev/null && echo "ok ${catalog.nodeSlug(a)}"`; }).join("\n")}\n` }], tests: [{ n: "smoke::checks_every_app", fn: () => apps.every((a) => generators.has(sm, new RegExp("ok " + catalog.nodeSlug(a)))) }] })); return made;
  }

  async function genBacklog(): Promise<void> {
    if (runctl.active()) { notifier.toast("Something is already running"); return; } const plan = store.design().nodes.filter((n) => n.st === "plan" && !BL().issues.some((i) => i.node === n.id)), errs = generators.validateDesign().filter((f) => f[0] === "e"); chat.focusAgent(true); chat.user("Turn the Studio design into a backlog and sprints.");
    if (errs.length) { chat.card("arquitecto", `<p>The design has errors, so I will not generate from it:</p>${errs.map((e) => `<div class="fixl"><b>✖</b><span>${esc(e[1])}</span></div>`).join("")}`); return; }
    if (!plan.length) { chat.card("arquitecto", "There are no new <b>planned</b> components in the design. Add one in the Studio (dashed outline) and generate again."); return; }
    runctl.setActive(true, "Architect reading the design"); try { const r = await router.route("arq", "Decompose architecture into backlog"), c = chat.card(`arquitecto · ${directory.provs()[r.p].name.toLowerCase()}`, '<p><span class="spin"></span> Reading the design and the project rules…</p>');
      chat.toolResult(chat.tl(c.tools, "route_model", "decompose architecture"), `<span class="okc">${directory.provs()[r.p].name}</span> <span style="color:var(--fg-muted)">${esc(r.by)}</span>`); await chat.beat(450); chat.toolResult(chat.tl(c.tools, "read_design", `${store.design().nodes.length} components · ${store.design().edges.length} connections`), '<span class="okc">✓</span>'); await chat.beat(450);
      const made = genBacklogIssues(plan); plan.forEach((n) => { store.design().nodes.find((x) => x.id === n.id)!.st = "wip"; }); made.forEach((i) => { i.stage = i.sprint === 0 ? "todo" : "backlog"; }); store.saveDesign(); router.use(r.p, 3200);
      chat.cardSet(c.bd, `<p>I read the design: <b>${plan.length}</b> planned components across ${[...new Set(plan.map((p) => catalog.cloud()[catalog.tech()[p.tech].cloud].l))].join(", ")}. I created <b>${made.length}</b> issues in 2 sprints, each assigned to the assistant that owns that scope:</p>${[0, 1].map((s) => `<div class="req"><b>Sprint ${s + 1}</b> · ${made.filter((i) => i.sprint === s).reduce((a, i) => a + i.pts, 0)} pts${made.filter((i) => i.sprint === s).map((i) => `<div class="ac"><code>${i.id}</code> <span class="notr">${esc(i.title)}</span> — <span style="color:${directory.agents()[i.agent].col}">${directory.agents()[i.agent].n}</span></div>`).join("")}</div>`).join("")}<p style="color:var(--fg-dim)">When every issue is validated, <b>▶ RUN</b> starts the whole stack.</p><div class="gate"><button class="gb pri" data-action="board:openBoard">Open the board</button><button class="gb" data-action="board:runSprint" data-on="0">Run Sprint 1</button></div>`);
      notifier.log("arquitecto", `backlog generated: ${made.length} issues`); notifier.note(`Backlog generated: ${made.length} issues`); } catch (e: any) { if (e !== runctl.stop()) console.error(e); } finally { runctl.setActive(false); chat.scrollMsgs(); openBoard(); }
  }

  return { mkIssue, setStage, autoTest, runIssue, delegate, runSprint, approveIssue, rejectIssue, dropIssue, newIssue, openBoard, genBacklog, genBacklogIssues };
}
