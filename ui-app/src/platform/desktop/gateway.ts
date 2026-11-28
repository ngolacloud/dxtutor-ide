/* ═════════ dxtutor IDE — desktop: o gateway de IA da organização (fase B, a UI) ═════════
   A política é do Rust (`tutor_llm::gateway`, `llm_policy_status`): aqui só se mostra e se
   escolhe dentro dela. Funções puras (sem DOM, sem IPC) para o `llm.ts` ligar e os testes
   provarem: o aviso da política, que fornecedores ela deixa usar e a ordem a tentar, e o
   markup da secção das Definições. */
import type { LlmPolicy } from "../tauri/providers";
import type { GATEWAY_MESSAGES } from "./gateway-messages";

type Key = keyof (typeof GATEWAY_MESSAGES)["en"];
export type GatewayText = (key: Key, params?: Record<string, string | number>) => string;

/** Os fornecedores hospedados do protótipo (o `PROV`), pela ordem em que se tentam. */
const HOSTED = ["claude", "codex", "gemini"];

/** O que a pessoa pôs no `providers.json` (o URL e a API do seu próprio gateway). */
export interface GatewayOwn {
  url: string;
  api: string;
}

const who = (src: string, t: GatewayText): string => (src === "system" ? t("bySystem") : src === "project" ? t("byProject") : t("fromUser"));

/** As linhas do aviso, pela ordem: exigido (ou não), de onde vem o gateway, o que foi ignorado. */
export function policyLines(p: LlmPolicy, t: GatewayText): Array<{ kind: "warn" | "info" | "problem"; text: string }> {
  const out: Array<{ kind: "warn" | "info" | "problem"; text: string }> = [];
  if (p.requireGateway) {
    const by = p.requiredBy.length ? p.requiredBy.map((s) => who(s, t)).join(" + ") : t("bySystem");
    out.push({ kind: "warn", text: t("required", { who: by, local: p.allowLocal ? t("requiredLocal") : "" }) });
  } else {
    out.push({ kind: "info", text: t("notRequired") });
  }
  out.push({ kind: "info", text: p.gateway ? t("from", { who: who(p.gatewayFrom ?? "user", t) }) : t("none") });
  for (const text of p.problems) out.push({ kind: "problem", text: t("problem", { text }) });
  return out;
}

/** Se a política deixa usar o fornecedor `k` do protótipo (o Rust decide de novo em cada chamada). */
export function allowedBy(p: LlmPolicy | null, k: string): boolean {
  if (!p) return true;
  if (k === "gateway") return !!p.gateway;
  if (!p.requireGateway) return true;
  return k === "ollama" && p.allowLocal;
}

/** A ordem em que o chat escolhe um fornecedor utilizável: com o gateway exigido, ele primeiro
 *  (e o Ollama, se a política o deixa); senão a de sempre, com o gateway no fim. */
export function providerOrder(p: LlmPolicy | null): string[] {
  if (p?.requireGateway) return ["gateway", ...(p.allowLocal ? ["ollama"] : [])];
  return [...HOSTED, "ollama", ...(p?.gateway ? ["gateway"] : [])];
}

/** O markup da secção (vai antes da grelha dos fornecedores). Os controlos têm ids
 *  (`#gw-url`, `#gw-api`, `#gw-save`, `#gw-routes`, `#gw-route-list`) e o `llm.ts` liga-os por
 *  propriedade, como os campos de chave — nada de handlers inline (CSP). */
export function sectionHtml(p: LlmPolicy, own: GatewayOwn, t: GatewayText, esc: (s: string) => string): string {
  const locked = !!p.gateway && p.gatewayFrom !== null && p.gatewayFrom !== "user";
  const url = locked ? p.gateway!.url : own.url;
  const api = locked ? p.gateway!.api : own.api === "openai" ? "openai" : "anthropic";
  const lines = policyLines(p, t)
    .map((l) => `<div class="gw-l gw-${l.kind}"${l.kind === "warn" ? ' style="color:var(--yellow)"' : l.kind === "problem" ? ' style="color:var(--red)"' : ""}>${esc(l.text)}</div>`)
    .join("");
  const dis = locked ? " disabled" : "";
  const note = locked ? `<div class="pd">${esc(t("urlLocked", { who: who(p.gatewayFrom ?? "", t) }))}</div>` : "";
  return `<h2 id="gw-h">${esc(t("title"))}</h2><div class="pcard" id="gw-sec"><div class="pd">${esc(t("intro"))}</div>${lines}
    <div><label>${esc(t("url"))}</label><input id="gw-url" placeholder="https://ai.example.org" value="${esc(url)}"${dis}></div>
    <div><label>${esc(t("api"))}</label><select id="gw-api"${dis}><option value="anthropic"${api === "anthropic" ? " selected" : ""}>Anthropic Messages</option><option value="openai"${api === "openai" ? " selected" : ""}>OpenAI Chat Completions</option></select></div>${note}
    <div>${locked ? "" : `<button class="mini pri" id="gw-save">${esc(t("save"))}</button> `}${p.gateway ? `<button class="mini" id="gw-routes">${esc(t("routes"))}</button>` : ""}</div>
    <div class="pd" id="gw-route-list"></div><div class="pd">${esc(t("keyHint"))}</div></div>`;
}

/** Os botões das rotas (`data-on` = a rota; o `llm.ts` liga-os por propriedade). */
export function routesHtml(routes: string[], current: string, t: GatewayText, esc: (s: string) => string): string {
  if (!routes.length) return esc(t("routesNone"));
  return routes.map((r) => `<button class="mini${r === current ? " pri" : ""}" data-gw-route="${esc(r)}">${esc(r)}</button>`).join(" ");
}
