/* ═════════ dxtutor IDE — desktop: os hosts SSH reais (ADR-0006, R6c) ═════════
   Instala a porta `desktopPorts.remote` que o Remote Explorer (features/remote.ts) consulta: lê o
   `~/.ssh/config` real, abre um terminal com `ssh <host>` (uma tarefa num PTY do painel, portanto
   interactiva: passphrases e confirmações de chave são do utilizador) e testa a ligação com
   `ssh -o BatchMode=yes` (nunca pergunta nem aceita chaves de host às escondidas). */

import { desktopPorts } from "../../app/desktop";
import type { DesktopContext, ExecResult } from "./context";
import { translator } from "../../app/i18n";
import { DESKTOP_MESSAGES } from "./desktop-messages";

const tdk = translator(DESKTOP_MESSAGES);

/** Aspas de shell para um nome de host (os do ssh_config são simples; o resto vai entre aspas). */
const shq = (s: string): string => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
const lastLine = (s: string): string => String(s || "").trim().split("\n").pop() || "falhou";

export function installRemote(ctx: DesktopContext): void {
  const { R, sh } = ctx;
  /* o ficheiro que o pane mostra é o que o `ssh` usa (`-F`): o OpenSSH procura o ~/.ssh/config
     pela pasta pessoal da base de utilizadores, não pelo $HOME — sem isto os dois podiam divergir */
  let used: string | null = null;
  const withConfig = (args: string[]) => (used ? ["-F", used, ...args] : args);
  desktopPorts.remote = {
    async config() {
      const path = (R.info?.home || "~") + "/.ssh/config";
      const r = await sh("cat", [path], { cwd: R.info?.home, timeout: 10000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
      used = r.code === 0 ? path : null;
      if (r.code === 0) return { text: r.stdout };
      return /No such file/i.test(r.stderr) ? { text: null } : { text: null, error: lastLine(r.stderr) };
    },
    connect(host) {
      setPanelTab("terminal", true);
      const line = ["ssh", ...withConfig([host])].map(shq).join(" ");
      if (R.term) void R.term.runTask(line, { label: line, cwd: R.info?.home });
      else void ctx.runInTerm(line);
    },
    async test(host) {
      const r = await sh("ssh", withConfig(["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", host, "true"]), { cwd: R.info?.home, timeout: 15000 })
        .catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
      return r.code === 0 ? { ok: true, message: tdk("sshOk") } : { ok: false, message: lastLine(r.stderr) };
    },
    local: () => (R.user && R.host ? `${R.user}@${R.host}` : "this computer"),
  };
}
