// Vista «Co-Dev» da activity bar (F15) — agrega numa sidebar o que está disperso, SEM
// duplicar estado: cada secção lê a fonte já portada e diz-se vazia quando está vazia.
//   TEAM      — papéis do roster (team.ts) com o escopo de paths do harness.toml do
//               WORKSPACE; sem harness → «escopos não definidos», nunca inventados.
//   BACKLOG   — contadores reais: stories por coluna de board_load + componentes
//               «planned» do desenho corrente do Studio.
//   MISSIONS  — espelho SÓ-LEITURA de codev_session_list + missões do manager.ts
//               (a fonte é o próprio Manager; este painel observa, nunca cria).
//   KNOWLEDGE — ficheiros markdown REAIS do workspace (.dxtutor/*.md e docs/*.md,
//               listados do disco); clicar abre como tab normal do editor.
//   CHECKPOINTS — tags git REAIS dxcp/* (criadas pelo deliver do dock, nunca aqui);
//               clicar mostra o diff real contra HEAD (git diff <tag> HEAD).
//   ROUTING   — papel→modelo tal como o team.ts o resolve AGORA (harness pin quando o
//               provedor está disponível, senão o router; list_providers decide).
// O enforcement de escopos por papel no tool-loop NÃO está ligado — a vista anota-o
// como extensão futura em vez de fingir.

import { api, type SessionInfo } from "./tauri";
import { t } from "./i18n";
import type { RoleRoute } from "./team";
import type { HarnessConfig } from "./harness";

const STAGES = ["backlog", "todo", "dev", "test", "func", "done"] as const;

export interface HubDeps {
  root(): string | null;
  /** Os papéis como o Team os resolve AGORA (única verdade do routing). */
  teamRoles(): RoleRoute[];
  /** O harness corrente do workspace (null = sem harness). */
  harness(): HarnessConfig | null;
  /** Componentes do desenho corrente do Studio (planned). */
  planned(): number;
  /** Sessões Co-Dev reais — a fonte é o Manager (codev_session_list). */
  sessions(): Promise<SessionInfo[]>;
  /** Missões como o Manager as lista agora (só-leitura). */
  missions(): { title: string; state: string }[];
  /** Abrir um markdown real como tab normal do editor. */
  openDoc(rel: string): Promise<void>;
  /** Abrir a tab «Team & harness». */
  openHarness(): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export class CodevHub {
  private byStage: Record<string, number> = {};
  private total = 0;
  private sessions: SessionInfo[] = [];
  private docs: string[] = [];
  private tags: string[] = [];
  private diffFor = "";
  private diffText = "";

  constructor(private host: HTMLElement, private deps: HubDeps) {}

  /** Relê todas as fontes reais e repinta. Nunca lança — erros ficam honestos no DOM. */
  async refresh(): Promise<void> {
    const root = this.deps.root();
    this.byStage = {}; this.total = 0; this.sessions = []; this.docs = []; this.tags = [];
    if (root) {
      try {
        const bl = await api.boardLoad(root);
        for (const st of bl?.stories ?? []) this.byStage[st.stage] = (this.byStage[st.stage] ?? 0) + 1;
        this.total = bl?.stories.length ?? 0;
      } catch { /* sem backend o quadro fica a zeros reais */ }
      try { this.sessions = await this.deps.sessions(); } catch { this.sessions = []; }
      try {
        const r = await api.exec("sh", ["-c", "ls -1 .dxtutor/*.md docs/*.md 2>/dev/null || true"], root);
        this.docs = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      } catch { this.docs = []; }
      try {
        const r = await api.exec("git", ["tag", "-l", "dxcp/*"], root);
        this.tags = r.code === 0 ? r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      } catch { this.tags = []; }
    }
    this.render();
  }

  applyLocale(): void {
    if (this.host.innerHTML) this.render();
  }

  /** O estado real mostrado — para o arnês comparar com as fontes frescas. */
  state(): {
    team: { roles: number; scopesDefined: boolean };
    backlog: { total: number; byStage: Record<string, number>; planned: number };
    missions: { sessions: string[]; tasks: number };
    knowledge: string[];
    checkpoints: string[];
    routing: { key: string; recommended: string | null; source: string }[];
  } {
    const roles = this.deps.teamRoles();
    return {
      team: { roles: roles.length, scopesDefined: this.deps.harness() !== null },
      backlog: { total: this.total, byStage: { ...this.byStage }, planned: this.deps.planned() },
      missions: { sessions: this.sessions.map((s) => s.slug), tasks: this.deps.missions().length },
      knowledge: [...this.docs],
      checkpoints: [...this.tags],
      routing: roles.map((r) => ({ key: r.key, recommended: r.recommended, source: r.source })),
    };
  }

  /** Mostra o diff REAL de um checkpoint contra HEAD (git diff <tag> HEAD). */
  private async openDiff(tag: string): Promise<void> {
    const root = this.deps.root();
    if (!root) return;
    this.diffFor = tag;
    try {
      const r = await api.exec("git", ["diff", tag, "HEAD"], root);
      this.diffText = r.code === 0 ? (r.stdout || t("hub.diffEmpty")) : r.stderr;
    } catch (e) {
      this.diffText = String(e);
    }
    this.render();
  }

  private sec(title: string, body: string): string {
    return `<div class="hub-sec"><div class="hub-sech">${esc(title)}</div>${body}</div>`;
  }

  private render(): void {
    const root = this.deps.root();
    if (!root) {
      this.host.innerHTML = `<div class="hub"><div class="hub-sub">${esc(t("hub.noFolder"))}</div></div>`;
      return;
    }
    const harness = this.deps.harness();
    const roles = this.deps.teamRoles();
    // TEAM: papéis com o escopo de paths visível (do harness; sem harness, honesto).
    const team = roles.map((r) => {
      const scope = harness?.scopes[r.key];
      const scopeHtml = scope && scope.length
        ? `<span class="hub-scope">${scope.map(esc).join(" · ")}</span>`
        : `<span class="hub-none">${esc(t("hub.scopesNone"))}</span>`;
      return `<div class="hub-row" data-role="${esc(r.key)}"><b>${esc(r.name)}</b>${scopeHtml}</div>`;
    }).join("");
    // BACKLOG: contadores por coluna (board_load) + componentes planned do Studio.
    const backlog =
      `<div class="hub-counts">${STAGES.map((s) =>
        `<span class="hub-count" data-stage="${s}"><i>${this.byStage[s] ?? 0}</i>${esc(t("board." + s))}</span>`).join("")}</div>` +
      `<div class="hub-kv"><span>${esc(t("hub.total"))}</span><code data-total>${this.total}</code></div>` +
      `<div class="hub-kv"><span>${esc(t("hub.planned"))}</span><code data-planned>${this.deps.planned()}</code></div>`;
    // MISSIONS: espelho só-leitura das sessões reais + missões do Manager.
    const missions = this.sessions.length || this.deps.missions().length
      ? this.sessions.map((s) =>
          `<div class="hub-row" data-hubsess="${esc(s.slug)}"><b>${esc(s.slug)}</b><code>${esc(s.branch)}</code></div>`).join("") +
        this.deps.missions().map((m) =>
          `<div class="hub-row"><b>${esc(m.title)}</b><span class="hub-none">${esc(t("mg.state." + m.state))}</span></div>`).join("")
      : `<div class="hub-sub">${esc(t("hub.noMissions"))}</div>`;
    // KNOWLEDGE: markdown reais; vazio diz-se vazio.
    const docs = this.docs.length
      ? this.docs.map((d) => `<button class="hub-doc" data-doc="${esc(d)}">${esc(d)}</button>`).join("")
      : `<div class="hub-sub">${esc(t("hub.noDocs"))}</div>`;
    // CHECKPOINTS: tags dxcp/* reais; clicar mostra o diff contra HEAD.
    const checkpoints = this.tags.length
      ? this.tags.map((tg) => `<button class="hub-doc" data-tag="${esc(tg)}">${esc(tg)}</button>`).join("") +
        (this.diffFor ? `<div class="hub-kv"><span>${esc(t("hub.diffVsHead", { tag: this.diffFor }))}</span></div><pre class="hub-diff">${esc(this.diffText.slice(0, 20000))}</pre>` : "")
      : `<div class="hub-sub">${esc(t("hub.noCheckpoints"))}</div>`;
    // ROUTING: papel→modelo resolvido pelo team.ts agora (harness/router, disponibilidade real).
    const routing = roles.map((r) =>
      `<div class="hub-row" data-route="${esc(r.key)}"><b>${esc(r.name)}</b>` +
      (r.recommendedName
        ? `<span class="hub-scope">${esc(r.recommendedName)} <i class="hub-src">${esc(t("hub.src." + r.source))}</i></span>`
        : `<span class="hub-none">${esc(t("tv.none"))}</span>`) + `</div>`).join("");
    this.host.innerHTML = `<div class="hub">
      <div class="hub-top"><button class="mini pri" data-harness>${esc(t("hx.title"))}</button>
        <button class="mini" data-refresh>${esc(t("mg.refresh"))}</button></div>
      ${this.sec(t("hub.team"), team + `<div class="hub-note">${esc(t("hub.enforceNote"))}</div>`)}
      ${this.sec(t("hub.backlog"), backlog)}
      ${this.sec(t("hub.missions"), missions)}
      ${this.sec(t("hub.knowledge"), docs)}
      ${this.sec(t("hub.checkpoints"), checkpoints)}
      ${this.sec(t("hub.routing"), routing)}
    </div>`;
    (this.host.querySelector("[data-harness]") as HTMLButtonElement).onclick = () => this.deps.openHarness();
    (this.host.querySelector("[data-refresh]") as HTMLButtonElement).onclick = () => void this.refresh();
    this.host.querySelectorAll<HTMLButtonElement>("[data-doc]").forEach((b) =>
      (b.onclick = () => void this.deps.openDoc(b.dataset.doc ?? "")));
    this.host.querySelectorAll<HTMLButtonElement>("[data-tag]").forEach((b) =>
      (b.onclick = () => void this.openDiff(b.dataset.tag ?? "")));
  }
}
