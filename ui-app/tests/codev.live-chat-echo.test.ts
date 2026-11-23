// Fallback do agente v2 (F8): quando o modelo não tem tool calling, a mensagem é
// reenviada pelo harness antigo — que não a deve desenhar outra vez.
import { test, expect } from "vitest";
import { makeLiveChat } from "../src/features/codev/application/live-chat";
import type { LiveDeps } from "../src/features/codev/application/ports";

function setup() {
  const calls: string[] = [];
  const presenter = new Proxy(
    {
      userMessage: (q: string) => calls.push(`user ${q}`),
      providerOff: (name: string) => calls.push(`off ${name}`),
    },
    { get: (t: Record<string, unknown>, k: string) => t[k] ?? (() => undefined) },
  );
  const deps = {
    presenter,
    providers: { providers: () => ({ ollama: { name: "Ollama", on: false } }), activeProvider: () => "ollama" },
  } as unknown as LiveDeps;
  return { liveChat: makeLiveChat(deps), calls };
}

test("liveChat desenha a mensagem do utilizador por omissão", async () => {
  const t = setup();
  await t.liveChat("olá");
  expect(t.calls).toEqual(["user olá", "off Ollama"]);
});

test("liveChat com echoed não volta a desenhar a mensagem (fallback do agente)", async () => {
  const t = setup();
  await t.liveChat("olá", { echoed: true });
  expect(t.calls).toEqual(["off Ollama"]);
});
