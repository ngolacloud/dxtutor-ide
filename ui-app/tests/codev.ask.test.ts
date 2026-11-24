import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAsk } from "../src/features/codev/application/ask";
import { CODEV_ENGINE_MESSAGES } from "../src/features/codev/application/messages";
import { translator } from "../src/app/i18n";
import { explainPrompt, hunkContext, selectionContext } from "../src/features/codev/domain/ask";
import { buildPrompt } from "../src/features/codev/domain/composer";
import { bootApp } from "./harness";

/* codev.ask (A2.4): the one way features ask Co-Dev — intent + context + scope. Explain is
   answered in the chat straight away; the rest lands in the composer as removable chips. */

describe("the ask contract", () => {
  it("builds contexts for a hunk and a selection", () => {
    const h = hunkContext("src/lib.rs", 5, "    for c in chars {\n", "    while let Some(c) = chars.next() {\n");
    expect(h).toEqual({
      kind: "hunk",
      label: "src/lib.rs:5",
      text: "-     for c in chars {\n+     while let Some(c) = chars.next() {",
      path: "src/lib.rs",
    });
    expect(selectionContext("src/lib.rs", 10, "a\nb\nc").label).toBe("lib.rs:10–12");
  });

  it("an explain request carries the context and asks for no file changes", () => {
    const p = explainPrompt({ intent: "explain", context: [{ kind: "problem", label: "E0382", text: "use of moved value" }] });
    expect(p.startsWith("Explica isto.")).toBe(true);
    expect(p).toContain('<contexto tipo="problem" nome="E0382">\nuse of moved value\n</contexto>');
    expect(p).toContain("não proponhas alterar ficheiros");
  });

  it("i18n: with the interface in English, the default question is English and the model is told to answer in English", async () => {
    const prompts: string[] = [];
    const calls: string[] = [];
    const ask = makeAsk({
      sample: () => async (p: string) => { prompts.push(p); return { text: "ok" }; },
      presenter: { userMessage: (t: string) => calls.push(t), thinking: () => ({}), assistantText: () => undefined, liveError: () => undefined, scrollMsgs: () => undefined } as never,
      speaker: () => "co-dev",
      focus: () => undefined,
      compose: () => undefined,
      copy: translator(CODEV_ENGINE_MESSAGES),
      replyLanguage: () => "en",
    });
    await ask({ intent: "explain", context: [], send: true });
    expect(calls[0]).toBe("Explain this.");
    expect(prompts[0].startsWith("Explain this.")).toBe(true);
    expect(prompts[0]).toContain("Answer the human in English");
    expect(prompts[0]).not.toContain("Responde em português");
  });

  it("context chips become tagged blocks in the request", () => {
    const q = buildPrompt("porque falha?", [{ id: "a1", kind: "snippet", name: "lib.rs:3", content: "let x = y;", path: "src/lib.rs", context: "selection" }]);
    expect(q).toBe('porque falha?\n\n<contexto tipo="selection" nome="lib.rs:3" caminho="src/lib.rs">\nlet x = y;\n</contexto>');
  });
});

describe("the ask use case", () => {
  const presenter = () => {
    const calls: string[] = [];
    return {
      calls,
      p: {
        userMessage: (t: string) => calls.push(`user ${t}`),
        thinking: () => ({ tools: "T", body: "B" }),
        assistantText: (_c: unknown, t: string) => calls.push(`text ${t}`),
        liveError: (_c: unknown, _a: boolean, _k: unknown, m: string) => calls.push(`error ${m}`),
        scrollMsgs: () => undefined,
      },
    };
  };

  it("explain streams the answer in the chat and does not touch the composer", async () => {
    const { calls, p } = presenter();
    const compose = vi.fn();
    const sample = vi.fn(async (_q: unknown, o?: { onText?: (x: { text: string }) => void }) => {
      o?.onText?.({ text: "Porque" });
      o?.onText?.({ text: "Porque o for move." });
      return { text: "Porque o for move." };
    });
    const ask = makeAsk({ sample: () => sample, presenter: p as never, speaker: () => "co-dev", focus: () => calls.push("focus"), compose });
    await ask({ intent: "explain", context: [{ kind: "hunk", label: "lib.rs:5", text: "- a\n+ b" }], send: true });
    expect(calls).toEqual(["focus", "user Explica isto. (lib.rs:5)", "text Porque", "text Porque o for move.", "text Porque o for move."]);
    expect(compose).not.toHaveBeenCalled();
  });

  it("without a live model, explain falls back to the composer; other intents go there too", async () => {
    const { p } = presenter();
    const compose = vi.fn();
    const ask = makeAsk({ sample: () => null, presenter: p as never, speaker: () => "co-dev", focus: () => undefined, compose });
    await ask({ intent: "explain", context: [], send: true });
    expect(compose).toHaveBeenLastCalledWith("Explica isto.", [], true);
    await ask({ intent: "chat", text: "Sobre isto", context: [{ kind: "selection", label: "a.rs:1", text: "x" }] });
    expect(compose).toHaveBeenLastCalledWith("Sobre isto", [{ kind: "selection", label: "a.rs:1", text: "x" }], false);
  });
});

describe("codev.ask in the app", () => {
  let w: Window & Record<string, any>;
  beforeEach(async () => {
    vi.useFakeTimers();
    w = (await bootApp()) as Window & Record<string, any>;
  });
  afterEach(() => vi.useRealTimers());

  it("Ctrl+I puts the editor's selection in the composer as a removable chip", () => {
    const key = Object.keys(w.FS).find((k: string) => k.endsWith("/lib.rs"))!;
    w.openPath(key);
    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    const end = ta.value.indexOf("\n");
    ta.setSelectionRange(0, end);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "i", ctrlKey: true, bubbles: true }));
    const chips = Array.from(document.querySelectorAll("#ag-compose .cc-att b")).map((b) => b.textContent);
    expect(chips).toEqual(["lib.rs:1"]);
    expect(document.querySelector('#ag-compose [data-action="cc-unattach"]')).not.toBeNull();
  });

  it("codev.ask with send:false leaves the question in the box", async () => {
    await (await import("../src/app/codev-ask")).codevAsk.ask({ intent: "fix", context: [{ kind: "problem", label: "E0382", text: "use of moved value" }], send: false });
    expect((document.getElementById("ag-input") as HTMLTextAreaElement).value).toBe("Fix this.");
    const chips = Array.from(document.querySelectorAll("#ag-compose .cc-att b")).map((b) => b.textContent);
    expect(chips).toEqual(["E0382"]);
  });
});
