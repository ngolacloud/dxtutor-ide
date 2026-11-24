/* ═════════ feature `panel` — integração de shell (domínio puro) ═════════
   O backend arranca bash/zsh com um script que, no prompt, emite sequências OSC
   invisíveis (ver `src-tauri/src/shell_integration.rs`):
     • OSC 7   ; file://<host><cwd>      — o directório de trabalho;
     • OSC 633 ; E ; <comando>           — o comando que acabou de terminar;
     • OSC 633 ; D ; <código de saída>   — como terminou.
   O xterm entrega o corpo de cada OSC (sem o número) aos handlers registados; estas
   funções convertem esse corpo em eventos. O comando chega escapado (`\\` → `\\\\`,
   `;` → `\x3b`, newline → `\x0a`), como no protocolo do VS Code. */

export type ShellEvent =
  | { kind: "command"; command: string }
  | { kind: "exit"; code: number };

/** Desfaz o escape do protocolo 633 (`\x3b`, `\x0a`, `\\`). */
export function unescape633(s: string): string {
  return s.replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_m, all: string, hex?: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : all,
  );
}

/** Corpo de um OSC 633 → evento, ou null para os subcomandos que não usamos. */
export function parseOsc633(data: string): ShellEvent | null {
  const sep = data.indexOf(";");
  const code = sep < 0 ? data : data.slice(0, sep);
  const rest = sep < 0 ? "" : data.slice(sep + 1);
  if (code === "E") return { kind: "command", command: unescape633(rest.split(";")[0] ?? "").trim() };
  if (code === "D") {
    const n = parseInt(rest, 10);
    return Number.isFinite(n) ? { kind: "exit", code: n } : null;
  }
  return null;
}

/** Corpo de um OSC 7 (`file://host/caminho`) → caminho absoluto, ou null. */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
