/* ═══════════ feature Explain · Code-Review · Under-the-Hood — domínio (regra) ═══════════
   `reviewFindings`: a regra de revisão baseada em padrões (correcção, segurança,
   performance e as regras do projecto) extraída de `features/codereview.ts`. PURA —
   recebe `content`/`ext`/`path` + os factos que o monólito resolve (`lexer` via
   v6.ts `lexBug`/`LXL`, `dsLint` via diagnostics.ts) e devolve `Finding[]` ordenado
   por severidade. Sem `FS`, sem `window`, sem DOM. Comportamento idêntico ao
   anterior — só mudou a PROVENIÊNCIA dos dados (injectados, não globais).

   Os textos `t`/`why`/`fix` são HTML que a tab de Code review mostra tal-e-qual:
   copiados verbatim (UI congelada). */

import type { Finding, ReviewInput, Severity } from "./types";
import { SEV_ORDER } from "./scoring";

export function reviewFindings(input: ReviewInput): Finding[] {
  const { path, content, ext, lexer, dsLint } = input;
  const ls = content.split("\n");
  const out: Finding[] = [];
  const add = (l: number, sev: Severity, t: string, why: string, fix: string) => out.push({ l, sev, t, why, fix });
  const each = (re: RegExp, fn: (l: number, x: string) => void) => ls.forEach((x, i) => { if (re.test(x)) fn(i + 1, x); });
  if (ext === "rs") {
    if (lexer && lexer.bug) add(lexer.peekLine, "bug", "Iterator used after being moved (E0382)", "The <code>for</code> loop takes ownership of <code>chars</code>; the later <code>peek()</code> cannot use it.", "Borrow it for the loop: <code>for c in chars.by_ref()</code>.");
    each(/for \w+ in \w+\.clone\(\)/, l => add(l, "bug", "Loop iterates over a clone of the iterator", "The original iterator never advances, so any check after the loop (like <code>peek()</code>) sees stale state.", "Use <code>.by_ref()</code> to keep one cursor."));
    each(/\.unwrap\(\)/, l => { if (!/#\[test\]|tests\//.test(content.slice(0, 200)) && !/test/.test(path)) add(l, "risk", "unwrap() on a fallible value", "Panics on bad input and takes the whole service down.", "Return a typed error with <code>?</code> or map it."); });
    each(/SELECT .* LIMIT/, l => { if (!/ORDER BY/.test(ls[l - 1])) add(l, "bug", "LIMIT without ORDER BY", "SQLite returns rows in whatever order is cheapest; “recent” lists become arbitrary.", "Add <code>ORDER BY created_at DESC</code> and an index on (filter, order) columns."); });
  }
  if (["ts", "js", "jsx"].includes(ext)) {
    each(/innerHTML\s*=.*\$\{/, l => add(l, "risk", "User text interpolated into innerHTML", "A title like <code>&lt;img src=x onerror=…&gt;</code> runs script in the app.", "Escape the values or build nodes with <code>textContent</code>."));
    if (/await invoke/.test(content) && !/try\s*\{/.test(content)) add(ls.findIndex(x => /await invoke/.test(x)) + 1, "risk", "Backend call without error handling", "If the command fails the section stays half-drawn and the promise rejection is unhandled.", "Wrap in try/catch and render the error state the Design System requires.");
    each(/:\s*any\b/, l => add(l, "style", "any disables type checking", "Mistakes in this value will not be caught by tsc.", "Give it a real type."));
  }
  dsLint.forEach(v => add(v.line, "style", `Fixed colour ${v.hex}`, "Breaks theming and the Design System rule §4.", "Use a token, e.g. <code>var(--accent)</code>."));
  if (ext === "sql") {
    const idx = content.match(/CREATE INDEX[^;]*/g) || [];
    each(/REFERENCES\s+(\w+)/, (l, x) => { const col = (x.match(/^\s*(\w+)/) || [])[1]; if (col && !idx.some(s => new RegExp("\\(\\s*" + col).test(s))) add(l, "perf", `Foreign key ${col} has no index`, "Cascade deletes and joins on this column scan the whole child table.", `<code>CREATE INDEX … ON …(${col})</code>.`); });
  }
  if (/Dockerfile$/.test(path)) {
    if (!/^USER /m.test(content) && !/nonroot|unprivileged/.test(content)) add(1, "risk", "Container runs as root", "A compromise of the app is a compromise of the container's root.", "Add a non-root <code>USER</code>.");
    each(/^FROM \S+:latest/, l => add(l, "risk", "Unpinned base image", "Builds change under you.", "Pin a version or digest."));
    if (/COPY src/.test(content) && /cargo build/.test(content)) add(ls.findIndex(x => /COPY src/.test(x)) + 1, "perf", "Dependencies rebuild on every source change", "Copying <code>src</code> before building invalidates the dependency layer.", "Build dependencies with only <code>Cargo.toml</code>/<code>Cargo.lock</code> first, then copy <code>src</code>.");
  }
  if (/docker-compose\.yml$/.test(path)) each(/^      - [a-z][\w-]*$/, l => { if (/depends_on/.test(ls.slice(Math.max(0, l - 4), l).join(""))) add(l, "risk", "depends_on without a health condition", "The app starts before its database accepts connections.", "Use <code>condition: service_healthy</code>."); });
  if (/deploy\/k8s\/.*\.yaml$/.test(path)) {
    if (/kind: Deployment/.test(content) && !/resources:/.test(content)) add(ls.findIndex(x => /kind: Deployment/.test(x)) + 1, "risk", "No resource requests or limits", "The scheduler cannot place it well and one pod can starve the node.", "Set <code>resources.requests</code> and <code>limits</code>.");
    if (/stringData:/.test(content)) add(ls.findIndex(x => /stringData:/.test(x)) + 1, "risk", "Secret values in plain text in git", "Anyone with repo access reads them.", "Use SOPS, Sealed Secrets or an external secrets operator.");
  }
  return out.sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
}
