/* ═════════ cliente IPC: provedores de LLM e chat — ADR-0004, U2 ═════════
   Contratos de `get/save_providers_config`, `list_providers`, `llm_chat`,
   `assistant_chat_stream`, `assistant_cancel` (src-tauri/src/commands/assistant.rs, llm.rs). */
import { invoke, type Invoker } from "./core";

/** `assistant::ProvidersConfig` (~/.config/dxtutor/providers.json, serde camelCase). As
 *  chaves chegam mascaradas (hotfix de segurança); guardar uma máscara mantém a chave. */
export interface ProvidersConfig {
  provider: string;
  anthropicKey: string;
  anthropicWorkspaceId: string;
  openaiKey: string;
  geminiKey: string;
  ollamaHost: string;
  ollamaModel: string;
  assistantModel: string;
}

/** Capacidade honesta de cada provedor (RF-AG-06). */
export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  streaming: boolean;
  cancel: boolean;
  tools: boolean;
  context: boolean;
  note: string;
  models: string[];
}

export interface ChatMsg {
  role: string;
  content: string;
}

/** `llm::ChatReq` (serde camelCase) — o pedido directo, sem streaming. */
export interface LlmChatReq {
  provider: string;
  endpoint?: string;
  model: string;
  messages: Array<{ role: string; text: string }>;
  maxTokens?: number;
}

/** `llm::ChatResp` (serde camelCase). */
export interface LlmChatResp {
  text: string;
  toolCalls: unknown[];
  stop: string;
  inputTokens: number;
  outputTokens: number;
  origin?: string;
}

export const providersClient = (inv: Invoker = invoke) => ({
  getConfig: (): Promise<ProvidersConfig> => inv<ProvidersConfig>("get_providers_config"),
  saveConfig: (config: ProvidersConfig): Promise<void> => inv<void>("save_providers_config", { config }),
  list: (): Promise<ProviderInfo[]> => inv<ProviderInfo[]>("list_providers"),
  /** Pedido directo (o «Testar ligação» das Definições). */
  llmChat: (req: LlmChatReq): Promise<LlmChatResp> => inv<LlmChatResp>("llm_chat", { req }),
  /** Começa um chat em streaming; a resposta chega pelos eventos `llm://token|done|error`. */
  chatStream: (a: { messages: ChatMsg[]; provider: string; model: string; requestId: string; mode: string; stepId: string | null }): Promise<void> =>
    inv<void>("assistant_chat_stream", { messages: a.messages, provider: a.provider, model: a.model, requestId: a.requestId, mode: a.mode, stepId: a.stepId }),
  cancel: (requestId: string): Promise<void> => inv<void>("assistant_cancel", { requestId }),
});

export type ProvidersClient = ReturnType<typeof providersClient>;
