import { describe, expect, it } from "vitest";
import { explainProviderError } from "../src/features/codev/domain/provider-errors";
import { providerErrorHtml, providerErrorText } from "../src/features/codev/ui/chat-view";

const ANTHROPIC_CREDIT =
  'Anthropic returned 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011ChLYcBFN8gjGbfrMTgBQv"}';

describe("erros dos provedores", () => {
  it("sem créditos na Anthropic (a resposta real): explica e aponta para a facturação", () => {
    const e = explainProviderError(ANTHROPIC_CREDIT)!;
    expect(e).toMatchObject({ kind: "credit", provider: "Claude (Anthropic)", url: "https://console.anthropic.com/settings/billing" });
    expect(e.detail).toBe("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.");
    expect(providerErrorText(e).hint).toContain("Ollama");
  });

  it("quota esgotada na OpenAI (429 insufficient_quota) é crédito, não limite de pedidos", () => {
    const e = explainProviderError('OpenAI returned 429: {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}')!;
    expect(e.kind).toBe("credit");
    expect(e.provider).toBe("OpenAI");
  });

  it("chave recusada, sem chave, limite, sobrecarga, modelo e rede", () => {
    expect(explainProviderError('Anthropic returned 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')?.kind).toBe("auth");
    expect(explainProviderError("No API key for claude. Add it in Settings → Models and providers, or set ANTHROPIC_API_KEY.")).toMatchObject({ kind: "nokey", provider: "Claude (Anthropic)" });
    expect(explainProviderError("sem chave da Anthropic: guarda-a em Definições → Modelos e provedores, ou define ANTHROPIC_API_KEY")?.kind).toBe("nokey");
    expect(explainProviderError('Anthropic returned 429: {"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}')?.kind).toBe("rate");
    expect(explainProviderError('Anthropic returned 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')?.kind).toBe("overloaded");
    expect(explainProviderError('Anthropic returned 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}')?.kind).toBe("model");
    expect(explainProviderError("Could not reach Anthropic: dns error")?.kind).toBe("network");
    expect(providerErrorText(explainProviderError("Ollama returned 500: connection refused")!).hint).toContain("ollama serve");
  });

  it("o erro do agente (HTTP 401, sem nome) usa o provedor activo do Co-Dev", () => {
    const e = explainProviderError("HTTP 401 (authentication_error): invalid x-api-key", "claude")!;
    expect(e).toMatchObject({ kind: "auth", provider: "Claude (Anthropic)", url: "https://console.anthropic.com/settings/keys" });
    expect(explainProviderError("HTTP 400 (invalid_request_error): Your credit balance is too low to access the Anthropic API.", "claude")?.kind).toBe("credit");
    expect(explainProviderError("HTTP 429 (rate_limit_error): slow down", "codex")).toMatchObject({ kind: "rate", provider: "OpenAI" });
    // a mensagem manda: se diz «Anthropic», não importa o provedor activo
    expect(explainProviderError("Anthropic returned 401: x", "gemini")?.provider).toBe("Claude (Anthropic)");
  });

  it("JSON truncado (llm_chat corta a 400 caracteres) não rebenta e ainda classifica", () => {
    const e = explainProviderError('claude returned 400 Bad Request: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to acc');
    expect(e?.kind).toBe("credit");
  });

  it("erros desconhecidos ficam como estão", () => {
    expect(explainProviderError("boom")).toBeNull();
    expect(explainProviderError("")).toBeNull();
    expect(providerErrorHtml("boom <x>")).toBe("Could not get an answer from the model (boom &lt;x&gt;).");
  });

  it("o cartão tem título, passo seguinte, botão das Definições e o detalhe escapado", () => {
    const h = providerErrorHtml(ANTHROPIC_CREDIT);
    expect(h).toContain("<b>Claude (Anthropic): the API account has no credits.</b>");
    expect(h).toContain("https://console.anthropic.com/settings/billing");
    expect(h).toContain('data-action="open-settings"');
    expect(h).toContain("<summary>Details</summary>");
    expect(h).not.toContain("request_id");
  });

  it("em ptAO o cartão sai em português, com os textos de antes", () => {
    const w = window as unknown as { LOCALE?: string };
    const prev = w.LOCALE;
    w.LOCALE = "ptAO";
    try {
      const h = providerErrorHtml(ANTHROPIC_CREDIT);
      expect(h).toContain("<b>Claude (Anthropic): a conta da API não tem créditos.</b>");
      expect(h).toContain("Resolve aqui: <code>https://console.anthropic.com/settings/billing</code>");
      expect(h).toContain("<summary>Detalhes</summary>");
      expect(providerErrorText(explainProviderError("Could not reach Anthropic: dns error")!).title).toBe("Claude (Anthropic): não consegui chegar ao serviço.");
      expect(providerErrorText(explainProviderError("HTTP 429 (rate_limit_error): slow down")!).title).toBe("O provedor: limite de pedidos atingido.");
    } finally {
      w.LOCALE = prev;
    }
  });
});
