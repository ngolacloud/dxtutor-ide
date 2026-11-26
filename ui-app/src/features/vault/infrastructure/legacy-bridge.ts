/* ═════════ feature `vault` — a ponte legada (r23 F4c) ═════════
   O ÚNICO ficheiro da subárvore que toca em `window` (A8): a pasta aberta (DXR), um terminal de tarefa
   (com o Vault que o backend põe no ambiente), a paleta como campo de texto, os separadores e o LS onde
   fica para onde o IDE aponta (endereço, namespace, mounts — nunca o token). Tudo lido NO ACTO. */
import { toast } from "../../../core";
import type { VaultTarget } from "../domain/types";

interface Globals {
  DXR?: { root?: string | null };
  runTask: (cmd: string, o?: { label?: string; vault?: { addr: string; namespace?: string | null; lease?: string | null } }) => unknown;
  palette: (pre: string, cfg: { ph?: string; verb?: string; text?: (q: string) => void }) => void;
  openTab: (t: { id: string; title: string; kind: string }) => void;
}
const G = window as unknown as Globals;
const LS_KEY = "dx-vault-target";

export const root = (): string | null => G.DXR?.root ?? null;
export const runInTerminal = (cmd: string, vault: { addr: string; namespace: string | null; lease?: string | null }, label: string): Promise<number> | void => {
  const r = G.runTask(cmd, { label, vault });
  return r && typeof (r as Promise<unknown>).then === "function" ? (r as Promise<unknown>).then((c) => (typeof c === "number" ? c : -1)) : undefined;
};
export const textPrompt = (ph: string, initial = ""): Promise<string | null> =>
  new Promise((res) => {
    let done = false;
    G.palette(initial, { ph, verb: "OK", text: (q) => { done = true; res(q); } });
    const watch = setInterval(() => { const pal = document.getElementById("pal"); if (done) { clearInterval(watch); return; } if (!pal || !pal.classList.contains("show")) { clearInterval(watch); res(null); } }, 300);
  });
export const notify = (m: string): void => toast(m);
export const openTab = (kind: string, title: string): void => G.openTab({ id: kind, title, kind });
export const loadTarget = (): Partial<VaultTarget> | null => {
  try { const v = window.localStorage.getItem(LS_KEY); return v ? (JSON.parse(v) as Partial<VaultTarget>) : null; } catch { return null; }
};
export const saveTarget = (t: VaultTarget): void => {
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch { /* sem LS: fica só nesta sessão */ }
};
