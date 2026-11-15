// Tab «Team & harness» (.eview, padrão studio.ts) — o CONTRATO do projecto que governa o
// dock Co-Dev de verdade. O contrato vive em .dxtutor/harness.toml NO WORKSPACE (versionado
// com o código, nunca em configDir): template escolhido, ceiling do modo Co-Dev, threshold,
// escopos de paths por papel e routing papel→modelo. «Aplicar» escreve o ficheiro após
// confirmação; o badge «aplicado» é uma comparação REAL ficheiro↔template (re-lê o disco).
// O ceiling é aplicado no dock (Codev.setCeiling) e o routing no Team (setRouting) — a
// matriz codev_policy do backend continua a única verdade do que cada modo pode; o
// enforcement de escopos de paths por papel NÃO está ligado ao tool-loop e a UI di-lo.
//
// TOML: subset mínimo escrito/lido por nós (documentado aqui, nunca um parser geral):
//   chave = "texto"            (escapes: \\ e \")
//   chave = 123                (inteiro)
//   [secção]                   (uma palavra; usamos [scopes] e [routing])
//   chave = ["a", "b"]        (lista de textos)
// Linhas vazias e comentários `#` são ignorados. Qualquer outra forma é ignorada — na
// dúvida o ficheiro conta como «não aplicado» (comparação honesta, nunca adivinhada).

import { api } from "./tauri";
import { t } from "./i18n";

export const HARNESS_REL = ".dxtutor/harness.toml";

export interface HarnessConfig {
  template: string;
  ceiling: "manual" | "assist" | "auto";
  threshold: number;
  scopes: Record<string, string[]>;
  routing: Record<string, string>;
}

export interface HarnessTemplate extends HarnessConfig { key: string }

// Os 4 templates do protótipo. Os papéis são os do roster real do team.ts; os provedores
// pinados usam os ids reais de list_providers (a disponibilidade continua a decidir).
export const TEMPLATES: HarnessTemplate[] = [
  {
    key: "estudo", template: "estudo", ceiling: "manual", threshold: 1,
    scopes: { tutor: ["docs/", "README.md"] }, routing: {},
  },
  {
    key: "pair", template: "pair", ceiling: "assist", threshold: 2,
    scopes: { lead: ["src/"], qa: ["tests/"] }, routing: {},
  },
  {
    key: "cloud", template: "cloud", ceiling: "auto", threshold: 3,
    scopes: { be: ["src/"], ops: ["deploy/", ".github/"], qa: ["tests/"] },
    routing: { ops: "claude" },
  },
  {
    key: "criticos", template: "criticos", ceiling: "manual", threshold: 1,
    scopes: { lead: ["docs/adr/"], be: ["src/"], qa: ["tests/"] },
    routing: { be: "ollama" },
  },
];

const escT = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const unescT = (s: string): string => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

/** Serializa uma config no subset TOML documentado acima (forma canónica — a comparação
 * «aplicado» compara o texto do disco com esta). */
export function serializeHarness(c: HarnessConfig): string {
  const lines: string[] = [
    "# dxtutor harness — contrato do projecto (subset TOML escrito pelo dxtutor).",
    "# Versionado com o código. ceiling governa o dock Co-Dev; scopes/routing por papel.",
    `template = "${escT(c.template)}"`,
    `ceiling = "${escT(c.ceiling)}"`,
    `threshold = ${c.threshold}`,
    "",
    "[scopes]",
  ];
  for (const k of Object.keys(c.scopes)) {
    lines.push(`${k} = [${c.scopes[k].map((p) => `"${escT(p)}"`).join(", ")}]`);
  }
  lines.push("", "[routing]");
  for (const k of Object.keys(c.routing)) lines.push(`${k} = "${escT(c.routing[k])}"`);
  return lines.join("\n") + "\n";
}

/** Lê o subset TOML. Devolve null quando o texto não tem os campos obrigatórios. */
export function parseHarness(raw: string): HarnessConfig | null {
  let section = "";
  const top: Record<string, string | number> = {};
  const scopes: Record<string, string[]> = {};
  const routing: Record<string, string> = {};
  for (const line0 of raw.split("\n")) {
    const line = line0.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = /^\[([a-zA-Z0-9_-]+)\]$/.exec(line);
    if (sec) { section = sec[1]; continue; }
    const kv = /^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val.startsWith("[")) {
      const items = [...val.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => unescT(m[1]));
      if (section === "scopes") scopes[key] = items;
    } else if (val.startsWith('"')) {
      const m = /^"((?:\\.|[^"\\])*)"$/.exec(val);
      const s = m ? unescT(m[1]) : "";
      if (section === "routing") routing[key] = s;
      else if (!section) top[key] = s;
    } else if (!section && /^-?\d+$/.test(val)) {
      top[key] = Number(val);
    }
  }
  const ceiling = top.ceiling;
  if (ceiling !== "manual" && ceiling !== "assist" && ceiling !== "auto") return null;
  return {
    template: String(top.template ?? ""),
    ceiling,
    threshold: typeof top.threshold === "number" ? top.threshold : 0,
    scopes, routing,
  };
}

export interface HarnessDeps {
  root(): string | null;
  /** Os caminhos relativos REAIS do workspace aberto (para o contexto medido). */
  listFiles(): string[];
  /** Avisar o shell: o harness mudou → aplicar ceiling ao dock e routing ao Team. */
  onApplied(cfg: HarnessConfig | null): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export class Harness {
  private cfg: HarnessConfig | null = null;
  private raw = "";
  private err = "";

  constructor(private host: HTMLElement, private deps: HarnessDeps) {}

  /** Relê o harness.toml do WORKSPACE (disco, nunca cache). null = sem harness. */
  async load(): Promise<HarnessConfig | null> {
    const root = this.deps.root();
    this.cfg = null; this.raw = ""; this.err = "";
    if (!root) return null;
    try {
      this.raw = await api.readTextFile(`${root}/${HARNESS_REL}`);
      this.cfg = parseHarness(this.raw);
    } catch { /* sem ficheiro — sem harness, honesto */ }
    return this.cfg;
  }

  async refresh(): Promise<void> {
    await this.load();
    this.render();
  }

  applyLocale(): void {
    if (this.host.innerHTML) this.render();
  }

  /** O template cujo serialize IGUALA o texto no disco (comparação real; um ficheiro
   * editado à mão deixa de contar como «aplicado» de um template). */
  appliedTemplate(): string | null {
    if (!this.raw) return null;
    const hit = TEMPLATES.find((tp) => serializeHarness(tp) === this.raw);
    return hit ? hit.key : null;
  }

  /** Escreve o template no WORKSPACE (.dxtutor/harness.toml) e aplica ao dock/Team.
   * A confirmação humana vive no handler do botão — o arnês chama isto directamente. */
  async apply(key: string): Promise<void> {
    const root = this.deps.root();
    const tp = TEMPLATES.find((x) => x.key === key);
    if (!root || !tp) throw new Error(t("hx.noFolder"));
    await api.writeFile(root, HARNESS_REL, serializeHarness(tp));
    await this.load();
    this.render();
    this.deps.onApplied(this.cfg);
  }

  /** Remove o harness do projecto (ficheiro apagado do disco) e repõe o dock livre. */
  async clear(): Promise<void> {
    const root = this.deps.root();
    if (!root) return;
    await api.deleteFile(root, HARNESS_REL);
    await this.load();
    this.render();
    this.deps.onApplied(null);
  }

  /** Estado real para o arnês: contexto medido, template aplicado e config corrente. */
  state(): {
    context: Record<string, boolean>;
    applied: string | null;
    ceiling: string | null;
    hasFile: boolean;
  } {
    return {
      context: this.context(),
      applied: this.appliedTemplate(),
      ceiling: this.cfg?.ceiling ?? null,
      hasFile: this.raw.length > 0,
    };
  }

  /** Contexto MEDIDO do workspace: cada chip só existe se o ficheiro existe de facto. */
  private context(): Record<string, boolean> {
    const files = this.deps.listFiles();
    const has = (p: (rel: string) => boolean): boolean => files.some(p);
    return {
      cargo: has((f) => f === "Cargo.toml" || f.endsWith("/Cargo.toml")),
      node: has((f) => f === "package.json" || f.endsWith("/package.json")),
      migrations: has((f) => f.startsWith("migrations/") || f.includes("/migrations/")),
      rules: has((f) => f === ".dxtutor/rules.md" || f === "AGENTS.md" || f === "CLAUDE.md"),
    };
  }

  private render(): void {
    const root = this.deps.root();
    if (!root) {
      this.host.innerHTML = `<div class="hx"><div class="hx-top"><h2>${esc(t("hx.title"))}</h2><div class="mg-sub">${esc(t("hx.noFolder"))}</div></div></div>`;
      return;
    }
    const ctx = this.context();
    const chips = (["cargo", "node", "migrations", "rules"] as const)
      .filter((k) => ctx[k])
      .map((k) => `<span class="hx-chip" data-ctx="${k}">${esc(t("hx.ctx." + k))}</span>`)
      .join("");
    const applied = this.appliedTemplate();
    const cards = TEMPLATES.map((tp) => {
      const on = applied === tp.key;
      const scopes = Object.keys(tp.scopes)
        .map((r) => `<div class="hx-scope"><code>${esc(r)}</code><span>${tp.scopes[r].map(esc).join(" · ")}</span></div>`)
        .join("");
      const routes = Object.keys(tp.routing)
        .map((r) => `<div class="hx-scope"><code>${esc(r)}</code><span>→ ${esc(tp.routing[r])}</span></div>`)
        .join("");
      return `<div class="hx-card${on ? " on" : ""}" data-tpl="${tp.key}">
        <div class="hx-card-h"><b>${esc(t("hx.tpl." + tp.key))}</b>${on ? `<span class="hx-badge">${esc(t("hx.applied"))}</span>` : ""}</div>
        <div class="hx-desc">${esc(t(`hx.tpl.${tp.key}.d`))}</div>
        <div class="hx-kv"><span>${esc(t("hx.ceiling"))}</span><code>${esc(t("mode." + tp.ceiling))}</code></div>
        <div class="hx-kv"><span>${esc(t("hx.threshold"))}</span><code>${tp.threshold}</code></div>
        ${scopes}${routes}
        <button class="mini pri" data-apply="${tp.key}">${esc(t("hx.apply"))}</button>
      </div>`;
    }).join("");
    const current = this.cfg
      ? `<div class="hx-kv"><span>${esc(t("hx.ceiling"))}</span><code>${esc(t("mode." + this.cfg.ceiling))}</code></div>` +
        `<div class="hx-kv"><span>${esc(t("hx.threshold"))}</span><code>${this.cfg.threshold}</code></div>` +
        `<pre class="hx-raw">${esc(this.raw)}</pre>` +
        `<button class="mini" data-clear>${esc(t("hx.remove"))}</button>`
      : `<div class="mg-sub">${esc(t("hx.none"))}</div>`;
    this.host.innerHTML = `<div class="hx">
      <div class="hx-top"><h2>${esc(t("hx.title"))}</h2><div class="mg-sub">${esc(t("hx.sub"))}</div></div>
      ${this.err ? `<div class="mg-err">${esc(this.err)}</div>` : ""}
      <div class="mg-sec"><div class="mg-sech"><b>${esc(t("hx.context"))}</b></div>
        <div class="hx-chips">${chips || `<span class="mg-sub">${esc(t("hx.noCtx"))}</span>`}</div></div>
      <div class="mg-sec"><div class="mg-sech"><b>${esc(t("hx.templates"))}</b></div>
        <div class="hx-cards">${cards}</div></div>
      <div class="mg-sec"><div class="mg-sech"><b>${esc(t("hx.current"))}</b></div>${current}</div>
      <div class="mg-subnote">${esc(t("hub.enforceNote"))}</div>
    </div>`;
    this.host.querySelectorAll<HTMLButtonElement>("[data-apply]").forEach((b) => {
      b.onclick = () => {
        if (!window.confirm(t("hx.confirm", { root }))) return;
        void this.apply(b.dataset.apply ?? "").catch((e) => { this.err = String(e); this.render(); });
      };
    });
    const cl = this.host.querySelector<HTMLButtonElement>("[data-clear]");
    if (cl) cl.onclick = () => {
      if (!window.confirm(t("hx.confirmRemove"))) return;
      void this.clear().catch((e) => { this.err = String(e); this.render(); });
    };
  }
}
