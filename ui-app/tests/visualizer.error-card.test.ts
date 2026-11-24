import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* O cartão «Can't visualize this program» (programa fora do subconjunto de Rust). A edição que
 * tirou a frase sobre o `rust_tracer` (e45f18d) deixou um resto «<code>rust_tracer</code>).» no
 * fim; nenhum teste cobria este cartão. */

let w: any;
beforeEach(async () => { vi.useFakeTimers(); w = await bootApp(); });
afterEach(() => { w.vizClose?.(); vi.useRealTimers(); });

describe("visualizer — cartão de erro", () => {
  it("diz o subconjunto suportado e acaba aí, sem restos da frase sobre o tracer", () => {
    w.vizOpen("fn main() {\n    let t = std::thread::spawn(|| 1);\n}\n", "threads.rs");
    const card = document.querySelector("#viz .vz-card.bad")!;
    expect(card.textContent).toMatch(/Can't visualize this program/);
    const mute = card.querySelector(".vz-mute")!;
    expect(mute.textContent!.trim().endsWith("and the common methods.")).toBe(true);
    expect(card.innerHTML).not.toMatch(/rust_tracer|\)\.<\/p>/);
  });
});
