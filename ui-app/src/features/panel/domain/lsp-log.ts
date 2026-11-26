/* ═════════ feature `panel` — o registo dos servidores de linguagem no Output (LSP P6) ═════════
   O backend guarda, por servidor, o stderr e o `window/logMessage` (mascarados) e o que lhe aconteceu
   (arrancou, parou e porquê, morreu); manda cada linha pelo `lsp://log` e devolve-as todas pelo
   `lsp_server_log` (a interface recarrega ao mudar de língua). Aqui, as regras PURAS: o texto de cada linha
   no canal «Language servers» (os eventos na língua da interface, por código) e juntar o que se leu com o que
   se ouve sem repetir nem perder linhas (pelo `seq`). */

import type { OutputLevel } from "./types";

/** `lifecycle::LogLine` (camelCase). */
export interface LspLogLine {
  seq: number;
  at: number;
  key: string;
  server: string;
  root: string;
  kind: "stderr" | "log" | "event";
  text: string;
  code: string | null;
  detail: Record<string, unknown> | null;
}

/** O canal do Output (o progresso de indexação, `lsp://status`, também vai para ele). */
export const LSP_CHANNEL = "Language servers";

export type LspLogKey =
  | "started"
  | "stopped"
  | "killed"
  | "crashed"
  | "crashedCode"
  | "overLimit"
  | "why.idle"
  | "why.limit"
  | "why.user"
  | "why.restart"
  | "why.folder"
  | "why.config"
  | "why.app-exit"
  | "why.replaced"
  | "why.failed";
export type LspLogCopy = (key: LspLogKey, params?: Record<string, string | number>) => string;

const REASONS = new Set(["idle", "limit", "user", "restart", "folder", "config", "app-exit", "replaced", "failed"]);

/** O nome da pasta (o último segmento), para a linha não ficar enorme. */
function folderName(root: string): string {
  const parts = root.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || root;
}

/** O texto da linha no canal: `[rust-analyzer · proj] …`. Um evento sai na língua da interface (pelo código);
 *  um código desconhecido fica com o texto do backend. */
export function lspLogText(l: LspLogLine, copy: LspLogCopy): string {
  const head = `[${l.server} · ${folderName(l.root)}] `;
  if (l.kind !== "event" || !l.code) return head + l.text;
  const d = l.detail ?? {};
  const reason = typeof d.reason === "string" && REASONS.has(d.reason) ? copy(`why.${d.reason}` as LspLogKey) : "";
  switch (l.code) {
    case "started":
      return head + copy("started", { pid: typeof d.pid === "number" ? d.pid : "?" });
    case "stopped":
      return head + copy("stopped", { why: reason });
    case "killed":
      return head + copy("killed", { why: reason });
    case "crashed":
      return head + (typeof d.exitCode === "number" ? copy("crashedCode", { code: d.exitCode }) : copy("crashed"));
    case "over-limit":
      return head + copy("overLimit", { running: Number(d.running ?? 0), max: Number(d.max ?? 0) });
    default:
      return head + l.text;
  }
}

/** O nível no Output: um servidor que morreu ou teve de ser morto é um erro; o resto, informação. */
export function lspLogLevel(l: LspLogLine): OutputLevel {
  if (l.kind === "event") return l.code === "crashed" || l.code === "killed" ? "error" : l.code === "over-limit" ? "warn" : "info";
  return l.kind === "log" && l.text.startsWith("[error]") ? "error" : "info";
}

/** Junta o registo lido (`lsp_server_log`) com as linhas que chegaram entretanto: cada `seq` uma vez, por ordem;
 *  devolve as linhas novas e o último `seq` visto. */
export function newLines(lines: readonly LspLogLine[], seen: number): { fresh: LspLogLine[]; seen: number } {
  const by = new Map<number, LspLogLine>();
  for (const l of lines) if (l.seq > seen) by.set(l.seq, l);
  const fresh = [...by.values()].sort((a, b) => a.seq - b.seq);
  return { fresh, seen: fresh.length ? fresh[fresh.length - 1].seq : seen };
}
