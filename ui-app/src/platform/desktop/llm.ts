/* ═════════ dxtutor IDE — desktop: modelos reais (LLM) (ADR-0004, U4h1) ═════════
   As chaves e capacidades dos providers (providers.json), o sampler real em streaming com o
   protocolo de acções dxcode/dxaction, as aprovações de comandos, o `exec` que corre os
   comandos de verificação do Co-Dev, e as decorações do painel do agente, do «Test
   connection» e da página Settings. Eram as secções «LLM providers» (e a parte de UI que
   vinha depois da delegação) do bridge.ts, verbatim. */

import { detectCommands, summarizeRun, type VerifyKind } from "../../features/codev/domain/project-commands";
import type { ProvidersConfig, ProviderInfo } from "../tauri/providers";
import type { Tool, SampleOpts, SampleMsg, VerifyOutcome } from "./types";
import type { CodevDesktop } from "../../features/codev/application/ports";
import { desktopPorts } from "../../app/desktop";
import { registerActions } from "../../app/actions";
import type { Desktop } from "./types";
import type { DesktopContext } from "./context";
import { translator } from "../../app/i18n";
import { LLM_MESSAGES } from "./llm.messages";
import { STOP } from "../../features/codev";
import { agentStore } from "../../app/store";
import { services } from "../../app/services";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(LLM_MESSAGES);

export function installLlm(ctx: DesktopContext): void {
const { T, R, providers, sh, escH, ansi, idle } = ctx;
const flushSave = () => ctx.flushSave();
const reloadDisk = () => ctx.reloadDisk();
const envFor = () => ctx.envFor();
const termLineDom = (t: string, e?: boolean) => ctx.termLine(t, e);
/* ───── LLM providers ───── */
/** UI prov-key → id do provider de streaming do backend (codex é a marca OpenAI do protótipo). */
const STREAM_PROV: Record<string, string> = { claude: "claude", codex: "openai", gemini: "gemini", ollama: "ollama" };
/** Config real de providers em memória (fonte única: providers.json via tutor-llm). */
let CFG: ProvidersConfig | null = null;
let PROVCAPS: ProviderInfo[] = [];
/** Lê a config real do backend e deriva R.keys (o que `usable()` consulta). Ollama é sempre
    local — sem chave. As chaves vivem agora em providers.json, que tanto o streaming
    (`assistant_chat_stream`) como o tool-loop (`llm_chat`, via keys::resolve) lêem. */
async function loadKeys(): Promise<void> {
  try {
    CFG = await providers.getConfig();
    R.keys = { claude: CFG.anthropicKey || "", codex: CFG.openaiKey || "", gemini: CFG.geminiKey || "" };
  } catch { CFG = null; R.keys = {}; }
  try { PROVCAPS = await providers.list(); } catch { PROVCAPS = []; }
}
const usable = (k: string) => !!(PROV[k] && PROV[k].on && (PROV[k].local || R.keys[k]));
function pickProv(): string {
  if (usable(ACTIVE)) return ACTIVE;
  const k = ["claude", "codex", "gemini", "ollama"].find(usable);
  if (!k) throw new Error("No model is configured — add an API key in Settings, or start Ollama.");
  return k;
}
const approvals: Record<string, { ok: (v: boolean) => void; el: HTMLElement }> = {};
R.approve = (id, ok) => {
  const a = approvals[id];
  if (a) { delete approvals[id]; a.el.innerHTML = ok ? '<span class="okc">✓ allowed</span>' : '<span style="color:var(--red)">✖ denied</span>'; a.ok(ok); }
};
function askApproval(cmd: string): Promise<boolean> {
  const id = "a" + Date.now();
  return new Promise(ok => {
    const c = card("approval", `Run in <b>${escH(R.name)}</b>?<pre style="white-space:pre-wrap;margin:6px 0">${escH(cmd)}</pre><span><button class="mini pri" data-action="desktop:approve" data-on="${escH(JSON.stringify([id, true]))}">${txt("allow")}</button> <button class="mini" data-action="desktop:approve" data-on="${escH(JSON.stringify([id, false]))}">${txt("deny")}</button></span>`);
    approvals[id] = { ok, el: (c.bd.querySelector("span:last-child") as HTMLElement | null) || c.bd };
  });
}
/** Corre `cmd` no projecto aberto e devolve o resultado REAL (código de saída, resumo e
    caudas de stdout/stderr para o modelo). Antes, as ferramentas run_tests/design_lint do
    Co-Dev recebiam sempre {ok:true} no desktop — o modelo "verificava" sem nada correr.
    A saída é ecoada no terminal integrado para o humano ver o mesmo que o modelo. */
R.exec = async (cmd: string): Promise<VerifyOutcome> => {
  /* os testes do projecto correm no separador «Tests» do painel, ao vivo (o humano vê cada teste e
     as falhas com o sítio); o modelo recebe o mesmo resultado de sempre */
  const liveRun = services.tests?.runLive;
  if (liveRun && R.projectCmd?.("test")?.cmd === cmd) {
    const r = await liveRun({ source: "Co-Dev", command: cmd });
    const out = r.output;
    return { ok: r.passed, code: r.passed ? 0 : 1, sum: summarizeRun(r.passed ? 0 : 1, false, out, ""), out: `exit ${r.passed ? 0 : 1}\n--- stdout\n${out.slice(-12000)}\n--- stderr\n` };
  }
  flushSave();
  await idle();
  /* com o painel real, o eco vai para o canal «Co-Dev» do Output (o terminal é do humano) */
  const termLine = (t: string, e?: boolean) => (R.term ? R.term.log("Co-Dev", t, e) : termLineDom(t, e));
  termLine("$ " + cmd);
  const o = { timeout: 600000, env: envFor() };
  const r = R.info.os === "windows" ? await sh("cmd", ["/C", cmd], o) : await sh("sh", ["-c", cmd], o);
  const stdout = ansi(r.stdout || ""), stderr = ansi(r.stderr || "");
  const ok = r.code === 0 && !r.timedOut;
  (stdout + (stderr ? "\n" + stderr : "")).trimEnd().split("\n").slice(-40).forEach(l => termLine(l, !ok));
  const sum = summarizeRun(r.code, !!r.timedOut, stdout, stderr);
  termLine(sum, !ok);
  await reloadDisk();
  return { ok, code: r.code, sum, out: `exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n--- stdout\n${stdout.slice(-12000)}\n--- stderr\n${stderr.slice(-6000)}` };
};
/** O comando de testes/lint deste projecto (detectado a partir dos ficheiros no disco). */
R.projectCmd = (kind: VerifyKind) => (R.root ? detectCommands(R.disk)[kind] : null);
function extraTools(): Tool[] {
  if (!R.root) return [];
  return [{
    name: "run_command",
    description: `Runs a shell command in the project folder (${R.root}) and returns exit code, stdout and stderr. Use it for builds, tests, linters and git status. The human may have to approve it.`,
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    execute: async ({ command }: { command: string }) => {
      const danger = /git push|rm -rf|--force|drop table|mkfs|shutdown/i.test(command);
      if (agentStore.mode !== "auto" || danger) { if (!await askApproval(command)) return "the human denied this command"; }
      flushSave();
      await idle();
      const r = R.info.os === "windows" ? await sh("cmd", ["/C", command], { timeout: 300000, env: envFor() }) : await sh("sh", ["-c", command], { timeout: 300000, env: envFor() });
      await reloadDisk();
      return `exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n--- stdout\n${r.stdout.slice(-12000)}\n--- stderr\n${r.stderr.slice(-6000)}`;
    },
  }];
}
/** Um turno de chat em streaming real: liga aos eventos `llm://token|done|error`, chama
    `assistant_chat_stream` e devolve o texto acumulado. O Stop (AbortSignal) dispara
    `assistant_cancel`. O modo é derivado do contexto: pasta real aberta → "project"
    (par-a-par completo); sem pasta → "study" (contrato de tutor imposto no backend). */
async function streamChat(k: string, msgs: { role: string; content: string }[], o: SampleOpts): Promise<{ text: string; provider: string; inputTokens: number; outputTokens: number }> {
  const prov = STREAM_PROV[k] || "ollama";
  const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let text = "";
  let settleOk!: (v: { text: string; provider: string; inputTokens: number; outputTokens: number }) => void;
  let settleErr!: (e: unknown) => void;
  const done = new Promise<{ text: string; provider: string; inputTokens: number; outputTokens: number }>((res, rej) => { settleOk = res; settleErr = rej; });
  const offs: Array<() => void> = [];
  function cleanup(): void { offs.splice(0).forEach(f => { try { f(); } catch { /* já removido */ } }); if (o.signal) o.signal.removeEventListener("abort", onAbort); }
  function onAbort(): void { void providers.cancel(id); cleanup(); settleErr(STOP); }
  const mine = (e: { payload: unknown }): Record<string, unknown> | null => { const p = e.payload as { requestId?: string } | null; return p && p.requestId === id ? (p as Record<string, unknown>) : null; };
  offs.push((await T.event.listen("llm://token", e => { const p = mine(e); if (!p) return; text += String(p.delta ?? ""); if (o.onText) o.onText({ text }); })) as () => void);
  /* o uso que o provider reportou (ADR-0006, R2e1 — antes 0 de entrada e texto/4 de saída,
     inventados); anuncia-o para o `ctx` da barra de estado (features/codev.ts) */
  offs.push((await T.event.listen("llm://done", e => {
    const p = mine(e); if (!p) return; cleanup();
    const inputTokens = Number(p.inputTokens) || 0, outputTokens = Number(p.outputTokens) || 0;
    document.dispatchEvent(new CustomEvent("dx:llm-usage", { detail: { provider: k, input: inputTokens, output: outputTokens } }));
    settleOk({ text, provider: k, inputTokens, outputTokens });
  })) as () => void);
  offs.push((await T.event.listen("llm://error", e => { const p = mine(e); if (!p) return; cleanup(); settleErr(new Error(String(p.error ?? "erro do modelo"))); })) as () => void);
  if (o.signal) { if (o.signal.aborted) { onAbort(); return done; } o.signal.addEventListener("abort", onAbort); }
  const mode = R.root ? "project" : "study";
  void providers.chatStream({ messages: msgs, provider: prov, model: PROV[k].model, requestId: id, mode, stepId: o.step ?? null })
    .catch(e => { cleanup(); settleErr(e); });
  return done;
}
async function desktopSample(input: string | SampleMsg[], o: SampleOpts = {}) {
  const k = pickProv();
  // Chat de texto puro (sem ferramentas) → caminho de streaming real. O tool-loop agêntico
  // (write_file/run_tests/…) continua no llm_chat one-shot: é o protocolo co-dev, fora do
  // escopo desta sessão. STREAM_PROV cobre os quatro providers com adaptador SSE.
  if (!o.tools || !o.tools.length) {
    const msgs: { role: string; content: string }[] = typeof input === "string"
      ? [{ role: "user", content: input }]
      : input.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }));
    const r = await streamChat(k, msgs, o);
    try { use(k, r.inputTokens + r.outputTokens); } catch { /* sem contador de uso */ }
    return r;
  }
  // ── Protocolo de acção estruturada: streaming + ferramentas no MESMO canal ──
  // O tool-loop nativo (`llm_chat`) é one-shot por volta e não faz streaming. Para unir
  // streaming E ferramentas, o Co-Dev agêntico corre agora sobre `assistant_chat_stream`
  // (tokens ao vivo) e o modelo declara acções INLINE no texto, em blocos cercados que o
  // cliente analisa à medida que chegam e executa SEM parar o stream:
  //   ```dxcode path=<rel>\n<conteúdo completo do ficheiro>\n```   → corre a ferramenta write_file
  //   ```dxaction\n{"tool":"run_tests","input":{…}}\n```           → corre a ferramenta nomeada
  // Dentro de uma volta o texto à volta dos blocos faz stream ao vivo (onText) enquanto as
  // acções já detectadas correm. No fim da volta, se correu alguma acção, os resultados
  // voltam ao modelo numa mensagem de continuação (dxcontinue) e o stream recomeça — até
  // uma volta sem acções. É assim que streaming e ferramentas acontecem na mesma resposta.
  const tools = (o.tools || []).concat(o.tools ? extraTools() : []);
  const catalog = tools.map(t => `- ${t.name}: ${t.description || ""}`).join("\n");
  const directive =
    "És o Co-Dev do dxtutor a programar num projecto real. Além de explicares, podes AGIR sobre o " +
    "workspace emitindo blocos de acção cercados no meio da tua resposta — o texto à volta é mostrado " +
    "ao vivo ao programador. Formatos:\n" +
    "• Escrever/substituir um ficheiro inteiro (conteúdo COMPLETO, nunca um excerto):\n" +
    "```dxcode path=caminho/relativo.rs\n<conteúdo completo>\n```\n" +
    "• Correr uma ferramenta, com JSON numa só linha:\n" +
    "```dxaction\n{\"tool\":\"run_tests\",\"input\":{}}\n```\n" +
    "Um bloco por acção, com a cerca ``` no início da linha. Depois de eu te devolver os resultados " +
    "(dxcontinue), continua; quando terminares de vez, responde sem mais blocos. Ferramentas:\n" + catalog;
  const base: { role: string; content: string }[] = typeof input === "string"
    ? [{ role: "user", content: input }]
    : input.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }));
  const convo: { role: string; content: string }[] = [{ role: "system", content: directive }, ...base];

  const parsePath = (s: string): string => { const m = /path\s*=\s*"?([^"\n]+?)"?\s*$/.exec(s.trim()); return m ? m[1].trim() : ""; };
  const runAction = async (kind: string, head: string, body: string): Promise<string> => {
    try {
      if (kind === "code") {
        const path = parsePath(head);
        if (!path) return "dxcode sem path=";
        const wf = tools.find(t => t.name === "write_file");
        if (!wf) return "sem ferramenta write_file";
        const out = await wf.execute({ path, content: body });
        return `write_file ${path} → ${typeof out === "string" ? out : JSON.stringify(out)}`;
      }
      const spec = JSON.parse(body) as { tool?: string; input?: unknown };
      const t = tools.find(x => x.name === spec.tool);
      if (!t) return "ferramenta desconhecida: " + (spec.tool || "?");
      const out = await t.execute(spec.input || {});
      return `${spec.tool} → ${typeof out === "string" ? out : JSON.stringify(out)}`;
    } catch (e) { return "erro: " + ((e as Error) && (e as Error).message || e); }
  };

  let total = "", tin = 0, tout = 0;
  for (let round = 0; round < 16; round++) {
    if (o.signal && o.signal.aborted) throw STOP;
    let consumed = 0;
    const results: string[] = [];
    let acted = 0;
    let queue: Promise<unknown> = Promise.resolve();
    // Analisa o texto acumulado da volta e executa cada bloco COMPLETO uma única vez. Um
    // bloco ainda a chegar (sem cerca de fecho) não casa — esperamos pela volta seguinte.
    const onText = ({ text: acc }: { text: string }) => {
      if (o.onText) o.onText({ text: total + (total ? "\n\n" : "") + acc });
      const blocks = [...acc.matchAll(/^```dx(code|action)[ \t]*([^\n]*)\n([\s\S]*?)\n```[ \t]*$/gm)];
      for (let i = consumed; i < blocks.length; i++) {
        const [, kind, head, body] = blocks[i];
        acted++;
        queue = queue.then(async () => { results.push(await runAction(kind, head, body)); });
      }
      consumed = blocks.length;
    };
    const r = await streamChat(k, convo, { ...o, onText });
    await queue; // garante que toda a acção detectada terminou antes de continuar/sair
    tin += r.inputTokens; tout += r.outputTokens;
    total += (total ? "\n\n" : "") + r.text;
    if (!acted) break;
    convo.push({ role: "assistant", content: r.text });
    convo.push({ role: "user", content: "[dxcontinue] Resultados das acções:\n" + results.map((x, i) => `${i + 1}. ${x}`).join("\n") });
  }
  try { use(k, tin + tout); } catch { /* sem contador de uso */ }
  return { text: total, provider: k, inputTokens: tin, outputTokens: tout };
}
SAMPLE = desktopSample;
LIVE_OK = true;
/** UI prov-key → campo da config real (camelCase). Ollama não tem chave (é local). */
const CFG_FIELD: Record<string, "anthropicKey" | "openaiKey" | "geminiKey"> = { claude: "anthropicKey", codex: "openaiKey", gemini: "geminiKey" };
/* a porta desktop do Co-Dev (ADR-0004, U4h5): o codev.ts consulta-a no updateAgentUI/testProv que
   publica e o app.ts no provState/VIEW.settings — antes eram reatribuídos no `window`. Corpos
   iguais; a versão simulada chega como último argumento (o provState/testProv reais nunca a
   usaram; o updateAgentUI real deixa de passar argumentos à base, que não os lê). O SAMPLE e o
   LIVE_OK acima são estado que o desktop configura, não decorações. */
const codevLlm: CodevDesktop = {
provState(k) { return PROV[k].local ? "local" : R.keys[k] ? "live" : "no key"; },
updateAgentUI(_updateAgentUI) {
  _updateAgentUI();
  const n = $("#live-note");
  if (n) n.innerHTML = `<span class="tag live">desktop</span> free-form questions go to the selected model (${["claude", "codex", "gemini", "ollama"].filter(usable).map(k => PROV[k].name).join(", ") || "none configured — add a key in Settings"}), with access to the files of ${R.root ? "<b>" + escH(R.name) + "</b>" : "this workspace"}${R.root ? " and to the terminal" : ""}.`;
},
async testProv(k, btn) {
  btn.textContent = "testing…";
  const o = btn.parentElement!.querySelector(".pd")!;
  const P = PROV[k];
  try {
    const r = await providers.llmChat({ provider: k, endpoint: P.ep, model: P.model, messages: [{ role: "user", text: "Reply with the single word OK." }], maxTokens: 16 });
    o.innerHTML = `<span style="color:var(--green)">✓ ${escH(P.model)}</span> answered: ${escH(r.text.slice(0, 60))}`;
  } catch (e) { o.innerHTML = `<span style="color:var(--red)">✖</span> ${escH(String(e).slice(0, 240))}`; }
  btn.textContent = "Test connection";
},
settings(t, host, _settings) {
  _settings(t, host);
  /* A grelha dos provedores é a que tem campos de chave — NÃO a primeira .pgrid: o app.ts
     insere a secção «Language» (também .pgrid/.pcard) antes dela, e ligar pela posição
     deixava os campos de chave sem handler (colar a chave não gravava nada). Cada cartão
     identifica o seu provedor pelo data-on do «Testar ligação», não pela ordem. */
  const grid = [...host.querySelectorAll(".pgrid")].find((g: any) => g.querySelector("input[type=password]"));
  grid && grid.querySelectorAll(".pcard").forEach((cd: any) => {
    const k = (cd.querySelector('[data-action="test-prov"]') as HTMLElement | null)?.dataset.on ?? "";
    if (!PROV[k]) return;
    // Capacidades honestas do backend (streaming/cancel/disponível) por baixo de cada provider.
    const cap = PROVCAPS.find(c => c.id === STREAM_PROV[k]);
    const pd = cd.querySelector(".pd");
    if (pd && cap) pd.innerHTML = `<span class="tag ${cap.available ? "live" : ""}">${cap.available ? "disponível" : (PROV[k].local ? "inactivo" : "sem chave")}</span> ${[cap.streaming && "streaming", cap.cancel && "cancelável"].filter(Boolean).join(" · ")} — ${escH(cap.note)}`;
    const inp = cd.querySelector("input[type=password]");
    if (!inp || PROV[k].local) return;
    inp.placeholder = R.keys[k] ? "guardada ✓ — escreve para substituir" : "cola a chave da API";
    inp.onchange = async () => {
      const v = inp.value.trim();
      const field = CFG_FIELD[k];
      if (!field) return;
      try {
        const base: ProvidersConfig = CFG || (await providers.getConfig());
        await providers.saveConfig({ ...base, [field]: v });
        await loadKeys(); inp.value = "";
        toast(v ? PROV[k].name + ": chave guardada" : PROV[k].name + ": chave removida");
        show(cur); updateAgentUI();
      } catch (e) { toast("Não consegui guardar a chave: " + e); }
    };
  });
  const sub = host.querySelector(".sub");
  if (sub) sub.textContent = `App desktop ${R.info.version || ""} · as chaves vivem em ~/.config/dxtutor/providers.json (só legível por ti, 0600), ou lidas de ANTHROPIC_API_KEY, OPENAI_API_KEY e GEMINI_API_KEY. O streaming e o tool-loop lêem a mesma config.`;
},
};
Object.assign((desktopPorts.codev ??= {}), codevLlm);
/* sensible real model ids instead of the prototype's placeholders */
if (PROV.gemini.model === "gemini-pro") PROV.gemini.model = "gemini-2.5-flash";
if (PROV.codex.model === "gpt-codex") PROV.codex.model = "gpt-4.1";
ctx.loadKeys = loadKeys; ctx.desktopSample = desktopSample; ctx.provCaps = () => PROVCAPS;
}

const DX = (): Desktop => window.DXR as unknown as Desktop;
/* os botões que o desktop acrescenta chamam o `DXR` no acto (eram `onclick="DXR.…"` inline — ADR-0004, U5c) */
registerActions({ "desktop:approve": { click: (c) => { const [id, ok] = JSON.parse(c.on) as [string, boolean]; DX().approve!(id, ok); } } });
