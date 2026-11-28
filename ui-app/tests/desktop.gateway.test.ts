/* O gateway de IA da organização na UI do desktop (fase B): o aviso da política, que fornecedores ela deixa
   usar e por que ordem, e a secção das Definições. A política em si é do Rust (`tutor_llm::gateway`). */
import { describe, expect, it } from "vitest";
import { allowedBy, policyLines, providerOrder, routesHtml, sectionHtml } from "../src/platform/desktop/gateway";
import { GATEWAY_MESSAGES } from "../src/platform/desktop/gateway-messages";
import type { LlmPolicy } from "../src/platform/tauri/providers";

const t = (k: keyof (typeof GATEWAY_MESSAGES)["en"], p: Record<string, string | number> = {}) =>
  GATEWAY_MESSAGES.en[k].replace(/\{(\w+)\}/g, (_a, n: string) => String(p[n] ?? ""));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const base: LlmPolicy = { requireGateway: false, allowLocal: true, gateway: null, gatewayFrom: null, requiredBy: [], problems: [] };
const org: LlmPolicy = {
  requireGateway: true,
  allowLocal: true,
  gateway: { url: "https://ai.bank.example", api: "openai" },
  gatewayFrom: "system",
  requiredBy: ["system"],
  problems: [],
};

describe("a política na UI", () => {
  it("sem política tudo é permitido e o gateway não existe", () => {
    expect(["claude", "codex", "gemini", "ollama"].every((k) => allowedBy(base, k))).toBe(true);
    expect(allowedBy(base, "gateway")).toBe(false);
    expect(allowedBy(null, "claude")).toBe(true);
    expect(providerOrder(base)).toEqual(["claude", "codex", "gemini", "ollama"]);
    expect(policyLines(base, t).map((l) => l.text)).toEqual([t("notRequired"), t("none")]);
  });

  it("com o gateway exigido só ele (e o Ollama local, se a política deixa) passa, e vem primeiro", () => {
    expect(allowedBy(org, "claude") || allowedBy(org, "codex") || allowedBy(org, "gemini")).toBe(false);
    expect(allowedBy(org, "gateway") && allowedBy(org, "ollama")).toBe(true);
    expect(providerOrder(org)).toEqual(["gateway", "ollama"]);
    const strict = { ...org, allowLocal: false };
    expect(allowedBy(strict, "ollama")).toBe(false);
    expect(providerOrder(strict)).toEqual(["gateway"]);
    const lines = policyLines(org, t);
    expect(lines[0]).toEqual({ kind: "warn", text: "Required by the organisation (/etc/dxtutor/llm.json): only the gateway and Ollama on this machine can be used." });
    expect(lines[1].text).toBe("Gateway set by the organisation (/etc/dxtutor/llm.json).");
  });

  it("um gateway da própria pessoa, não exigido, fica no fim da ordem; o que foi ignorado diz-se", () => {
    const mine: LlmPolicy = { ...base, gateway: { url: "https://mine.example", api: "anthropic" }, gatewayFrom: "user", problems: ["project gateway URL not trusted"] };
    expect(providerOrder(mine)).toEqual(["claude", "codex", "gemini", "ollama", "gateway"]);
    expect(policyLines(mine, t).map((l) => l.kind)).toEqual(["info", "info", "problem"]);
    expect(policyLines(mine, t)[2].text).toBe("Ignored: project gateway URL not trusted");
  });
});

describe("a secção das Definições", () => {
  it("o URL e a API são da pessoa e editáveis quando ninguém mais os define", () => {
    const html = sectionHtml(base, { url: "https://mine.example", api: "openai" }, t, esc);
    expect(html).toContain('id="gw-url" placeholder="https://ai.example.org" value="https://mine.example"');
    expect(html).toContain('<option value="openai" selected>');
    expect(html).toContain('id="gw-save"');
    expect(html).not.toContain('id="gw-routes"'); // sem gateway, nada para listar
    expect(html).not.toMatch(/\son[a-z]+=/); // nada inline (CSP)
  });

  it("um gateway da organização fecha os campos, mostra o dela e oferece as rotas", () => {
    const html = sectionHtml(org, { url: "https://mine.example", api: "anthropic" }, t, esc);
    expect(html).toContain('value="https://ai.bank.example" disabled');
    expect(html).toContain('<select id="gw-api" disabled><option value="anthropic">Anthropic Messages</option><option value="openai" selected>');
    expect(html).not.toContain("mine.example");
    expect(html).not.toContain('id="gw-save"');
    expect(html).toContain('id="gw-routes"');
    expect(html).toContain("set by the organisation (/etc/dxtutor/llm.json); your own URL is not used");
  });

  it("as rotas: a escolhida em destaque, escapadas; sem nenhuma, diz porquê", () => {
    expect(routesHtml(["support-chat", 'x"y'], "support-chat", t, esc)).toBe(
      '<button class="mini pri" data-gw-route="support-chat">support-chat</button> <button class="mini" data-gw-route="x&quot;y">x&quot;y</button>',
    );
    expect(routesHtml([], "", t, esc)).toBe(t("routesNone"));
  });
});
