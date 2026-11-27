import { afterEach, describe, expect, it } from "vitest";
import { canApprove, requestApproval } from "../src/app/approval";

/* r23 F1: o diálogo de aprovação partilhado — o comando exacto, onde corre, e a decisão do humano
 * (Cancelar/Esc/fora = recusa; o botão só acende com a palavra escrita e o motivo, quando pedidos). */

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const click = (s: string) => ($(s) as HTMLElement).click();
const type = (s: string, v: string) => { const el = $(s) as HTMLInputElement; el.value = v; el.dispatchEvent(new Event("input")); };

afterEach(() => { document.getElementById("approval")?.remove(); });

describe("canApprove", () => {
  it("palavra e motivo, só quando pedidos", () => {
    expect(canApprove({ title: "x", command: "c" }, "", "")).toBe(true);
    expect(canApprove({ title: "x", command: "c", confirmText: "web-1" }, "web", "")).toBe(false);
    expect(canApprove({ title: "x", command: "c", confirmText: "web-1" }, " web-1 ", "")).toBe(true);
    expect(canApprove({ title: "x", command: "c", reasonRequired: true }, "", "  ")).toBe(false);
    expect(canApprove({ title: "x", command: "c", reasonRequired: true }, "", "hotfix")).toBe(true);
  });
});

describe("requestApproval", () => {
  it("mostra o título, onde e o comando exacto (escapados) e aprova", async () => {
    const p = requestApproval({ title: "Roll <web> back", command: "kubectl rollout undo deploy/web && echo '<ok>'", scope: "context kind-dev · namespace shop" }, () => 42);
    expect($("#approval h2")?.textContent).toBe("Roll <web> back");
    expect($(".appr-cmd")?.textContent).toBe("kubectl rollout undo deploy/web && echo '<ok>'");
    expect($(".appr-cmd")?.innerHTML).toContain("&lt;ok&gt;");
    expect($(".appr-scope")?.textContent).toContain("context kind-dev · namespace shop");
    expect(($("#appr-ok") as HTMLButtonElement).disabled).toBe(false);
    click("#appr-ok");
    await expect(p).resolves.toEqual({ approved: true, reason: "", decidedAt: 42 });
    expect($("#approval")).toBeNull();
  });

  it("uma lista opcional (p.ex. os pacotes a descarregar) aparece antes do comando, escapada, com a nota", async () => {
    const p = requestApproval({ title: "Prepare", command: "pip install -r r.txt", list: { heading: "Packages", items: ["Django 5.2.19 · PyPI", "<evil> 1 · x"], note: "Exact <versions>." } });
    expect([...document.querySelectorAll(".appr-list li")].map(li => li.textContent)).toEqual(["Django 5.2.19 · PyPI", "<evil> 1 · x"]);
    expect($(".appr-list")?.innerHTML).toContain("&lt;evil&gt;");
    expect($(".appr-note")?.textContent).toBe("Exact <versions>.");
    const order = [...document.querySelectorAll("#approval h3, #approval .appr-cmd")].map(e => e.className || e.textContent);
    expect(order.indexOf("Packages")).toBeLessThan(order.indexOf("appr-cmd"));
    click("#appr-no");
    expect((await p).approved).toBe(false);
    requestApproval({ title: "t", command: "c" });
    expect($(".appr-list")).toBeNull();
    click("#appr-no");
  });

  it("Cancelar, Esc e clicar fora recusam", async () => {
    let p = requestApproval({ title: "t", command: "c" });
    click("#appr-no");
    expect((await p).approved).toBe(false);
    p = requestApproval({ title: "t", command: "c" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((await p).approved).toBe(false);
    p = requestApproval({ title: "t", command: "c" });
    click("#approval");
    expect((await p).approved).toBe(false);
  });

  it("o que apaga: botão vermelho, só acende com a palavra escrita e o motivo; o motivo volta na decisão", async () => {
    const p = requestApproval({ title: "Delete pod web-1", command: "kubectl delete pod web-1", destructive: true, confirmText: "web-1", reasonRequired: true });
    const ok = $("#appr-ok") as HTMLButtonElement;
    expect(ok.classList.contains("danger")).toBe(true);
    expect(ok.disabled).toBe(true);
    type("#appr-typed", "web-1");
    expect(ok.disabled).toBe(true);
    type("#appr-reason", "  stuck after OOM ");
    expect(ok.disabled).toBe(false);
    ok.click();
    await expect(p).resolves.toMatchObject({ approved: true, reason: "stuck after OOM" });
  });

  it("um pedido novo recusa o que estava aberto (nunca há dois)", async () => {
    const first = requestApproval({ title: "a", command: "1" });
    const second = requestApproval({ title: "b", command: "2" });
    expect((await first).approved).toBe(false);
    expect(document.querySelectorAll("#approval")).toHaveLength(1);
    expect($("#approval h2")?.textContent).toBe("b");
    click("#appr-ok");
    expect((await second).approved).toBe(true);
  });
});

describe("o cliente do audit_record", () => {
  it("envia a pasta e a linha tal como o backend a espera", async () => {
    const { auditClient } = await import("../src/platform/tauri/audit");
    const { tauriAudit } = await import("../src/features/ops/infrastructure/tauri");
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const inv = (async (cmd: string, args?: Record<string, unknown>) => { calls.push([cmd, args]); return undefined; }) as never;
    await auditClient(inv).record("/proj", { feature: "ops", action: "kube.undo", command: "kubectl x", approved: true });
    await tauriAudit(() => "/proj", inv).record({ action: "kube.exec", command: "kubectl y", scope: "", approved: false, reason: "", decidedAt: 5 });
    expect(calls).toEqual([
      ["audit_record", { root: "/proj", entry: { feature: "ops", action: "kube.undo", command: "kubectl x", approved: true } }],
      ["audit_record", { root: "/proj", entry: { feature: "ops", action: "kube.exec", command: "kubectl y", scope: undefined, approved: false, reason: undefined, decidedAt: 5, outcome: undefined } }],
    ]);
    await expect(tauriAudit(() => null, inv).record({ action: "a", command: "c", scope: "", approved: true, reason: "", decidedAt: 1 })).rejects.toThrow();
  });
});
