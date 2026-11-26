/* ═══════════ Co-Dev — o mapa de agentes ═══════════
   A app real num browser real, em modo desktop, contra um backend guionado: um `window.__TAURI__`
   falso responde ao arranque e joga um turno do agente como o `codev_agent.rs` o emite — dois
   sub-agentes (`task`) com o progresso deles (`{kind: "subagent", call, step}`) — e uma segunda
   sessão (o Co-Dev de uma issue, como numa sprint) que o `codev_agent_live` lista. Prova: o chip
   conta os agentes a trabalhar, o mapa liga a conversa aos agentes, o detalhe mostra o pedido, as
   ferramentas e os tokens, e o Esc fecha. Os textos aceitam as duas línguas. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  const agent = (session: string, event: unknown) => emit("codev-agent://event", { session, event });
  const usage = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

  function turn(session: string): void {
    agent(session, { kind: "stream", event: { type: "message_start", model: "claude-opus-5-5" } });
    agent(session, { kind: "stream", event: { type: "text_delta", index: 0, text: "Vou mapear o lexer e os testes em paralelo." } });
    agent(session, { kind: "usage", request: usage(12_000, 900), turn: usage(12_000, 900) });
    agent(session, { kind: "tool_start", id: "t1", name: "task", input: { description: "Co-Dev tokens phase 1", prompt: "Mapeia onde se contam os tokens do Co-Dev.", role: "explorer" } });
    agent(session, { kind: "tool_start", id: "t2", name: "task", input: { description: "Testes do lexer", prompt: "Lista os testes do lexer e o que falta.", role: "tester" } });
    agent(session, { kind: "subagent", call: "t1", step: { type: "started", role: "explorer" } });
    agent(session, { kind: "subagent", call: "t1", step: { type: "tool_start", id: "g1", name: "grep", input: { pattern: "formatUsage" } } });
    agent(session, { kind: "subagent", call: "t1", step: { type: "tool_result", id: "g1", name: "grep", is_error: false } });
    agent(session, { kind: "subagent", call: "t1", step: { type: "tool_start", id: "r1", name: "read", input: { path: "ui-app/src/features/codev/domain/pricing.ts" } } });
    agent(session, { kind: "subagent", call: "t1", step: { type: "usage", turn: usage(200_000, 70_500) } });
    agent(session, { kind: "subagent", call: "t2", step: { type: "started", role: "tester" } });
    agent(session, { kind: "subagent", call: "t2", step: { type: "usage", turn: usage(31_000, 2_400) } });
    agent(session, { kind: "tool_result", id: "t2", name: "task", is_error: false, content: "Há 14 testes em lexer.rs; faltam os casos de unicode.\n\n[sub-agente: 6 mensagens, 31000 tokens de entrada, 2400 de saída]" });
    // a outra sessão (o Co-Dev da issue DX-12) também trabalha
    agent("S2", { kind: "stream", event: { type: "message_start", model: "claude-sonnet-5-5" } });
    agent("S2", { kind: "tool_start", id: "t9", name: "task", input: { description: "Rever o diff da DX-12", prompt: "Revê as alterações em curso.", role: "reviewer" } });
    agent("S2", { kind: "subagent", call: "t9", step: { type: "usage", turn: usage(8_000, 600) } });
  }

  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", configDir: "/home/e2e/.config/dxtutor", openAtStart: "/proj" };
      case "exec": {
        const program = String(args.program);
        if (program === "whoami") return { code: 0, stdout: "e2e\n", stderr: "" };
        if (program === "hostname") return { code: 0, stdout: "host\n", stderr: "" };
        return { code: 128, stdout: "", stderr: "not a git repository" };
      }
      case "load_workspace":
        return { root: "/proj", name: "proj", files: [{ path: "src/lib.rs", content: "fn main() {}\n" }], skipped: 0, truncated: false };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
        return [];
      case "codev_agent_start":
        return "S1";
      case "codev_agent_send":
        setTimeout(() => turn(String(args.sessionId)), 50);
        return null;
      case "codev_agent_live":
        return [
          { id: "S1", root: "/proj", model: "claude-opus-5-5", issue: null, busy: true, opened: Date.now() - 60_000 },
          { id: "S2", root: "/proj", model: "claude-sonnet-5-5", issue: "DX-12", busy: true, opened: Date.now() - 30_000 },
        ];
      case "keys_status":
        return {};
      default:
        return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (event: string, h: Handler) => {
        (listeners[event] ||= []).push(h);
        return () => (listeners[event] = (listeners[event] || []).filter((x) => x !== h));
      },
    },
  };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/lib.rs")));
}

test("the chip counts the working agents and opens the Agent map", async ({ page }) => {
  await page.clock.install();
  await boot(page);
  const input = page.locator("#ag-input");
  await input.click();
  await input.fill("onde se contam os tokens?");
  await input.press("Enter");

  // t1 (S1) + t9 (S2) still running, and the DX-12 session itself: 3 working
  await expect(page.locator("#cc-agents .cc-agl")).toHaveText(/^3 (agents|agentes)$/);
  await page.clock.fastForward("10:16");
  await page.locator("#cc-agents").click();

  const map = page.locator("#agent-map");
  await expect(map).toBeVisible();
  await expect(map.locator(".agmap-sub-h")).toHaveText(/^4 (agents · click an agent for details|agentes · clica num agente para ver os detalhes) · 3 (working|a trabalhar)$/);
  await expect(map.locator(".agmap-rootcol .agmap-card")).toContainText("Co-Dev");
  const t1 = map.locator('[data-on="a:S1:t1"]');
  await expect(t1).toContainText("Co-Dev tokens phase 1");
  // o relógio continua a andar depois do salto: 10m 16s, ou um segundo ou dois a mais
  await expect(t1).toContainText(/10m 1\ds · 270\.5k tokens/);
  await expect(t1.locator(".cc-dot")).toHaveClass(/live/);
  await expect(map.locator('[data-on="a:S1:t2"] .cc-dot')).toHaveClass(/done/);
  await expect(map.locator('[data-on="s:S2"]')).toContainText("Co-Dev · DX-12");
  await expect(map.locator('.agmap-sub [data-on="a:S2:t9"]')).toContainText("Rever o diff da DX-12");
  await page.screenshot({ path: test.info().outputPath("agent-map.png") });

  await t1.click();
  const detail = map.locator(".agmap-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Mapeia onde se contam os tokens do Co-Dev.");
  await expect(detail).toContainText("pricing.ts");
  await expect(detail).toContainText("$2.21");
  await page.screenshot({ path: test.info().outputPath("agent-map-detail.png") });

  await page.keyboard.press("Escape");
  await expect(map).toHaveCount(0);
});
