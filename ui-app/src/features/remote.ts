/* ═════════ dxtutor IDE — feature: Remote Explorer (pane lateral) ═════════
   O pane «Remote Explorer». ADR-0006, R6c: deixa de mostrar uma ligação local «delonix» e dois
   hosts SSH fixos que só davam um aviso. Na app desktop, a lista vem do `~/.ssh/config` real
   (lido pela porta `desktopPorts.remote`, interpretado por `remote-config.ts`) mais os hosts
   acrescentados no pane Infra; cada host abre um terminal com `ssh <host>` (um PTY real) ou testa
   a ligação (`ssh -o BatchMode=yes … true`) — só quando se pede, nunca sozinho. No browser não há
   `ssh` nem `~/.ssh`, e o pane di-lo. */

import { $, hd, esc } from "../core";
import { RP } from "../app/store/registry";
import { desktopPorts } from "../app/desktop";
import { parseSshConfig, sshTarget, type SshHost } from "./remote-config";

/** A parte desktop: o `~/.ssh/config`, o terminal SSH e o teste de ligação. */
export interface RemoteDesktop {
  /** O texto do `~/.ssh/config` (null se não existe) ou o erro de o ler. */
  config(): Promise<{ text: string | null; error?: string }>;
  /** Abre um terminal com `ssh <host>`. */
  connect(host: string): void;
  /** `ssh -o BatchMode=yes -o ConnectTimeout=… <host> true`: chega lá e autentica sem perguntar? */
  test(host: string): Promise<{ ok: boolean; message: string }>;
  /** Este computador (`user@host`). */
  local(): string;
}

const S: { loaded: boolean; loading: boolean; hosts: SshHost[]; includes: string[]; error: string; status: Record<string, { ok: boolean; message: string } | "testing"> } =
  { loaded: false, loading: false, hosts: [], includes: [], error: "", status: {} };

/** Os hosts acrescentados à mão no pane Infra (`ENVS.ssh`, p.ex. `user@host`). */
const manualHosts = (): string[] => ((window as unknown as { ENVS?: { ssh?: string[] } }).ENVS?.ssh ?? []).filter(Boolean);

async function load(d: RemoteDesktop): Promise<void> {
  S.loading = true; S.error = "";
  try {
    const r = await d.config();
    const c = parseSshConfig(r.text ?? "");
    S.hosts = c.hosts; S.includes = c.includes; S.error = r.error ?? "";
  } catch (e) { S.hosts = []; S.error = e instanceof Error ? e.message : String(e); }
  S.loading = false; S.loaded = true;
  renderRemotePane();
}

const row = (name: string, detail: string) => {
  const st = S.status[name];
  const stTxt = st === "testing" ? "a testar…" : st ? (st.ok ? "✓ " : "✖ ") + st.message : detail;
  const dot = st && st !== "testing" ? (st.ok ? "var(--green)" : "var(--red)") : "";
  return `<div class="scm-row" style="cursor:default" title="${esc(detail)}"><span class="pdot${dot ? "" : " off"}"${dot ? ` style="background:${dot}"` : ""}></span><span class="nm notr">${esc(name)}</span><span class="pth notr">${esc(stTxt)}</span><span class="ra" style="display:flex"><button title="Open an SSH terminal" data-remote="connect" data-host="${esc(name)}">⌁</button><button title="Test the connection (BatchMode, no prompts)" data-remote="test" data-host="${esc(name)}">✓?</button></span></div>`;
};

/** Renderiza o pane «Remote Explorer». */
function renderRemotePane(): void {
  const el = $("#pane-remote");
  if (!el) return;
  const d = desktopPorts.remote;
  if (!d) {
    el.innerHTML = hd("Remote Explorer") + `<div class="sections"><div class="scm-grp">Local</div><div class="scm-row" style="cursor:default"><span class="pdot" style="background:var(--green)"></span><span class="nm">this browser</span></div><div class="scm-grp">SSH</div><div class="sec-empty">The SSH hosts come from <code>~/.ssh/config</code> in the desktop app, which opens real SSH terminals.</div></div>`;
    return;
  }
  if (!S.loaded && !S.loading) void load(d);
  const manual = manualHosts().filter((h) => !S.hosts.some((x) => x.name === h));
  const list = S.loading && !S.loaded ? '<div class="sec-empty">A ler o ~/.ssh/config…</div>'
    : S.hosts.map((h) => row(h.name, sshTarget(h))).join("") + manual.map((h) => row(h, "added in Infra")).join("")
      || `<div class="sec-empty">${S.error ? `Não consegui ler o ~/.ssh/config: ${esc(S.error)}` : "No hosts in ~/.ssh/config. Hosts added in Infra appear here too."}</div>`;
  el.innerHTML = hd("Remote Explorer", `<button title="Re-read ~/.ssh/config" data-remote="refresh">⟳</button>`) +
    `<div class="sections"><div class="scm-grp">Local</div><div class="scm-row" style="cursor:default"><span class="pdot" style="background:var(--green)"></span><span class="nm notr">${esc(d.local())}</span><span class="pth">this computer</span></div>
     <div class="scm-grp">SSH<span class="cnt">${S.hosts.length + manual.length}</span></div>${list}
     ${S.includes.length ? `<div class="sec-empty">Not read: <code class="notr">Include ${esc(S.includes.join(" "))}</code>.</div>` : ""}</div>`;
  el.querySelectorAll<HTMLElement>("[data-remote]").forEach((b) => {
    b.onclick = () => {
      const host = b.dataset.host || "", what = b.dataset.remote;
      if (what === "refresh") { S.loaded = false; S.status = {}; renderRemotePane(); return; }
      if (what === "connect") { d.connect(host); return; }
      S.status[host] = "testing"; renderRemotePane();
      void d.test(host).then((r) => { S.status[host] = r; renderRemotePane(); }, (e) => { S.status[host] = { ok: false, message: String((e as Error)?.message || e) }; renderRemotePane(); });
    };
  });
}

/** Abre um terminal SSH para `host` (usado pelo pane Infra); no browser, diz que não há como. */
export function openSsh(host: string): boolean {
  const d = desktopPorts.remote;
  if (!d) return false;
  d.connect(host);
  return true;
}

/* ── publicação transitória no window (o selftest e o i18n chamam por global) ── */
window.renderRemotePane = renderRemotePane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.remote = renderRemotePane;

