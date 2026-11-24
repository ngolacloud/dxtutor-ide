/* ═════════ Co-Dev — erros dos provedores de modelos (domínio puro) ═════════
   O backend devolve os erros dos provedores tal-e-qual ("Anthropic returned 400: {json}",
   "OpenAI returned 429: …", "No API key for claude…"). Aqui reconhecem-se os casos que o
   humano consegue resolver — sem créditos, chave inválida, limite de pedidos, serviço
   sobrecarregado, modelo inexistente, sem rede — e dá-se-lhes uma explicação e o passo
   seguinte. O texto original fica disponível como detalhe. Sem DOM, sem window. */

export type ProviderErrorKind = "credit" | "auth" | "nokey" | "rate" | "overloaded" | "model" | "network";

export interface ProviderError {
  kind: ProviderErrorKind;
  /** Nome legível do provedor ("Claude (Anthropic)", "OpenAI", …), ou null se não se sabe. */
  provider: string | null;
  title: string;
  hint: string;
  /** Página do provedor onde se resolve (facturação / chaves), quando há uma. */
  url: string | null;
  /** Mensagem do provedor (o `message` do JSON, se houver), para o detalhe. */
  detail: string;
}

interface ProviderInfo {
  name: string;
  billing: string;
  keys: string;
}

const PROVIDERS: Record<string, ProviderInfo> = {
  anthropic: { name: "Claude (Anthropic)", billing: "https://console.anthropic.com/settings/billing", keys: "https://console.anthropic.com/settings/keys" },
  openai: { name: "OpenAI", billing: "https://platform.openai.com/settings/organization/billing", keys: "https://platform.openai.com/api-keys" },
  gemini: { name: "Gemini", billing: "https://aistudio.google.com/apikey", keys: "https://aistudio.google.com/apikey" },
  ollama: { name: "Ollama", billing: "", keys: "" },
};

/** Que provedor fala na mensagem ("Anthropic returned", "claude returned", "No API key for codex", …). */
function providerOf(msg: string): string | null {
  const m = msg.toLowerCase();
  if (/\banthropic\b|\bclaude\b/.test(m)) return "anthropic";
  if (/\bopenai\b|\bcodex\b|\bgpt\b/.test(m)) return "openai";
  if (/\bgemini\b|\bgoogle\b/.test(m)) return "gemini";
  if (/\bollama\b/.test(m)) return "ollama";
  return null;
}

/** O `message` do JSON de erro do provedor, se a mensagem trouxer um; senão a própria mensagem. */
function innerMessage(msg: string): string {
  const at = msg.indexOf("{");
  if (at >= 0) {
    try {
      const v = JSON.parse(msg.slice(at)) as { error?: { message?: unknown } | string; message?: unknown };
      const e = v.error;
      const inner = typeof e === "string" ? e : e && typeof e.message === "string" ? e.message : typeof v.message === "string" ? v.message : null;
      if (inner) return inner;
    } catch {
      /* JSON truncado (o llm_chat corta a 400 caracteres): usa a mensagem tal-e-qual */
    }
  }
  return msg.trim();
}

/** Código HTTP: "Anthropic returned 400: …" (tutor-llm / llm_chat) ou "HTTP 401 (kind): …" (agente). */
function statusOf(msg: string): number | null {
  const m = /\b(?:returned|HTTP) (\d{3})\b/.exec(msg);
  return m ? parseInt(m[1], 10) : null;
}

/** Id de provedor do Co-Dev ("claude", "codex", "gemini", "ollama") → chave desta tabela. */
const FROM_UI: Record<string, string> = { claude: "anthropic", codex: "openai", gemini: "gemini", ollama: "ollama" };

/** Reconhece um erro de provedor que o humano pode resolver; null para os restantes.
 *  `active` (o provedor seleccionado no Co-Dev) identifica o provedor quando a mensagem não
 *  o diz — o agente formata "HTTP 401 (authentication_error): …" sem o nome. */
export function explainProviderError(msg: string, active?: string | null): ProviderError | null {
  if (!msg) return null;
  const pid = providerOf(msg) ?? (active ? FROM_UI[active] ?? null : null);
  const p = pid ? PROVIDERS[pid] : null;
  const who = p?.name ?? "O provedor";
  const status = statusOf(msg);
  const detail = innerMessage(msg);
  const t = msg.toLowerCase();
  const alt = "Entretanto podes escolher outro provedor no Co-Dev, ou um modelo local com o Ollama (sem custos).";

  if (/credit balance is too low|insufficient[_ ]quota|exceeded your current quota|billing|payment required|purchase credits/.test(t) || status === 402) {
    return {
      kind: "credit",
      provider: p?.name ?? null,
      title: `${who}: a conta da API não tem créditos.`,
      hint: `A chave é válida, mas a conta não tem saldo (o uso da API é pago à parte de uma subscrição do chat). Compra créditos na página de facturação do provedor e tenta de novo daqui a alguns minutos. ${alt}`,
      url: p?.billing || null,
      detail,
    };
  }
  if (/^no api key for|sem chave/.test(t)) {
    return {
      kind: "nokey",
      provider: p?.name ?? null,
      title: `${who}: falta a chave da API.`,
      hint: "Cola a chave em Definições → Modelos e provedores (e carrega Enter), ou define a variável de ambiente antes de abrir a app.",
      url: p?.keys || null,
      detail,
    };
  }
  if (status === 401 || status === 403 || /authentication_error|invalid x-api-key|invalid api key|incorrect api key|api_key_invalid|permission_error/.test(t)) {
    return {
      kind: "auth",
      provider: p?.name ?? null,
      title: `${who}: a chave da API foi recusada.`,
      hint: "A chave está errada, foi revogada ou não tem acesso a este modelo. Gera uma nova na consola do provedor e cola-a em Definições → Modelos e provedores.",
      url: p?.keys || null,
      detail,
    };
  }
  if (status === 429 || /rate_limit|rate limit|too many requests|resource_exhausted/.test(t)) {
    return {
      kind: "rate",
      provider: p?.name ?? null,
      title: `${who}: limite de pedidos atingido.`,
      hint: `Espera um pouco e tenta de novo. ${alt}`,
      url: null,
      detail,
    };
  }
  if (status === 529 || status === 503 || /overloaded/.test(t)) {
    return {
      kind: "overloaded",
      provider: p?.name ?? null,
      title: `${who}: o serviço está sobrecarregado.`,
      hint: `Não é um problema teu — tenta de novo daqui a pouco. ${alt}`,
      url: null,
      detail,
    };
  }
  if (status === 404 || /not_found_error|model.*(not found|does not exist)|unknown model/.test(t)) {
    return {
      kind: "model",
      provider: p?.name ?? null,
      title: `${who}: o modelo pedido não existe ou não está disponível para esta conta.`,
      hint: "Escolhe outro modelo no Co-Dev ou em Definições → Modelos e provedores.",
      url: null,
      detail,
    };
  }
  if (/could not reach|error sending request|dns error|connection refused|timed out|network/.test(t)) {
    return {
      kind: "network",
      provider: p?.name ?? null,
      title: `${who}: não consegui chegar ao serviço.`,
      hint: pid === "ollama" ? "Confirma que o Ollama está a correr (ollama serve) e que tem um modelo (ollama pull qwen3)." : "Confirma a ligação à internet (ou o proxy) e tenta de novo.",
      url: null,
      detail,
    };
  }
  return null;
}
