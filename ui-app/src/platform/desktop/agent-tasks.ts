/* ═════════ dxtutor IDE — desktop: delegação isolada (ADR-0004, U4h1) ═════════
   O Co-Dev delega um conjunto de escritas num git worktree de HEAD (agent_task_*) e o humano
   revê o patch num cartão antes de o aplicar. Era a secção «delegação isolada» do bridge.ts,
   verbatim. */

import type { DelegateResult } from "./types";
import type { DesktopContext } from "./context";
import { translator } from "../../app/i18n";
import { AGENT_TASKS_MESSAGES } from "./agent-tasks.messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(AGENT_TASKS_MESSAGES);

export function installAgentTasks(ctx: DesktopContext): void {
const { R, tasks, escH } = ctx;
const flushSave = () => ctx.flushSave();
/* ───── delegação isolada (agent_task_*) ─────
   Corre um conjunto de writes num git worktree de HEAD e devolve o diff para revisão,
   SEM tocar na árvore de trabalho (RF-AG-01/05). Superfície de UI real do lifecycle
   submit → status → cancel: o Co-Dev delega aqui e o humano revê/aplica o patch. */
async function delegate(writes: [string, string][], o: { signal?: AbortSignal | null; onStatus?: (s: string) => void } = {}): Promise<DelegateResult> {
  if (!R.root) throw new Error("abre uma pasta primeiro");
  const id = await tasks.submit(R.root, writes);
  for (let i = 0; i < 1200; i++) {
    if (o.signal && o.signal.aborted) { await tasks.cancel(id); throw STOP; }
    const st = await tasks.status(id);
    if (!st) throw new Error("tarefa desconhecida: " + id);
    if (o.onStatus) o.onStatus(st.status);
    if (st.status !== "running") return st;
    await new Promise(r => setTimeout(r, 100));
  }
  await tasks.cancel(id);
  throw new Error("a delegação não terminou a tempo");
}
R.delegate = (writes, o) => delegate(writes, o);
R.cancelTask = id => tasks.cancel(id);
/** Card de revisão: mostra o patch isolado e deixa aplicá-lo ao projecto ou descartá-lo. */
async function delegateReview(title: string, writes: [string, string][]): Promise<void> {
  const ac = new AbortController();
  const c = card("delegate", `Delegação isolada: <b>${escH(title)}</b><div class="dlg-st"><span class="spin"></span> a correr… <button class="mini" id="dlg-x">Cancelar</button></div><div class="dlg-body"></div>`);
  const stEl = () => c.bd.querySelector(".dlg-st") as HTMLElement | null;
  const xb = c.bd.querySelector("#dlg-x") as HTMLButtonElement | null;
  if (xb) xb.onclick = () => ac.abort();
  let res: DelegateResult;
  try { res = await delegate(writes, { signal: ac.signal }); }
  catch (e) { const el = stEl(); if (el) el.innerHTML = e === STOP ? '<span style="color:var(--red)">✖ cancelada</span>' : '<span style="color:var(--red)">✖ ' + escH(String((e as Error) && (e as Error).message || e)) + "</span>"; return; }
  const el = stEl();
  if (el) el.innerHTML = res.status === "done" ? '<span class="okc">✓ patch pronto para revisão</span>' : '<span style="color:var(--red)">✖ ' + escH(res.error || res.status) + "</span>";
  const body = c.bd.querySelector(".dlg-body") as HTMLElement | null;
  if (!body) return;
  body.innerHTML = `<pre style="white-space:pre-wrap;max-height:300px;overflow:auto;margin:6px 0">${escH(res.patch || "(sem alterações)")}</pre>` + (res.status === "done" && res.patch ? `<button class="mini pri" id="dlg-ap">Aplicar ao projecto</button> <button class="mini" id="dlg-no">${txt("discard")}</button>` : "");
  const ap = body.querySelector("#dlg-ap") as HTMLButtonElement | null;
  if (ap) ap.onclick = () => { writes.forEach(([rel, content]) => writeFile(ROOT + rel, content)); flushSave(); body.innerHTML = '<span class="okc">✓ aplicado ao projecto</span>'; };
  const no = body.querySelector("#dlg-no") as HTMLButtonElement | null;
  if (no) no.onclick = () => { body.innerHTML = '<span class="dim">descartado — o worktree isolado não tocou nos teus ficheiros</span>'; };
}
R.delegateReview = (title, writes) => delegateReview(title, writes);
}
