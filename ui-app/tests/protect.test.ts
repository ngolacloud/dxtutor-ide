import { describe, expect, it } from "vitest";
import { BLOCKED, filesOf, findingLines, parseBlocked, type ScanReport } from "../src/features/protect/domain/report";
import { makeProtect } from "../src/features/protect/application/protect-service";
import type { ProtectDeps } from "../src/features/protect/application/ports";
import { tauriProtect } from "../src/features/protect/infrastructure/tauri";

/* r23 F4a (docs/v2/AUDIT-r23.md §4.4, X02/X03): a protecção de dados na UI — o relatório do secret scan
 * que o backend devolve num commit bloqueado, o diálogo que pede um motivo (auditado ANTES da excepção e com o
 * resultado), a recusa em palavras, e a contagem do que a redacção tirou dos pedidos aos modelos. */

const REPORT: ScanReport = { tool: "built-in", files: 2, findings: [{ file: "db.rs", line: 1, rule: "url-credentials", preview: "const URL = \"postgres://u:••••@h/app\";" }, { file: ".env", line: 0, rule: "env-file", preview: "" }] };
const blockedError = () => new Error(`git commit: ${BLOCKED}${JSON.stringify(REPORT)}`);

describe("domínio", () => {
  it("lê o relatório de dentro do erro e escreve os achados", () => {
    expect(parseBlocked(blockedError().message)).toEqual(REPORT);
    expect(parseBlocked("git commit: nothing to commit")).toBeNull();
    expect(parseBlocked(`${BLOCKED}{not json`)).toBeNull();
    expect(findingLines(REPORT)).toEqual(["db.rs:1 (url-credentials) — const URL = \"postgres://u:••••@h/app\";", ".env (env-file)"]);
    expect(findingLines({ ...REPORT, findings: Array(10).fill(REPORT.findings[1]) }, 3)).toHaveLength(4);
    expect(filesOf(REPORT)).toEqual(["db.rs", ".env"]);
  });
});

function harness(answer: { approved: boolean; reason: string }) {
  const log: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const asked: Array<Record<string, unknown>> = [];
  const deps: ProtectDeps = {
    protect: {
      learn: async (r) => { log.push(`learn ${r}`); return 3; },
      scan: async () => REPORT,
      allow: async (r, why) => { log.push(`allow ${r} ${why}`); },
    },
    approval: { approve: async (r) => { asked.push(r); log.push("approve"); return { ...answer, decidedAt: 7 }; } },
    audit: { record: async (_r, e) => { audits.push(e); log.push(`audit ${e.approved}${e.outcome ? " " + e.outcome : ""}`); } },
    root: () => "/w",
    toast: () => undefined,
    copy: (k, p) => (p ? `${k}:${Object.values(p).join("|")}` : k),
  };
  return { p: makeProtect(deps), log, audits, asked };
}

describe("o serviço", () => {
  it("um commit bloqueado: pergunta com o motivo, audita antes da excepção, repete e audita o resultado", async () => {
    const h = harness({ approved: true, reason: "fixture, not a real database" });
    let n = 0;
    const out = await h.p.guard(async () => { n++; if (n === 1) throw blockedError(); log(); return "abc123"; });
    function log() { h.log.push("commit"); }
    expect(out).toBe("abc123");
    expect(h.log).toEqual(["approve", "audit true sent", "allow /w fixture, not a real database", "commit", "audit true ok"]);
    expect(h.asked[0]).toMatchObject({ title: "blockedTitle:2", reasonRequired: true, destructive: true, scope: "blockedScope:built-in|/w" });
    expect(String(h.asked[0].command)).toContain("db.rs:1 (url-credentials)");
    expect(h.audits[0]).toMatchObject({ feature: "protect", action: "secret-scan.override", reason: "fixture, not a real database" });
  });

  it("recusado: audita a recusa e o erro diz o que foi encontrado, sem o JSON", async () => {
    const h = harness({ approved: false, reason: "" });
    const e = await h.p.guard(async () => { throw blockedError(); }).catch((x: Error) => x);
    expect(e.message).toBe("refused:db.rs:1 (url-credentials) — const URL = \"postgres://u:••••@h/app\";, .env (env-file)");
    expect(e.message).not.toContain(BLOCKED);
    expect(h.log).toEqual(["approve", "audit false"]);
  });

  it("outro erro passa como veio; a contagem da redacção e a pasta aberta", async () => {
    const h = harness({ approved: true, reason: "x" });
    await expect(h.p.guard(async () => { throw new Error("git commit: nothing to commit"); })).rejects.toThrow("nothing to commit");
    expect(h.asked).toHaveLength(0);
    let seen = 0;
    h.p.subscribe(() => { seen++; });
    await h.p.workspaceOpened("/w");
    expect(h.p.total()).toBe(3);
    h.p.redacted("codev", 2, 5);
    expect(h.p.total()).toBe(5);
    expect(h.audits.at(-1)).toMatchObject({ feature: "protect", action: "redact", scope: "codev", command: "2 secret(s) removed from a codev request" });
    h.p.redacted("assistant", 0, 5);
    expect(h.audits).toHaveLength(1); /* um pedido sem segredos não vai para o registo */
    expect(seen).toBe(3);
  });
});

describe("o adaptador Tauri", () => {
  it("os três comandos", async () => {
    const seen: Array<[string, unknown]> = [];
    const port = tauriProtect(async (cmd: string, args?: unknown) => { seen.push([cmd, args]); return null as never; });
    await port.learn("/w");
    await port.scan("/w", "paths", ["a.rs"]);
    await port.scan("/w");
    await port.allow("/w", "why");
    expect(seen).toEqual([
      ["protect_learn", { root: "/w" }],
      ["secret_scan", { root: "/w", scope: "paths", paths: ["a.rs"] }],
      ["secret_scan", { root: "/w", scope: null, paths: null }],
      ["secret_scan_allow", { root: "/w", reason: "why" }],
    ]);
  });
});
