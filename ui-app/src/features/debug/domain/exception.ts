/* ═══════════ feature `debug` — domain: the exception helper (r23 F2, UI-DBG-09) ═══════════
   A Rust panic is read from what the program printed (the default panic hook writes it before
   `rust_panic` is called, so it is already in the output when the debugger stops there): the
   thread, where, the message, and — for `assert_eq!`/`assert_ne!` — the left and right values.
   Both formats: Rust ≥ 1.73 (`panicked at src/x.rs:3:9:` then the message) and the older
   (`panicked at 'msg', src/x.rs:3:9`), with or without the thread id newer Rust writes after the name
   (`thread 't' (1025884) panicked at`), and `\r\n` line ends (a pseudo-terminal). Without a recording (rr), there is no cause chain: the
   card shows the stack. PURE: no DOM, no window. */

export interface Panic {
  thread: string;
  file: string;
  line: number;
  column: number;
  message: string;
  left?: string;
  right?: string;
}

const NEW = /thread '([^']*)'(?: \(\d+\))? panicked at ([^\n]+?):(\d+):(\d+):\n([\s\S]*?)(?=\nnote: |\nthread '|\nstack backtrace:|\n\s*$|$)/g;
const OLD = /thread '([^']*)'(?: \(\d+\))? panicked at '([\s\S]*?)', ([^\n]+?):(\d+):(\d+)/g;

/** The last panic in the program's output (null: none). */
export function parsePanic(raw: string): Panic | null {
  /* a program run under a pseudo-terminal (lldb-dap) writes `\r\n` */
  const output = raw.replace(/\r\n?/g, "\n");
  let last: Panic | null = null, lastAt = -1;
  for (const m of output.matchAll(NEW)) {
    if ((m.index ?? 0) < lastAt) continue;
    lastAt = m.index ?? 0;
    last = withSides({ thread: m[1], file: m[2].trim(), line: +m[3], column: +m[4], message: m[5].trim() });
  }
  for (const m of output.matchAll(OLD)) {
    if ((m.index ?? 0) < lastAt) continue;
    lastAt = m.index ?? 0;
    last = withSides({ thread: m[1], file: m[3].trim(), line: +m[4], column: +m[5], message: m[2] });
  }
  return last;
}

function withSides(p: Panic): Panic {
  const left = p.message.match(/^\s*left: (.*)$/m), right = p.message.match(/^\s*right: (.*)$/m);
  if (!left || !right) return p;
  const head = p.message.split("\n").filter((l) => !/^\s*(left|right): /.test(l)).join("\n").trim();
  return { ...p, message: head, left: left[1].trim(), right: right[1].trim() };
}

/** Did the program stop because of a panic? (a frame in the panic machinery near the top) */
export function isPanicStop(funcs: string[]): boolean {
  return funcs.slice(0, 12).some((f) => /\brust_panic\b|panicking::|begin_panic|panic_fmt|assert_failed/.test(f));
}

/** The panic as text (Copy, and the context Co-Dev gets). */
export function panicText(p: Panic): string {
  return [
    `thread '${p.thread}' panicked at ${p.file}:${p.line}:${p.column}:`,
    p.message,
    ...(p.left !== undefined ? [`  left: ${p.left}`, ` right: ${p.right}`] : []),
  ].join("\n");
}
