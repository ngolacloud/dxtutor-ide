/* ═══════════ feature `ops` — domain: the Platform activity's shapes (r23 F5b; tutor_platform::queue/review,
   tutor_board::project::incidents). serde camelCase. PURE. */
export interface QueueItem { id: string; kind: string; title: string; why: string; action: string; arg: string; line: number; done: boolean; proof: string | null }
export interface QueueEvent { id: number; item: string; kind: "done" | "handover"; title: string; proof: string | null; recipient: string | null; reason: string | null; actor: string; at: number }
export interface Queue { me: { name: string; email: string; gh: string | null }; items: QueueItem[]; done: QueueEvent[]; team: QueueEvent[]; measured: Array<[string, string]>; missing: string[] }
export type CheckStatus = "ok" | "failed" | "pending" | "not_installed" | "not_connected" | "skipped";
export interface ReviewCheck { id: string; status: CheckStatus; summary: string; source: string }
export interface PrReview { number: number; title: string; url: string; author: string; head: string; base: string; headSha: string; files: string[]; diff: string; checks: ReviewCheck[]; failing: string[] }
export interface Incident { id: number; key: string; title: string; severity: string; status: "investigating" | "mitigated" | "resolved"; commander: string; openedAt: number; mitigatedAt: number | null; resolvedAt: number | null }
export interface IncidentEvent { id: number; kind: string; text: string; reason: string | null; actor: string; at: number }
export interface IncidentView { incident: Incident; events: IncidentEvent[]; confidence: { level: "low" | "medium" | "high"; reasons: string[] }; precision: [number, number] }

/** A postmortem draft's facts, for Co-Dev to write (a proposal in the editor). */
export function timelineText(v: IncidentView): string {
  const t = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(0, 16);
  const i = v.incident;
  return [`${i.key} ${i.title} (${i.severity}) — ${i.status}; commander ${i.commander}; opened ${t(i.openedAt)}${i.resolvedAt ? `, resolved ${t(i.resolvedAt)}` : ""}`, ...v.events.map((e) => `${t(e.at)} ${e.actor} ${e.kind}: ${e.text}${e.reason ? ` (${e.reason})` : ""}`)].join("\n");
}
