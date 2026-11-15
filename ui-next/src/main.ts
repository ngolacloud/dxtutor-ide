// Bootstrap: wire the explorer, editor and workspace to the real backend. No demo data,
// no scripted flows — the only state is what the backend returns for the opened folder.

import "./style.css";
import "./theme";
import { Workspace } from "./workspace";
import { Explorer } from "./explorer";
import { Editor } from "./editor";
import { Terminal } from "./terminal";
import { Scm } from "./scm";
import { Gitflow } from "./gitflow";
import { Search } from "./search";
import { Codev } from "./codev";
import { Remote } from "./remote";
import { Debug } from "./debug";
import { Outline } from "./outline";
import { Review } from "./review";
import { Tests } from "./tests";
import { Output } from "./output";
import { Services } from "./services";
import { Containers } from "./containers";
import { Explain } from "./explain";
import { DebugAssist } from "./debugassist";
import { Providers } from "./providers";
import { Extensions } from "./extensions";
import { Infra } from "./infra";
import { Account } from "./account";
import { Changelog } from "./changelog";
import { Team } from "./team";
import { CodevHub } from "./codevhub";
import { Harness, type HarnessConfig } from "./harness";
import { Settings } from "./settings";
import { Board } from "./board";
import { Studio } from "./studio";
import { Learn } from "./learn";
import { Manager } from "./manager";
import { Theatre } from "./theatre";
import { Palette, type PaletteItem } from "./palette";
import { MenuBar, type Menu } from "./menu";
import { t, getLocale, applyStatic, onLocaleChange } from "./i18n";
import { renderWelcome } from "./welcome";
import { svg, fileIcon } from "./icons";
import { api, isDesktop, type TestRun, type TestItem, type Hint, type ResolvedDef, type ExecutionTraceDto, type PipelineDto } from "./tauri";

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

/** Rótulo de linguagem para a statusbar, pela extensão do ficheiro activo. */
function langLabel(rel: string): string {
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    rs: "Rust", py: "Python", ts: "TypeScript", js: "JavaScript", json: "JSON",
    md: "Markdown", toml: "TOML", yaml: "YAML", yml: "YAML", html: "HTML",
    css: "CSS", c: "C", h: "C", cpp: "C++", go: "Go", sh: "Shell", lock: "TOML",
  };
  return map[ext] ?? t("sb.plain");
}

function toast(msg: string): void {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

class App {
  readonly ws = new Workspace();
  private explorer: Explorer;
  readonly outline!: Outline;
  readonly review!: Review;
  readonly tests!: Tests;
  readonly output!: Output;
  readonly services!: Services;
  readonly containers!: Containers;
  readonly explain!: Explain;
  readonly dbgassist!: DebugAssist;
  /** Última corrida de testes REAL (Tests/Board via onTestRun) — fonte do Debug Assistant. */
  lastTest: { title: string; run: TestRun; item: TestItem | null } | null = null;
  readonly providers!: Providers;
  readonly extensions!: Extensions;
  readonly infra!: Infra;
  readonly account!: Account;
  readonly changelog!: Changelog;
  readonly team!: Team;
  readonly codevhub!: CodevHub;
  readonly harness!: Harness;
  /** O harness corrente do workspace (.dxtutor/harness.toml) — null sem contrato. */
  private harnessCfg: HarnessConfig | null = null;
  readonly settings!: Settings;
  readonly board!: Board;
  readonly studio!: Studio;
  readonly learn!: Learn;
  readonly manager!: Manager;
  readonly theatre!: Theatre;
  readonly palette!: Palette;
  readonly menubar!: MenuBar;
  /** Vista especial a ocupar a área do editor ("" = editor/welcome normais). */
  special: "" | "board" | "studio" | "learn" | "manager" | "theatre" | "harness" = "";
  readonly editor: Editor;
  readonly terminal: Terminal;
  readonly scm!: Scm;
  readonly gitflow!: Gitflow;
  readonly search!: Search;
  readonly remote!: Remote;
  readonly debug!: Debug;
  readonly codev!: Codev;
  openTab = "";
  readonly openTabs: string[] = [];

  constructor() {
    applyStatic();
    this.explorer = new Explorer($(".tree"), (rel) => this.openFile(rel));
    this.explorer.onRerender(() => this.renderTree());
    this.outline = new Outline($("#outline"), (line) => this.editor.reveal(line, 1));
    this.review = new Review(
      $("#problems"),
      () => this.ws.root,
      (file, line) => {
        const rel = file.startsWith(this.ws.root) ? file.slice(this.ws.root.length).replace(/^\//, "") : file;
        if (this.ws.buffers.has(rel)) { this.openFile(rel); this.editor.reveal(line, 1); }
      },
      (n) => { $(".pr-badge").textContent = n ? String(n) : ""; $(".sb-problems").textContent = n ? `✖ ${n}` : "✔ 0"; },
    );
    this.output = new Output($("#output"));
    this.services = new Services($("#services"), () => this.ws.root);
    this.tests = new Tests(
      $("#tests"),
      () => this.ws.root,
      (file, line) => {
        const rel = file.startsWith(this.ws.root) ? file.slice(this.ws.root.length).replace(/^\//, "") : file;
        if (this.ws.buffers.has(rel)) { this.openFile(rel); this.editor.reveal(line, 1); }
      },
      (title, run, item) => this.onTestRun(title, run, item),
    );
    // Panel tabs: Terminal / Problems. Switching to Problems reviews the active file.
    document.querySelectorAll<HTMLElement>(".panel-tab[data-ptab]").forEach((t) => {
      t.onclick = () => this.showPanelTab(t.dataset.ptab ?? "term");
    });
    this.editor = new Editor(
      $("#editor"),
      $("#diffeditor"),
      (rel, content) => { this.ws.setBuffer(rel, content); this.outline.update(rel, content); },
      () => this.autosave(),
      {
        root: () => this.ws.root,
        openAt: (rel, line, col) => { this.openFile(rel); this.editor.reveal(line, col); },
        readBuffer: (rel) => this.ws.buffers.get(rel),
        // O caminho dos buffers (setBuffer + autosave): o SCM vê o rename como qualquer edit.
        writeBuffer: async (rel, content) => { this.ws.setBuffer(rel, content); await this.autosave(); },
        notify: (msg) => toast(msg),
      },
    );
    this.terminal = new Terminal($("#term"));
    this.terminal.setCwd(() => this.ws.root);
    this.scm = new Scm($("#scm"), () => this.ws.root, () => this.renderTree(), (rel) => void this.openDiff(rel));
    this.gitflow = new Gitflow($("#gitflow"), () => this.ws.root, () => {
      void this.scm.refresh();
      void this.updateStatus();
    });
    this.explorer.wireOps({
      newFile: (dirRel) => void this.uiNewFile(dirRel),
      rename: (rel) => void this.uiRename(rel),
      remove: (rel) => void this.uiDelete(rel),
    });
    this.remote = new Remote($("#remote"), () => this.ws.root, (l) => toast(l.slice(0, 160)));
    // Pane Containers: o motor real (get_sandbox_engine) via exec; compose corre no terminal.
    this.containers = new Containers($("#containers"), () => this.ws.root, (line) => this.terminal.run(line), (m) => toast(m));
    this.debug = new Debug($("#debug"), {
      root: () => this.ws.root,
      breakpoints: () => this.editor.breakpointList().map((b) => ({ file: `${this.ws.root}/${b.rel}`, line: b.line })),
      showStop: (file, line) => {
        const rel = file.startsWith(this.ws.root) ? file.slice(this.ws.root.length).replace(/^\//, "") : file;
        if (this.ws.buffers.has(rel)) { this.openFile(rel); this.editor.highlightStop(line); }
      },
    });
    this.search = new Search($("#search"), () => this.ws.root, (file, line, col) => {
      const rel = file.startsWith(this.ws.root) ? file.slice(this.ws.root.length).replace(/^\//, "") : file;
      this.openFile(rel);
      this.editor.reveal(line, col);
    });
    this.codev = new Codev($("#codev"), {
      root: () => this.ws.root,
      readBuffer: (rel) => this.ws.buffers.get(rel),
      writeBuffer: async (rel, content) => { this.ws.setBuffer(rel, content); await this.autosave(); this.renderTree(); },
      listFiles: () => [...this.ws.buffers.keys()],
      activeTab: () => this.openTab || null,
      markers: (rel) => this.editor.markers(rel),
    });
    // Eventos reais do Co-Dev (mensagens, ferramentas, sessões) alimentam a aba Output.
    this.codev.onEvent = (line) => this.output.log(line);
    this.explain = new Explain($("#explain"), {
      activeFile: () => (this.openTab ? { rel: this.openTab, content: this.ws.buffers.get(this.openTab) ?? "" } : null),
      explain: (rel, content) => this.codev.explainFile(rel, content),
    });
    // Debug Assistant (F14): 5.ª tab do painel inferior — SÓ dados medidos (diagnóstico LSP
    // vivo, última corrida de testes, stop do gdb); o turno LLM é governado (mode project)
    // e disparado por acção explícita, nunca em loop automático.
    this.dbgassist = new DebugAssist($("#dbgassist"), {
      root: () => this.ws.root,
      activeTab: () => this.openTab || null,
      readBuffer: (rel) => this.ws.buffers.get(rel),
      markers: (rel) => this.editor.markers(rel),
      lastTest: () => this.lastTest,
      rerunTest: (item) => (item ? this.tests.runOne(item) : this.tests.runAll()),
      debugSnapshot: () => this.debug.snapshot(),
      hasProvider: () => this.codev.hasProvider(),
      analyze: (p) => this.codev.analyzeOnce(p),
      armBreakpoint: (rel, line) => {
        this.editor.addBreakpoint(rel, line);
        if (this.openTab !== rel) this.openFile(rel);
        this.showView("debug");
      },
    });
    this.providers = new Providers($("#providers"));
    // Extensions (F10): manifesto .vsix real + registo local em ficheiro; sem host de
    // extensão — a própria vista declara que nada executa.
    this.extensions = new Extensions($("#extensions"), () => this.ws.root);
    // Infra/K8s (F11): kubectl real do host; deploy = manifests do PREVIEW do Studio
    // (nunca arch_scaffold) aplicados num namespace escolhido; apagar namespace confirma.
    this.infra = new Infra($("#infra"), () => this.ws.root, () => this.studio.preview(), (m) => toast(m));
    // Conta/Observabilidade + «o que mudou» (F12): uso medido lido do acumulador do Co-Dev
    // (nunca recontado) e timeline git real com o diff de git_show.
    this.account = new Account($("#account"), () => this.codev.usage());
    this.changelog = new Changelog($("#changelog"), () => this.ws.root);
    this.team = new Team($("#team"));
    this.settings = new Settings($("#settings"));
    // Quadro (SQLite real via board_load/board_save) e Estúdio (arch_* reais) — vistas que
    // ocupam a área do editor; o Estúdio escreve o backlog gerado no Quadro.
    this.board = new Board($("#board"), () => this.ws.root || null, (title, run) => this.onTestRun(title, run));
    this.studio = new Studio($("#studio"), {
      root: () => this.ws.root || null,
      ingest: (g) => this.board.ingest(g),
      openBoard: () => this.openSpecial("board"),
    });
    // Percurso de aprendizagem (backend de estudo real) e Gestor de missões (sessões
    // codev_session_list + tarefas isoladas agent_task_* sobre o preview do Studio).
    this.learn = new Learn($("#learn"));
    this.manager = new Manager($("#manager"), {
      root: () => this.ws.root,
      preview: () => this.studio.preview(),
    });
    // Theatre (Visualizar execução + Por dentro): trace_execution/compile_pipeline/
    // symbol_relations REAIS sobre o ficheiro activo — a vista nunca corre nada sozinha.
    this.theatre = new Theatre($("#theatre"), {
      root: () => this.ws.root,
      activeFile: () => (this.openTab ? { rel: this.openTab, content: this.ws.buffers.get(this.openTab) ?? "" } : null),
    });
    // Team & harness (F15): o contrato do projecto em .dxtutor/harness.toml (WORKSPACE,
    // versionado). Aplicar um template governa o dock (ceiling) e o routing do Team.
    this.harness = new Harness($("#harness"), {
      root: () => this.ws.root || null,
      listFiles: () => [...this.ws.buffers.keys()],
      onApplied: (cfg) => this.applyHarness(cfg),
    });
    // Vista Co-Dev agregada (F15): 6 secções de fontes REAIS já portadas — team/board/
    // manager/studio/git. A vista agrega, nunca muda as fontes.
    this.codevhub = new CodevHub($("#codevhub"), {
      root: () => this.ws.root || null,
      teamRoles: () => this.team.state().roles,
      harness: () => this.harnessCfg,
      planned: () => this.studio.componentCount(),
      sessions: () => this.manager.refresh(),
      missions: () => this.manager.missionsView(),
      openDoc: (rel) => this.openDoc(rel),
      openHarness: () => this.openSpecial("harness"),
    });
    // O Gestor espelha as sessões reais do dock: abrir/entregar/descartar repinta a lista.
    this.codev.onSessionChange = () => void this.manager.refresh();
    ($(".side-actions button") as HTMLButtonElement).onclick = () => this.pickAndOpen();
    this.renderWelcome();
    document.querySelectorAll(".activity button[data-view]").forEach((b) => {
      (b as HTMLButtonElement).onclick = () => this.showView((b as HTMLElement).dataset.view ?? "explorer");
    });
    window.addEventListener("beforeunload", () => this.editor.flushTimer());
    this.palette = new Palette();
    this.codev.onModeChange = () => this.updateStatus();
    this.editor.onCursor((l, c) => { $(".sb-cursor").textContent = `Ln ${l}, Col ${c}`; });
    void this.updateStatus();
    this.menubar = new MenuBar($(".mb"), this.buildMenus());
    onLocaleChange(() => this.applyLocaleAll());
    ($(".tb-search") as HTMLButtonElement).onclick = () => this.openFiles();
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        if (e.shiftKey) this.openCommands();
        else this.openFiles();
      }
    });
    // Fill every data-icon placeholder with the v7 SVG glyph (no emoji anywhere).
    document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
      el.innerHTML = svg(el.dataset.icon ?? "file");
    });
    this.exposeForHarness();
  }

  /** Os menus na locale corrente — reconstruídos a cada mudança de idioma. */
  private buildMenus(): Menu[] {
    const view = (v: string) => ({ label: t(`view.${v}`), run: () => this.showView(v) });
    return [
      { title: t("menu.file"), items: [
        { label: t("menu.openFolder"), run: () => void this.pickAndOpen() },
        { label: t("menu.newFile"), run: () => void this.newFile() },
        { sep: true, label: "" },
        { label: t("menu.save"), run: () => void this.autosave() },
      ] },
      { title: t("menu.edit"), items: [
        { label: t("menu.findInFiles"), run: () => this.showView("search") },
      ] },
      { title: t("menu.view"), items: [
        view("explorer"), view("search"), view("scm"), view("debug"), view("tests"), view("explain"),
        view("infra"), view("extensions"), view("providers"), view("team"), view("codevhub"), view("account"), view("changelog"), view("settings"),
        { sep: true, label: "" },
        { label: t("hx.title"), run: () => this.openSpecial("harness") },
        { label: t("board.title"), run: () => this.openSpecial("board") },
        { label: t("studio.title"), run: () => this.openSpecial("studio") },
        { label: t("ln.title"), run: () => this.openSpecial("learn") },
        { label: t("mg.title"), run: () => this.openSpecial("manager") },
        { label: t("th.title"), run: () => { this.openSpecial("theatre"); this.theatre.showMode("trace"); } },
        { label: t("th.tabPipe"), run: () => { this.openSpecial("theatre"); this.theatre.showMode("pipeline"); } },
        { sep: true, label: "" },
        { label: t("menu.commandPalette"), run: () => this.openCommands() },
      ] },
      { title: "Co-Dev", items: [
        { label: t("mode.manual"), run: () => void this.codev.setMode("manual") },
        { label: t("mode.assist"), run: () => void this.codev.setMode("assist") },
        { label: t("mode.auto"), run: () => void this.codev.setMode("auto") },
      ] },
      { title: t("menu.help"), items: [
        { label: t("menu.about"), run: () => toast("dxtutor IDE") },
      ] },
    ];
  }

  /** Repinta tudo o que mostra texto estático quando o idioma muda (applyStatic já correu). */
  private applyLocaleAll(): void {
    this.menubar.setMenus(this.buildMenus());
    this.terminal.applyLocale();
    this.scm.applyLocale();
    this.gitflow.applyLocale();
    this.tests.applyLocale();
    this.output.applyLocale();
    this.services.applyLocale();
    this.containers.applyLocale();
    this.search.applyLocale();
    this.debug.applyLocale();
    this.explain.applyLocale();
    this.dbgassist.applyLocale();
    this.codev.applyLocale();
    this.providers.applyLocale();
    this.extensions.applyLocale();
    this.infra.applyLocale();
    this.account.applyLocale();
    this.changelog.applyLocale();
    this.team.applyLocale();
    this.codevhub.applyLocale();
    this.harness.applyLocale();
    this.board.applyLocale();
    this.studio.applyLocale();
    this.learn.applyLocale();
    this.manager.applyLocale();
    this.theatre.applyLocale();
    if (!this.openTab) this.renderWelcome();
    void this.updateStatus();
  }

  /** The CodeMap (outline) belongs to the code editor: show it only when a file is open, never
   * on the welcome screen. */
  private updateOutlineVisibility(): void {
    const show = !!this.openTab;
    document.querySelector(".side-head-ol")?.classList.toggle("hidden", !show);
    document.getElementById("outline")?.classList.toggle("hidden", !show);
  }

  private renderWelcome(): void {
    const host = document.getElementById("welcome");
    this.updateOutlineVisibility();
    if (!host) return;
    renderWelcome(host, {
      openFolder: () => void this.pickAndOpen(),
      openRecent: (p) => void this.open(p),
      newFile: () => void this.newFile(),
      goView: (v) => this.showView(v),
      focusCodev: () => (document.querySelector(".cd-input") as HTMLInputElement | null)?.focus(),
    });
  }

  async newFile(name?: string): Promise<void> {
    if (!this.ws.open) { await this.pickAndOpen(); return; }
    const rel = name ?? prompt(t("prompt.newFile"), "untitled.txt") ?? "";
    if (!rel.trim()) return;
    this.ws.setBuffer(rel, "");
    this.renderTree();
    await this.autosave();
    this.openFile(rel);
  }

  private showPanelTab(tab: string): void {
    document.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== tab));
    document.querySelectorAll<HTMLElement>(".panel-tab[data-ptab]").forEach((t) => t.classList.toggle("on", t.dataset.ptab === tab));
    if (tab === "problems") void this.review.run(this.openTab || null);
    if (tab === "services") void this.services.refresh();
    if (tab === "dbgassist") this.dbgassist.refresh();
  }

  /** Resultado real de uma corrida de testes → Output + indicador na statusbar. */
  private onTestRun(title: string, run: TestRun, item?: TestItem): void {
    this.lastTest = { title, run, item: item ?? null };
    const verdict = run.ran ? (run.passed ? t("tests.passed") : t("tests.failed")) : t("tests.didNotRun");
    this.output.log(`${title} — ${verdict}`);
    if (run.output.trim()) this.output.log(run.output.trim().slice(-4000));
    const el = $(".sb-tests");
    el.textContent = run.ran ? (run.passed ? `✓ ${t("tests.ok")}` : `✗ ${t("tests.fail")}`) : "";
    el.classList.toggle("sb-ok", run.ran && run.passed);
    el.classList.toggle("sb-bad", run.ran && !run.passed);
    this.showPanelTab("output");
  }

  openFiles(): void {
    const items: PaletteItem[] = [...this.ws.buffers.keys()].map((rel) => ({
      label: rel, hint: "", run: () => this.openFile(rel),
    }));
    this.palette.open("", items);
  }

  openCommands(): void {
    const views: PaletteItem[] = ["explorer", "search", "scm", "changelog", "remote", "containers", "infra", "debug", "tests", "explain", "extensions", "providers", "team", "codevhub", "account", "settings"].map((v) => ({
      label: t("cmd.view", { name: t(`view.${v}`) }), hint: "", run: () => this.showView(v),
    }));
    const acts: PaletteItem[] = [
      { label: t("cmd.openFolder"), hint: "", run: () => void this.pickAndOpen() },
      { label: t("cmd.newFile"), hint: "", run: () => void this.newFile() },
      { label: t("cmd.codevManual"), hint: "", run: () => void this.codev.setMode("manual") },
      { label: t("cmd.codevAssist"), hint: "", run: () => void this.codev.setMode("assist") },
      { label: t("cmd.codevAuto"), hint: "", run: () => void this.codev.setMode("auto") },
      { label: t("cmd.problemsReview"), hint: "", run: () => this.showPanelTab("problems") },
      { label: t("cmd.explainActive"), hint: "", run: () => { this.showView("explain"); void this.explain.run(); } },
      { label: t("cmd.settings"), hint: "", run: () => this.showView("settings") },
      { label: t("cmd.board"), hint: "", run: () => this.openSpecial("board") },
      { label: t("cmd.studio"), hint: "", run: () => this.openSpecial("studio") },
      { label: t("cmd.learn"), hint: "", run: () => this.openSpecial("learn") },
      { label: t("cmd.manager"), hint: "", run: () => this.openSpecial("manager") },
      { label: t("cmd.theatre"), hint: "", run: () => { this.openSpecial("theatre"); this.theatre.showMode("trace"); } },
      { label: t("cmd.pipeline"), hint: "", run: () => { this.openSpecial("theatre"); this.theatre.showMode("pipeline"); } },
      { label: t("cmd.harness"), hint: "", run: () => this.openSpecial("harness") },
    ];
    this.palette.open(">", [...acts, ...views]);
  }

  /** Repaint the status bar from the real state. */
  async updateStatus(): Promise<void> {
    const mode = $(".sb-mode");
    mode.textContent = `Co-Dev: ${t(`mode.${this.codev.mode}`)}`;
    // Linguagem do separador activo (pela extensão — client-side, sem simulação).
    $(".sb-lang").textContent = this.openTab ? langLabel(this.openTab) : "";
    const branchEl = $(".sb-branch");
    const blameEl = $(".sb-blame");
    if (this.ws.open) {
      const r = await api.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], this.ws.root).catch(() => null);
      branchEl.textContent = r && r.code === 0 ? `⑂ ${r.stdout.trim()}` : "";
      // Blame do ficheiro activo: o último autor REAL que tocou o ficheiro, do git.
      if (this.openTab) {
        const b = await api.exec("git", ["log", "-1", "--format=%an · %cr", "--", this.openTab], this.ws.root).catch(() => null);
        blameEl.textContent = b && b.code === 0 ? b.stdout.trim() : "";
      } else {
        blameEl.textContent = "";
      }
    } else {
      branchEl.textContent = "";
      blameEl.textContent = "";
    }
  }

  /** Abre o Quadro, o Estúdio, o Percurso ou o Gestor a ocupar a área do editor (padrão
   * welcome/diff — não é um painel da sidebar). Abrir um ficheiro/diff fecha a vista especial. */
  openSpecial(view: "board" | "studio" | "learn" | "manager" | "theatre" | "harness"): void {
    this.special = view;
    $("#board").classList.toggle("hidden", view !== "board");
    $("#studio").classList.toggle("hidden", view !== "studio");
    $("#learn").classList.toggle("hidden", view !== "learn");
    $("#manager").classList.toggle("hidden", view !== "manager");
    $("#theatre").classList.toggle("hidden", view !== "theatre");
    $("#harness").classList.toggle("hidden", view !== "harness");
    const crumb: Record<string, string> = { board: "board.title", studio: "studio.title", learn: "ln.title", manager: "mg.title", theatre: "th.title", harness: "hx.title" };
    $(".breadcrumb").textContent = t(crumb[view]);
    if (view === "board") void this.board.refresh();
    else if (view === "studio") void this.studio.refresh();
    else if (view === "learn") void this.learn.refresh();
    else if (view === "theatre") this.theatre.refresh();
    else if (view === "harness") void this.harness.refresh();
    else void this.manager.refresh();
  }

  closeSpecial(): void {
    if (!this.special) return;
    this.special = "";
    $("#board").classList.add("hidden");
    $("#studio").classList.add("hidden");
    $("#learn").classList.add("hidden");
    $("#manager").classList.add("hidden");
    $("#theatre").classList.add("hidden");
    $("#harness").classList.add("hidden");
  }

  private showView(view: string): void {
    $(".view-explorer").classList.toggle("hidden", view !== "explorer");
    $(".view-search").classList.toggle("hidden", view !== "search");
    $(".view-scm").classList.toggle("hidden", view !== "scm");
    $(".view-remote").classList.toggle("hidden", view !== "remote");
    $(".view-containers").classList.toggle("hidden", view !== "containers");
    $(".view-infra").classList.toggle("hidden", view !== "infra");
    $(".view-account").classList.toggle("hidden", view !== "account");
    $(".view-changelog").classList.toggle("hidden", view !== "changelog");
    $(".view-debug").classList.toggle("hidden", view !== "debug");
    $(".view-tests").classList.toggle("hidden", view !== "tests");
    $(".view-explain").classList.toggle("hidden", view !== "explain");
    $(".view-extensions").classList.toggle("hidden", view !== "extensions");
    $(".view-providers").classList.toggle("hidden", view !== "providers");
    $(".view-team").classList.toggle("hidden", view !== "team");
    $(".view-codevhub").classList.toggle("hidden", view !== "codevhub");
    $(".view-settings").classList.toggle("hidden", view !== "settings");
    document.querySelectorAll(".activity button[data-view]").forEach((b) => {
      b.classList.toggle("on", (b as HTMLElement).dataset.view === view);
    });
    if (view === "scm") { void this.scm.refresh(); void this.gitflow.refresh(); }
    if (view === "tests") void this.tests.refresh();
    if (view === "search") this.search.focus();
    if (view === "remote") void this.remote.refresh();
    if (view === "containers") void this.containers.refresh();
    if (view === "infra") void this.infra.refresh();
    if (view === "account") void this.account.refresh();
    if (view === "changelog") void this.changelog.refresh();
    if (view === "extensions") void this.extensions.refresh();
    if (view === "providers") void this.providers.refresh();
    if (view === "team") void this.team.refresh();
    if (view === "codevhub") void this.codevhub.refresh();
    if (view === "settings") void this.settings.refresh();
  }

  /** Aplica (ou limpa) o harness do projecto às superfícies que ele governa: o ceiling ao
   * dock Co-Dev e o routing papel→modelo ao Team. Chamado no arranque e ao mudar o ficheiro. */
  private applyHarness(cfg: HarnessConfig | null): void {
    this.harnessCfg = cfg;
    this.codev.setCeiling(cfg ? cfg.ceiling : null);
    this.team.setRouting(cfg ? cfg.routing : null);
  }

  /** Abre um markdown REAL do workspace como tab normal do editor — ficheiros criados
   * depois do load inicial são lidos agora do disco (a fonte é o disco, nunca inventada). */
  async openDoc(rel: string): Promise<void> {
    if (!this.ws.buffers.has(rel)) {
      const raw = await api.readTextFile(`${this.ws.root}/${rel}`);
      this.ws.disk.set(rel, raw);
      this.ws.setBuffer(rel, raw);
      this.renderTree();
    }
    this.openFile(rel);
  }

  async pickAndOpen(): Promise<void> {
    try {
      const path = await api.pickFolder();
      if (path) await this.open(path);
    } catch (e) {
      toast(String(e));
    }
  }

  async open(path: string): Promise<void> {
    const loaded = await this.ws.openFolder(path);
    // Aquecer os servidores LSP de sessão do projecto (a 1.ª indexação pode demorar;
    // começar já torna rename/diagnostics utilizáveis mais cedo). Nunca bloqueia o open.
    void api.lspStart(this.ws.root).catch(() => { /* sem backend/LSP */ });
    document.title = `${this.ws.name} — dxtutor`;
    this.renderTree();
    $(".editor-empty")?.classList.toggle("hidden", false);
    const note = loaded.skipped ? ` · ${loaded.skipped} skipped` : "";
    toast(`${this.ws.name}: ${loaded.files.length} files${note}`);
    // Repor a conversa persistida desta raiz (ficheiro em configDir, nunca localStorage)
    // ANTES de qualquer mensagem nova — o restauro substitui a conversa em memória.
    await this.codev.loadHistory();
    // O harness do projecto (.dxtutor/harness.toml) é lido no arranque: o ceiling governa
    // o dock e o routing o Team desde o primeiro turno.
    this.applyHarness(await this.harness.load().catch(() => null));
    void this.updateStatus();
  }

  private renderTree(): void {
    this.explorer.render(this.ws.tree(), this.ws.name);
  }

  openFile(rel: string): void {
    const content = this.ws.buffers.get(rel);
    if (content === undefined) return;
    this.closeSpecial();
    if (!this.openTabs.includes(rel)) this.openTabs.push(rel);
    this.openTab = rel;
    $(".editor-empty")?.remove();
    this.editor.open(rel, content);
    this.outline.update(rel, content);
    this.updateOutlineVisibility();
    this.renderTabs();
    $(".breadcrumb").textContent = `${this.ws.name} › ${rel}`;
    this.codev.refreshDock(); // o chip @ e os cartões seguem a tab activa
    void this.updateStatus();
  }

  closeTab(rel: string): void {
    const i = this.openTabs.indexOf(rel);
    if (i < 0) return;
    this.openTabs.splice(i, 1);
    this.editor.closeModel(rel);
    if (this.openTab === rel) {
      const next = this.openTabs[i] ?? this.openTabs[i - 1] ?? "";
      if (next) this.openFile(next);
      else { this.openTab = ""; this.renderTabs(); this.updateOutlineVisibility(); $(".breadcrumb").textContent = ""; this.codev.refreshDock(); }
    } else {
      this.renderTabs();
    }
  }

  private renderTabs(): void {
    const tabs = $(".tabs");
    tabs.innerHTML = "";
    const dirty = new Set(
      [...this.ws.buffers.keys()].filter((r) => this.ws.disk.get(r) !== this.ws.buffers.get(r)),
    );
    for (const rel of this.openTabs) {
      const t = document.createElement("div");
      t.className = "tab" + (rel === this.openTab ? " on" : "");
      const name = rel.split("/").pop() ?? rel;
      t.innerHTML = `<span class="tab-ic">${fileIcon(name)}</span><span class="nm"></span>` +
        `<span class="x">${dirty.has(rel) ? '<span class="dot">●</span>' : svg("close")}</span>`;
      (t.querySelector(".nm") as HTMLElement).textContent = name;
      (t.querySelector(".nm") as HTMLElement).title = rel;
      (t.querySelector(".tab-ic") as HTMLElement).addEventListener("click", () => this.openFile(rel));
      t.querySelector(".nm")!.addEventListener("click", () => this.openFile(rel));
      t.querySelector(".x")!.addEventListener("click", (e) => { e.stopPropagation(); this.closeTab(rel); });
      tabs.appendChild(t);
    }
  }

  async autosave(): Promise<void> {
    try {
      const written = await this.ws.flush();
      if (written.length) toast(t("toast.saved", { files: written.join(", ") }));
      this.renderTabs();
    } catch (e) {
      toast(t("toast.saveFailed", { err: String(e) }));
    }
  }

  /** Abre a vista de diff de um ficheiro alterado: lado original = conteúdo em HEAD
   * (git_show HEAD:<rel>), lado novo = o buffer vivo. Fecha ao abrir outro ficheiro. */
  async openDiff(rel: string): Promise<void> {
    const buffer = this.ws.buffers.get(rel);
    if (buffer === undefined) return;
    this.closeSpecial();
    // Ficheiro novo (sem blob em HEAD) → lado original vazio, honesto.
    const original = await api.gitShow(this.ws.root, `HEAD:${rel}`).catch(() => "");
    $(".editor-empty")?.remove();
    this.editor.showDiff(rel, original, buffer);
    this.updateOutlineVisibility();
    $(".breadcrumb").textContent = `${this.ws.name} › ${t("diff.crumb", { rel })}`;
  }

  // ── CRUD de ficheiros (Explorer): operações reais no disco + estado local coerente ──
  readonly fileops = {
    create: async (rel: string): Promise<void> => {
      await api.createPath(`${this.ws.root}/${rel}`, false);
      this.ws.disk.set(rel, "");
      this.ws.setBuffer(rel, "");
      this.renderTree();
    },
    rename: async (from: string, to: string): Promise<void> => {
      await this.autosave(); // buffers sujos vão a disco antes de mover
      await api.renamePath(`${this.ws.root}/${from}`, `${this.ws.root}/${to}`);
      const remap = (rel: string): string | null =>
        rel === from ? to : rel.startsWith(`${from}/`) ? to + rel.slice(from.length) : null;
      for (const rel of [...this.ws.buffers.keys()]) {
        const next = remap(rel);
        if (next === null) continue;
        if (this.openTabs.includes(rel)) this.closeTab(rel);
        const content = this.ws.buffers.get(rel) ?? "";
        this.ws.buffers.delete(rel);
        this.ws.buffers.set(next, content);
        const disk = this.ws.disk.get(rel);
        this.ws.disk.delete(rel);
        if (disk !== undefined) this.ws.disk.set(next, disk);
      }
      this.renderTree();
    },
    remove: async (rel: string): Promise<void> => {
      await api.deletePath(`${this.ws.root}/${rel}`);
      for (const k of [...this.ws.buffers.keys()]) {
        if (k !== rel && !k.startsWith(`${rel}/`)) continue;
        if (this.openTabs.includes(k)) this.closeTab(k);
        this.ws.buffers.delete(k);
        this.ws.disk.delete(k);
      }
      this.renderTree();
    },
  };

  private async uiNewFile(dirRel: string): Promise<void> {
    if (!this.ws.open) return;
    const name = prompt(t("tree.promptNewFile"))?.trim();
    if (!name) return;
    const rel = dirRel ? `${dirRel}/${name}` : name;
    try {
      await this.fileops.create(rel);
      this.openFile(rel);
    } catch (e) {
      toast(t("tree.opFailed", { err: String(e) }));
    }
  }

  private async uiRename(rel: string): Promise<void> {
    const base = rel.split("/").pop() ?? rel;
    const name = prompt(t("tree.promptRename"), base)?.trim();
    if (!name || name === base) return;
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    try {
      await this.fileops.rename(rel, dir ? `${dir}/${name}` : name);
    } catch (e) {
      toast(t("tree.opFailed", { err: String(e) }));
    }
  }

  private async uiDelete(rel: string): Promise<void> {
    // delete_path é destrutivo: pede SEMPRE confirmação no UI (o gate usa fileops.remove
    // directamente, sobre um ficheiro criado pelo próprio gate).
    if (!window.confirm(t("tree.confirmDelete", { path: rel }))) return;
    try {
      await this.fileops.remove(rel);
    } catch (e) {
      toast(t("tree.opFailed", { err: String(e) }));
    }
  }

  // A thin handle the headless harness drives to prove real open/edit/save end-to-end.
  private exposeForHarness(): void {
    (window as unknown as { DXNEXT: unknown }).DXNEXT = {
      open: (p: string) => this.open(p),
      openFile: (rel: string) => this.openFile(rel),
      edit: (rel: string, content: string) => {
        this.ws.setBuffer(rel, content);
        return this.autosave();
      },
      state: () => ({
        root: this.ws.root,
        files: [...this.ws.buffers.keys()],
        openTab: this.openTab,
        desktop: isDesktop(),
      }),
    };
  }
}

/** Headless proof: open the given folder, open a file, edit it, autosave, and confirm the
 * change actually reached disk by reloading the workspace. Writes the report and quits. */
async function runSelftest(app: App, root: string): Promise<void> {
  const rep: Record<string, unknown> = { next: true, steps: {} };
  const steps = rep.steps as Record<string, unknown>;
  const upTo = async (pred: () => boolean, ms: number): Promise<boolean> => {
    const t0 = performance.now();
    while (!pred() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 120));
    return pred();
  };
  try {
    // Welcome: before opening a folder, the rich welcome shows real-action cards + hero.
    const wl = document.getElementById("welcome");
    const cards = wl ? wl.querySelectorAll(".wbtn").length : 0;
    steps.welcome = { ok: !!wl?.querySelector(".wl-hero") && cards >= 2, cards };
    await app.open(root);
    const files = [...app.ws.buffers.keys()];
    steps.open = { root: app.ws.root, files: files.length };
    // Edit a safe text file (README), never Cargo.toml/.rs — keeps the crate valid for LSP.
    const first = files.find((p) => p.endsWith(".md")) ?? files.find((p) => !/\.(toml|rs)$/.test(p)) ?? files[0];
    app.openFile(first);
    steps.openFile = { file: first, openTab: app.openTab };
    const marker = `\n// dxnext-autosave-${files.length}\n`;
    const next = (app.ws.buffers.get(first) ?? "") + marker;
    app.ws.setBuffer(first, next);
    await app.autosave();
    const reloaded = await api.loadWorkspace(app.ws.root);
    const onDisk = reloaded.files.find((f) => f.path === first)?.content ?? "";
    steps.autosave = { ok: onDisk.includes(marker.trim()), file: first };
    steps.treeReal = { hasNoDemoPaths: ![...app.ws.buffers.keys()].some((p) => /crates\/(lexer|store)|db\/migrations/.test(p)) };
    // Real terminal: run a command via run_shell and confirm its actual output streamed in.
    const code = await app.terminal.run("echo dxnext-term-ok && false");
    await new Promise((r) => setTimeout(r, 200));
    const termText = (document.querySelector(".term-out")?.textContent ?? "");
    steps.terminal = {
      ok: termText.includes("dxnext-term-ok") && termText.includes("exit 1"),
      exitShown: code === 1,
    };
    // Kill: start a long command, kill it, and confirm it ends (non-zero) promptly.
    const longRun = app.terminal.run("sleep 30");
    await new Promise((r) => setTimeout(r, 300));
    const killedId = app.terminal.killCurrent();
    const killedCode = await Promise.race([
      longRun,
      new Promise<number>((r) => setTimeout(() => r(999), 5000)),
    ]);
    steps.kill = { ok: killedId !== null && killedCode !== 0 && killedCode !== 999, killedCode };
    // PTY: uma shell interactiva VERDADEIRA — `read x` fica à espera de stdin e recebe a
    // resposta por pty_write, coisa que o caminho run_shell (uma linha, sem stdin) não faz.
    // No fim, stopPty tem de deixar 0 listeners Tauri vivos (sem fugas no run xvfb).
    try {
      const started = await app.terminal.startPty();
      if (!started) {
        steps.pty = { ok: false, error: "pty_spawn failed" };
      } else {
        await new Promise((r) => setTimeout(r, 400)); // a shell a arrancar
        app.terminal.ptySend('read x; echo "pty-got:$x"\n');
        await new Promise((r) => setTimeout(r, 500)); // o read fica pendurado em stdin
        const beforeAnswer = app.terminal.ptyText().includes("pty-got:dxnext-answer");
        app.terminal.ptySend("dxnext-answer\n");
        const answered = await upTo(() => app.terminal.ptyText().includes("pty-got:dxnext-answer"), 8000);
        await app.terminal.stopPty();
        steps.pty = {
          ok: answered && !beforeAnswer && app.terminal.ptyListeners() === 0,
          answered, beforeAnswer, listeners: app.terminal.ptyListeners(),
        };
      }
    } catch (e) {
      steps.pty = { ok: false, error: String(e) };
    }
    // SCM: the autosave above dirtied a file → it must show as a real change; committing it
    // clears the list and the new commit heads the log.
    await app.scm.refresh();
    const changedBefore = app.scm.changeCount;
    const msg = `dxnext scm proof ${files.length}`;
    (document.querySelector(".scm-msg") as HTMLInputElement).value = msg;
    const committed = await app.scm.commit();
    steps.scm = {
      ok: changedBefore > 0 && committed && app.scm.changeCount === 0 && app.scm.head?.subject === msg,
      changedBefore,
      head: app.scm.head?.subject,
    };
    // Co-Dev: a real turn through llm_chat with the tool loop. A prompt that needs a tool
    // must run it for real and come back stamped origin "tutor-llm". Host-tolerant: if no
    // provider is configured (no key, no Ollama), the step is skipped rather than failed.
    await app.codev.loadKeys();
    if (!app.codev.hasProvider()) {
      steps.codev = "skipped (no provider configured)";
    } else {
      try {
        const turn = await app.codev.chat(
          "Use the run_command tool to run exactly: echo dxnext-codev-ok . Then reply with the word done.",
        );
        steps.codev = { ok: turn.origin === "tutor-llm" && turn.toolsRun.length > 0, origin: turn.origin, toolsRun: turn.toolsRun };
      } catch (e) {
        steps.codev = { ok: false, error: String(e) };
      }
    }
    // Streaming: a resposta chega por eventos parciais (llm://token) ANTES do fim, e o Stop
    // cancela de facto — depois do cancel a bolha não cresce mais (guarda por requestId
    // contra fragmentos tardios). Host-tolerante: skip honesto sem provedor com streaming.
    try {
      await app.codev.loadModels();
      if (!app.codev.hasStreamModel()) {
        steps.stream = "skipped (no streaming provider)";
      } else {
        const r1 = await app.codev.chatStream("Count from 1 to 20, one number per line, no other text.");
        const partial = !r1.cancelled && r1.error === null && r1.tokens >= 2 && r1.text.length > 0;
        const p2 = app.codev.chatStream("Count from 1 to 500, one number per line, no other text.");
        const sawTok = await upTo(() => app.codev.streamTokens() >= 1, 60000);
        app.codev.cancelStream();
        const lenAtCancel = app.codev.streamTextLive().length;
        await new Promise((r) => setTimeout(r, 1500));
        const lenAfter = app.codev.streamTextLive().length;
        const r2 = await p2;
        steps.stream = {
          ok: partial && sawTok && r2.cancelled === true && lenAfter === lenAtCancel,
          tokens: r1.tokens, model: r1.model, cancelledAfterTokens: r2.tokens, lenAtCancel, lenAfter,
        };
      }
    } catch (e) {
      steps.stream = { ok: false, error: String(e) };
    }
    // Git graph: the DAG must have one node per commit and, because the seed has a real
    // merge, at least 2 lanes (not a fake linear list).
    await app.scm.refresh();
    const gi = app.scm.graphInfo();
    steps.graph = { ok: gi.nodes >= 4 && gi.lanes >= 2 && gi.edges >= gi.nodes - 1, ...gi };
    // Remote: reads the real .devcontainer of the seed folder (present + image), no simulation.
    await app.remote.refresh();
    const rm = app.remote.state();
    steps.remote = { ok: rm.present && !!rm.image, ...rm };
    // Containers: a pane lista containers/imagens do motor REAL (get_sandbox_engine) via o
    // CLI do próprio motor — formato por motor, nunca se assume docker. Alvo observável: a
    // sessão devcontainer PRÓPRIA do gate (devcontainer_session_up/_down sobre o seed)
    // aparece na lista a correr e desaparece ao parar — nunca se mexe em containers alheios.
    // SKIP honesto quando o motor configurado não existe no host.
    try {
      const engine = await api.getSandboxEngine();
      const enginePresent = engine !== "host" &&
        (await api.exec("sh", ["-c", `command -v ${engine}`], app.ws.root)).code === 0;
      if (!enginePresent) {
        steps.containers = `skipped (engine ${engine} not on host)`;
      } else {
        const base = await app.containers.refresh();
        if (base.error) {
          steps.containers = { ok: false, error: base.error };
        } else {
          const up = await api.devcontainerSessionUp(app.ws.root);
          const sessName = (await api.devcontainerSessionStatus(app.ws.root)).name;
          const withSess = await app.containers.refresh();
          const listed = withSess.containers.some((c) => c.name === sessName && c.running);
          const inDom = !!document.querySelector(`#containers .ct-row[data-name="${sessName}"]`);
          const rowsMirror = document.querySelectorAll("#containers .ct-list-c .ct-row").length === withSess.containers.length;
          await api.devcontainerSessionDown(app.ws.root);
          const after = await app.containers.refresh();
          const gone = !after.containers.some((c) => c.name === sessName);
          steps.containers = {
            ok: up.ok && listed && inDom && rowsMirror && gone && withSess.images.length > 0,
            engine, listed, inDom, gone, containers: withSess.containers.length, images: withSess.images.length,
          };
        }
      }
    } catch (e) {
      steps.containers = { ok: false, error: String(e) };
    }
    const containersOk = typeof steps.containers === "string" || (steps.containers as { ok: boolean }).ok;
    // Debug: real gdb session over the seed's compiled C binary. Open the .c, break in `add`,
    // launch → run to the breakpoint, and read a real local. Host-tolerant: skip without gdb.
    const gdbOk = await api.debugAvailable().catch(() => false);
    const cfile = [...app.ws.buffers.keys()].find((p) => p.endsWith("dbg.c"));
    if (gdbOk && cfile) {
      try {
        app.openFile(cfile);
        app.editor.addBreakpoint(cfile, 1); // line 1: int add(...) { int s = a+b; ... }
        const stop = await app.debug.launch("dbg_bin");
        const snap = app.debug.snapshot();
        steps.debug = {
          ok: !!stop?.stopped && !stop?.exited && stop?.func === "add" && snap.vars.some((v) => v.name === "a" && v.value === "2"),
          func: stop?.func, vars: snap.vars.map((v) => `${v.name}=${v.value}`), stack: snap.stack,
        };
        await app.debug.stop();
      } catch (e) {
        steps.debug = { ok: false, error: String(e) };
      }
    } else {
      steps.debug = "skipped (no gdb or no C binary)";
    }
    // Outline: the real symbols of a .rs file via file_outline (must find `fn main`).
    const rs = [...app.ws.buffers.keys()].find((p) => p.endsWith("main.rs"));
    if (rs) {
      const syms = await app.outline.fetch(rs, app.ws.buffers.get(rs) ?? "");
      steps.outline = { ok: syms.some((s) => s.name === "main"), symbols: syms.map((s) => s.name) };
    } else {
      steps.outline = "skipped (no .rs)";
    }
    // Review: real analyzers on a .py with an undefined name (ruff → F821). Host-tolerant.
    const py = [...app.ws.buffers.keys()].find((p) => p.endsWith("review_me.py"));
    if (py) {
      const findings = await app.review.run(py);
      const f821 = findings.some((f) => (f.rule ?? "").includes("F821") || /undefined name/i.test(f.message));
      steps.review = f821
        ? { ok: true, count: findings.length, analyzers: [...new Set(findings.map((f) => f.analyzer))] }
        : (findings.length === 0 ? "skipped (no analyzer produced findings — ruff absent?)" : { ok: false, findings: findings.map((f) => f.message) });
    } else {
      steps.review = "skipped (no .py)";
    }
    // Explain: a real governed llm_chat turn over the active file (origin tutor-llm). The
    // openTab is set by earlier steps. Host-tolerant: skip when no provider is configured.
    if (app.codev.hasProvider() && app.openTab) {
      try {
        const r = await app.explain.run();
        steps.explain = { ok: r?.origin === "tutor-llm", origin: r?.origin, len: r?.text.length ?? 0 };
      } catch (e) {
        steps.explain = { ok: false, error: String(e) };
      }
    } else {
      steps.explain = "skipped (no provider or no file)";
    }
    // Chrome: status bar shows the real git branch; the palette filters real files; the
    // Co-Dev mode switches with the real codev_policy.
    await app.updateStatus();
    const branch = (document.querySelector(".sb-branch")?.textContent ?? "").replace(/[^a-z0-9/_-]/gi, "").trim();
    app.openFiles();
    app.palette.setQuery("README");
    const palHits = app.palette.results();
    app.palette.close();
    await app.codev.setMode("auto");
    const modeNote = document.querySelector(".cd-modenote")?.textContent ?? "";
    steps.chrome = {
      ok: branch.length > 0 && palHits.some((h) => h.includes("README")) && app.codev.mode === "auto" && modeNote.length > 0,
      branch, palHits: palHits.length, mode: app.codev.mode,
    };
    await app.codev.setMode("assist");
    // Toolbar: the menu bar opens real items (localized — the menus follow the live locale);
    // the search box opens the file palette.
    const fileItems = app.menubar.openMenu(t("menu.file"));
    app.menubar.close();
    (document.querySelector(".tb-search") as HTMLButtonElement).click();
    const palOpen = app.palette.isOpen;
    app.palette.close();
    steps.toolbar = { ok: fileItems.includes(t("menu.openFolder")) && fileItems.includes(t("menu.newFile")) && palOpen, fileItems };
    const toolbarOk = (steps.toolbar as { ok: boolean }).ok;
    const chromeOk = (steps.chrome as { ok: boolean }).ok;
    const explainOk = typeof steps.explain === "string" || (steps.explain as { ok: boolean }).ok;
    const reviewOk = typeof steps.review === "string" || (steps.review as { ok: boolean }).ok;
    const outlineOk = typeof steps.outline === "string" || (steps.outline as { ok: boolean }).ok;
    const debugOk = typeof steps.debug === "string" || (steps.debug as { ok: boolean }).ok;
    const codevOk = steps.codev === "skipped (no provider configured)" || (steps.codev as { ok: boolean }).ok;
    const streamOk = typeof steps.stream === "string" || (steps.stream as { ok: boolean }).ok;
    // LSP: resolve_hover over a known symbol must return real rust-analyzer markdown. The seed
    // repo is a tiny Cargo crate so RA can resolve. Host-tolerant: skip if RA absent/empty.
    try {
      const rsFile = [...app.ws.buffers.keys()].find((p) => p.endsWith("main.rs"));
      if (rsFile) {
        const text = app.ws.buffers.get(rsFile) ?? "";
        const absFile = `${app.ws.root}/${rsFile}`;
        // hover over the `x` binding on the `let x` line.
        const lineNo = text.split("\n").findIndex((l) => l.includes("let x")) + 1;
        const col = text.split("\n")[lineNo - 1].indexOf("x") + 1;
        const hv = await api.resolveHover(app.ws.root, absFile, lineNo, col, text);
        // Definition: jump from the `x` use in println to its `let x` line.
        const useLine = text.split("\n").findIndex((l) => l.includes('"{x}"')) + 1;
        const useCol = useLine > 0 ? text.split("\n")[useLine - 1].indexOf("{x}") + 2 : 0;
        const def = useLine > 0 ? await api.resolveDefinition(app.ws.root, absFile, useLine, useCol, text).catch(() => null) : null;
        steps.lsp = hv
          ? { ok: hv.length > 0, sample: hv.slice(0, 60), defLine: def?.line ?? null, defResolved: !!def }
          : "skipped (rust-analyzer returned nothing)";
      } else {
        steps.lsp = "skipped (no .rs file)";
      }
    } catch (e) {
      steps.lsp = "skipped (" + String(e).slice(0, 60) + ")";
    }
    const lspOk = typeof steps.lsp === "string" || (steps.lsp as { ok: boolean }).ok;
    // References: resolve_references (rust-analyzer one-shot, a MESMA família do hover/
    // definition) sobre o binding `x` do seed devolve TODAS as ocorrências — a declaração
    // (let x) E o uso no println. Host-tolerante: skip se o rust-analyzer não resolver.
    try {
      const rsFile = [...app.ws.buffers.keys()].find((p) => p.endsWith("main.rs"));
      if (rsFile) {
        const text = app.ws.buffers.get(rsFile) ?? "";
        const lines = text.split("\n");
        const declLine = lines.findIndex((l) => l.includes("let x")) + 1;
        const declCol = declLine > 0 ? lines[declLine - 1].indexOf("x") + 1 : 0;
        const useLine = lines.findIndex((l) => l.includes('"{x}"')) + 1;
        const absFile = `${app.ws.root}/${rsFile}`;
        let refs: ResolvedDef[] = [];
        // O one-shot tem watchdog/orçamento próprios; repetir cobre o aquecimento lento.
        for (let i = 0; i < 3 && refs.length === 0; i++) {
          if (i) await new Promise((r) => setTimeout(r, 3000));
          refs = await api.resolveReferences(app.ws.root, absFile, declLine, declCol, text).catch(() => []);
        }
        steps.references = refs.length
          ? {
              ok: declLine > 0 && useLine > 0 && refs.some((r) => r.line === declLine) && refs.some((r) => r.line === useLine),
              count: refs.length, lines: refs.map((r) => r.line), declLine, useLine,
            }
          : "skipped (rust-analyzer returned nothing)";
      } else {
        steps.references = "skipped (no .rs file)";
      }
    } catch (e) {
      steps.references = "skipped (" + String(e).slice(0, 60) + ")";
    }
    const referencesOk = typeof steps.references === "string" || (steps.references as { ok: boolean }).ok;
    // Rename: lsp_rename (sessão rust-analyzer persistente) renomeia o binding x→y; o
    // WorkspaceEdit é aplicado via buffers do workspace (setBuffer + autosave), por isso
    // AMBAS as ocorrências mudam no buffer E no disco. O conteúdo original é reposto no
    // fim — os gates seguintes (search/outline/tests) dependem do seed intacto.
    try {
      const rsFile = [...app.ws.buffers.keys()].find((p) => p.endsWith("main.rs"));
      if (rsFile) {
        const before = app.ws.buffers.get(rsFile) ?? "";
        const lines = before.split("\n");
        const declLine = lines.findIndex((l) => l.includes("let x")) + 1;
        const declCol = declLine > 0 ? lines[declLine - 1].indexOf("x") + 1 : 0;
        app.openFile(rsFile); // didOpen → a sessão rust-analyzer vê o buffer vivo
        let res = await app.editor.renameAt(rsFile, declLine, declCol, "y").catch(() => null);
        // null = sem servidor (estável → skip já); "indexing" = aquecer → repetir.
        for (let i = 0; i < 6 && res === "indexing"; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          res = await app.editor.renameAt(rsFile, declLine, declCol, "y").catch(() => null);
        }
        if (typeof res !== "number") {
          steps.rename = res === "indexing"
            ? "skipped (rust-analyzer still indexing)"
            : "skipped (no rust-analyzer session)";
        } else {
          const buf = app.ws.buffers.get(rsFile) ?? "";
          const bufOk = buf.includes("let y") && buf.includes("{y}") && !buf.includes("let x") && !buf.includes("{x}");
          const disk = (await api.exec("cat", [rsFile], app.ws.root)).stdout;
          const diskOk = disk.includes("let y") && disk.includes("{y}");
          steps.rename = { ok: bufOk && diskOk, files: res, bufOk, diskOk };
          // Repor o seed (buffer + disco) — o rename em si já ficou provado acima.
          app.editor.setContent(rsFile, before);
          await app.autosave();
        }
      } else {
        steps.rename = "skipped (no .rs file)";
      }
    } catch (e) {
      steps.rename = "skipped (" + String(e).slice(0, 60) + ")";
    }
    const renameOk = typeof steps.rename === "string" || (steps.rename as { ok: boolean }).ok;
    // Diagnostics: um erro de tipos introduzido no ficheiro PRÓPRIO do gate
    // (src/bin/diag_gate.rs, alvo [[bin]] real do seed) chega como publishDiagnostics da
    // sessão rust-analyzer (evento lsp://diagnostics) e pinta um marcador Monaco de ERRO
    // na linha certa. O erro vive só no buffer/overlay e é reposto no fim — o crate em
    // disco volta a estar válido para os gates que correm cargo (tests).
    try {
      const dg = [...app.ws.buffers.keys()].find((p) => p.endsWith("diag_gate.rs"));
      const raPresent = (await api.exec("sh", ["-c", "command -v rust-analyzer"], app.ws.root)).code === 0;
      if (dg && raPresent) {
        const before = app.ws.buffers.get(dg) ?? "";
        const badLine = before.split("\n").findIndex((l) => l.includes("let value")) + 1;
        app.openFile(dg); // model + didOpen
        app.editor.setContent(dg, before.replace("= 1;", '= "oops";')); // E0308 na badLine
        const errAt = () => app.editor.markers(dg).filter((mk) => mk.error && mk.line === badLine);
        await upTo(() => errAt().length > 0, 90000); // a 1.ª análise pode demorar
        const hit = errAt();
        steps.diagnostics = {
          ok: badLine > 0 && hit.length > 0,
          line: badLine, message: hit[0]?.message.slice(0, 60) ?? "", markers: app.editor.markers(dg).length,
        };
        // Repor o ficheiro do gate (buffer + overlay LSP + disco).
        app.editor.setContent(dg, before);
        await app.autosave();
      } else {
        steps.diagnostics = dg
          ? "skipped (rust-analyzer missing on host)"
          : "skipped (no diag_gate.rs in seed)";
      }
    } catch (e) {
      steps.diagnostics = { ok: false, error: String(e) };
    }
    const diagnosticsOk = typeof steps.diagnostics === "string" || (steps.diagnostics as { ok: boolean }).ok;
    // Tabs: start from a clean tab bar, open two files → two tabs; switch; close one → one.
    [...app.openTabs].forEach((t) => app.closeTab(t));
    const two = [...app.ws.buffers.keys()].slice(0, 2);
    app.openFile(two[0]);
    app.openFile(two[1]);
    const openedTwo = app.openTabs.length === 2 && app.openTab === two[1];
    app.openFile(two[0]);
    const switched = app.openTab === two[0];
    app.closeTab(two[1]);
    steps.tabs = {
      ok: openedTwo && switched && app.openTabs.length === 1 && !app.editor.hasModel(two[1]) && app.openTabs[0] === two[0],
      openTabs: app.openTabs.length,
    };
    // Search: a query that must exist in the seed (fn main) returns real file:line hits.
    const hits = await app.search.run("fn main");
    steps.search = { ok: hits.length > 0 && hits.some((h) => h.text.includes("fn main")), count: hits.length };
    // Session (Claude-Code style): Co-Dev opens a git worktree on a codev/ branch; a write
    // lands there (NOT in the base tree); Deliver integrates it into the base branch and the
    // worktree is gone. Provider-free — proves the isolation+integration pipeline for real.
    // O gate manager (mais abaixo) observa este ciclo em SÓ-LEITURA: snapshots do que o
    // Gestor de missões lista (codev_session_list) com a sessão aberta e após o deliver.
    const mgrSeen = { slug: "", open: false, openDom: false, goneAfter: false };
    try {
      const fileAt = (dir: string) => api.exec("sh", ["-c", "test -f SESSION_PROOF.md"], dir).then((r) => r.code === 0);
      const dirAt = (dir: string) => api.exec("sh", ["-c", `test -d "${dir}"`], app.ws.root).then((r) => r.code === 0);
      const sess = await app.codev.startSession("harness-proof");
      const wtBranch = (await api.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], sess.worktree)).stdout.trim();
      mgrSeen.slug = sess.slug;
      await app.manager.refresh();
      mgrSeen.open = app.manager.listedSlugs().indexOf(sess.slug) >= 0;
      mgrSeen.openDom = !!document.querySelector(`#manager [data-sess="${sess.slug}"]`);
      await app.codev.toolWrite("SESSION_PROOF.md", "codev session proof\n");
      const inWorktree = await fileAt(sess.worktree);
      const notInBaseYet = !(await fileAt(app.ws.root));
      const info = await app.codev.deliver("codev: session proof");
      const inBaseNow = await fileAt(app.ws.root);
      const worktreeGone = !(await dirAt(sess.worktree));
      await app.manager.refresh();
      mgrSeen.goneAfter = app.manager.listedSlugs().indexOf(sess.slug) < 0;
      steps.session = {
        ok: wtBranch === sess.branch && inWorktree && notInBaseYet && info.merged && inBaseNow && worktreeGone && app.codev.session === null,
        branch: sess.branch, base: info.base, commit: info.commit,
      };
    } catch (e) {
      steps.session = { ok: false, error: String(e) };
    }
    // CodeMap: the outline is part of the editor — visible with a file open, hidden on welcome.
    const outlineEl = document.getElementById("outline");
    const visibleWithFile = !!app.openTab && outlineEl?.classList.contains("hidden") === false;
    [...app.openTabs].forEach((t) => app.closeTab(t));
    const hiddenOnWelcome = outlineEl?.classList.contains("hidden") === true;
    steps.codemap = { ok: visibleWithFile && hiddenOnWelcome, visibleWithFile, hiddenOnWelcome };
    // Providers: the panel shows the real per-provider state from keys_status (which resolves
    // keys.json → the legacy providers.json → env). Each card's "configured" must equal the
    // backend boolean (Ollama is local → always usable); the key is NEVER rendered in cleartext.
    try {
      await app.providers.refresh();
      const pv = app.providers.state();
      const live = await api.keysStatus();
      const ids = ["claude", "codex", "gemini", "ollama"];
      const match = ids.every((id) => {
        const card = pv.providers.find((p) => p.id === id);
        const expect = id === "ollama" ? true : live[id] === true;
        return card !== undefined && card.configured === expect;
      });
      const panelText = document.getElementById("providers")?.textContent ?? "";
      const leaks = /sk-ant-|sk-[A-Za-z0-9]{12}|AIza[A-Za-z0-9]{10}/.test(panelText);
      steps.providers = {
        ok: pv.loaded && pv.providers.length === 4 && pv.rendered === 4 && match && !leaks,
        configured: pv.providers.filter((p) => p.configured).map((p) => p.id), leaks,
      };
    } catch (e) {
      steps.providers = { ok: false, error: String(e) };
    }
    // Team: the roster panel shows one card per real assistant role, and each role's recommended
    // model is routed over the LIVE list_providers availability. The real assertion: the panel's
    // available-provider set equals the backend's, and no role ever recommends a provider the
    // backend does not report as available (null when none are) — so nothing is simulated, and
    // the key is never rendered in cleartext.
    try {
      await app.team.refresh();
      const tv = app.team.state();
      const live = await api.listProviders();
      const liveAvail = live.filter((p) => p.available).map((p) => p.id).sort();
      const availMatch = JSON.stringify([...tv.providersAvailable].sort()) === JSON.stringify(liveAvail);
      const availSet = new Set(liveAvail);
      const routesReal = tv.roles.every((r) => r.recommended === null || availSet.has(r.recommended));
      const panelText = document.getElementById("team")?.textContent ?? "";
      const leaks = /sk-ant-|sk-[A-Za-z0-9]{12}|AIza[A-Za-z0-9]{10}/.test(panelText);
      steps.team = {
        ok: tv.loaded && tv.roles.length === 8 && tv.rendered === 8 && availMatch && routesReal && !leaks,
        available: tv.providersAvailable, routesReal, availMatch, leaks,
      };
    } catch (e) {
      steps.team = { ok: false, error: String(e) };
    }
    // i18n: the UI boots in pt-AO (the default locale); switching to en through the Settings
    // panel changes visible texts (sidebar header + rebuilt menus); switching back restores
    // them. Pure client-side — never skipped.
    try {
      const explorerLabel = () => document.querySelector(".view-explorer .side-head span")?.textContent ?? "";
      const bootPt = getLocale() === "ptAO";
      const ptLabel = explorerLabel();
      app.settings.setLanguage("en");
      const enLabel = explorerLabel();
      const enMenu = app.menubar.openMenu("File");
      app.menubar.close();
      app.settings.setLanguage("ptAO");
      const backLabel = explorerLabel();
      steps.i18n = {
        ok: bootPt && ptLabel === "Explorador" && enLabel === "Explorer" && backLabel === ptLabel && enMenu.includes("Open Folder…"),
        bootPt, ptLabel, enLabel,
      };
    } catch (e) {
      steps.i18n = { ok: false, error: String(e) };
    }
    // Theme: switching through the Settings panel must actually change the CSS vars the DOM
    // computes (not just a class name); graphite restores the originals.
    try {
      const v = () => getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim();
      const base = v();
      app.settings.setTheme("light");
      const light = v();
      app.settings.setTheme("dark");
      const dark = v();
      app.settings.setTheme("graphite");
      const back = v();
      steps.theme = { ok: base !== light && light !== dark && back === base, base, light, dark };
    } catch (e) {
      steps.theme = { ok: false, error: String(e) };
    }
    // Settings: a key saved through the panel lands in keys.json and is re-read by keys_status;
    // the sandbox engine round-trips through get/set_sandbox_engine. The previous key state is
    // restored exactly (save_key("") removes the entry), and the key value never reaches the DOM.
    try {
      const info = await api.appInfo();
      const keysPath = `${info.configDir}/keys.json`;
      await app.settings.refresh();
      const engine0 = app.settings.state().engine;
      const prevRaw = (await api.exec("sh", ["-c", `cat "${keysPath}" 2>/dev/null || true`], app.ws.root)).stdout;
      let prevKeys: Record<string, string> = {};
      try { prevKeys = prevRaw.trim() ? (JSON.parse(prevRaw) as Record<string, string>) : {}; } catch { prevKeys = {}; }
      const sentinel = `dxnext-gate-${files.length}`;
      await app.settings.saveKey("gemini", sentinel);
      const statusAfterSave = await api.keysStatus();
      const onDisk = (await api.exec("sh", ["-c", `cat "${keysPath}"`], app.ws.root)).stdout;
      const wrote = onDisk.includes(sentinel);
      const badgeOn = app.settings.state().configured.includes("gemini");
      await api.saveKey("gemini", prevKeys["gemini"] ?? "");
      const toHost = await app.settings.setEngine("host");
      const readBack = await api.getSandboxEngine();
      const restoredEngine = await app.settings.setEngine(engine0);
      await app.settings.refresh();
      const panelText = document.getElementById("settings")?.textContent ?? "";
      const inputLeak = [...document.querySelectorAll<HTMLInputElement>("#settings input")].some((i) => i.value.includes(sentinel));
      const leaks = panelText.includes(sentinel) || inputLeak || /sk-ant-|sk-[A-Za-z0-9]{12}|AIza[A-Za-z0-9]{10}/.test(panelText);
      steps.settings = {
        ok: statusAfterSave.gemini === true && wrote && badgeOn &&
          toHost === "host" && readBack === "host" && restoredEngine === engine0 && !leaks,
        engine: engine0, wrote, badgeOn, leaks,
      };
    } catch (e) {
      steps.settings = { ok: false, error: String(e) };
    }
    // GitFlow: iniciar uma feature cria um ramo REAL (git_branch confirma), trabalho
    // committado nele, e finalizar faz merge --no-ff de volta à base e apaga o ramo.
    // O gate usa um ramo próprio (feature/gate) e termina de volta na base, mantendo
    // o grafo com ≥2 lanes (o gate graph já correu; aqui só se re-afirma que não partiu).
    try {
      const base0 = (await api.gitBranch(app.ws.root)) ?? "";
      await app.gitflow.start("feature", "gate");
      const onFlow = (await api.gitBranch(app.ws.root)) === "feature/gate";
      await api.writeFile(app.ws.root, "GITFLOW_GATE.md", "gitflow gate proof\n");
      await api.exec("git", ["add", "-A"], app.ws.root);
      await api.exec("git", ["commit", "-m", "gitflow gate work"], app.ws.root);
      const fin = await app.gitflow.finish();
      const backOnBase = (await api.gitBranch(app.ws.root)) === base0 && fin?.base === base0;
      const branchGone = !(await api.gitBranches(app.ws.root)).includes("feature/gate");
      const integrated = (await api.exec("sh", ["-c", "test -f GITFLOW_GATE.md"], app.ws.root)).code === 0;
      await app.scm.refresh();
      const lanesAfter = app.scm.graphInfo().lanes;
      steps.gitflow = {
        ok: onFlow && backOnBase && branchGone && integrated && lanesAfter >= 2,
        base: base0, onFlow, branchGone, integrated, lanesAfter,
      };
    } catch (e) {
      steps.gitflow = { ok: false, error: String(e) };
    }
    // Diff: um ficheiro alterado abre a vista de diff com o lado original vindo de
    // git_show HEAD:<rel> e o lado novo igual ao buffer (o marcador só existe à direita).
    try {
      const marker = `<!-- dxnext-diff-${files.length} -->`;
      app.ws.setBuffer(first, `${app.ws.buffers.get(first) ?? ""}\n${marker}\n`);
      await app.autosave();
      const expected = await api.gitShow(app.ws.root, `HEAD:${first}`);
      await app.openDiff(first);
      const di = app.editor.diffInfo();
      steps.diff = {
        ok: di.visible && di.rel === first && expected.length > 0 &&
          di.original === expected && di.modified === (app.ws.buffers.get(first) ?? "") &&
          di.modified.includes(marker) && !di.original.includes(marker),
        rel: first, originalLen: di.original.length, modifiedLen: di.modified.length,
      };
      app.editor.closeDiff();
    } catch (e) {
      steps.diff = { ok: false, error: String(e) };
    }
    // Fileops: criar/renomear/apagar via create_path/rename_path/delete_path, reflectido
    // no DISCO (test -f) e na ÁRVORE (linha .row[data-path]). Só toca em ficheiros do
    // próprio gate — nunca nos do seed (delete_path é destrutivo).
    try {
      const relA = "fileops_gate.txt";
      const relB = "fileops_gate_renamed.txt";
      const onDisk = async (rel: string): Promise<boolean> =>
        (await api.exec("sh", ["-c", `test -f "${rel}"`], app.ws.root)).code === 0;
      const inTree = (rel: string): boolean =>
        !!document.querySelector(`.tree .row[data-path="${rel}"]`);
      await app.fileops.create(relA);
      const created = (await onDisk(relA)) && inTree(relA);
      await app.fileops.rename(relA, relB);
      const renamed = !(await onDisk(relA)) && (await onDisk(relB)) && inTree(relB) && !inTree(relA);
      await app.fileops.remove(relB);
      const removed = !(await onDisk(relB)) && !inTree(relB);
      steps.fileops = { ok: created && renamed && removed, created, renamed, removed };
    } catch (e) {
      steps.fileops = { ok: false, error: String(e) };
    }
    // Tests: descoberta e execução REAIS no crate do seed — list_tests encontra os #[test]
    // semeados e run_test devolve o veredicto do cargo: o teste que passa passa E o que
    // falha falha (um fake sempre-verde não sobrevive); a statusbar segue cada veredicto.
    try {
      const found = await app.tests.refresh();
      const passa = found.find((i) => i.name === "seed_passa");
      const falha = found.find((i) => i.name === "seed_falha");
      if (!passa || !falha) {
        steps.tests = { ok: false, found: found.map((i) => i.name) };
      } else {
        const okRun = await app.tests.runOne(passa);
        const sbPass = (document.querySelector(".sb-tests")?.textContent ?? "").includes("✓");
        const badRun = await app.tests.runOne(falha);
        const sbFail = (document.querySelector(".sb-tests")?.textContent ?? "").includes("✗");
        steps.tests = {
          ok: okRun.ran && okRun.passed && badRun.ran && !badRun.passed && sbPass && sbFail,
          found: found.length, passVerdict: okRun.passed, failVerdict: badRun.passed,
        };
      }
    } catch (e) {
      steps.tests = { ok: false, error: String(e) };
    }
    // Statusbar: a contagem de problemas IGUALA a do painel Problems (review real); o blame
    // do ficheiro activo é o autor real do git (o mesmo de git_log); a linguagem segue o
    // separador activo. Nada é decorativo.
    try {
      const rsTab = [...app.ws.buffers.keys()].find((p) => p.endsWith("main.rs")) ?? "";
      app.openFile(rsTab);
      await app.updateStatus();
      const lang = document.querySelector(".sb-lang")?.textContent ?? "";
      const blame = (document.querySelector(".sb-blame")?.textContent ?? "").trim();
      const lastAuthor = (await api.gitLog(app.ws.root, 1))[0]?.author ?? "";
      const pyTab = [...app.ws.buffers.keys()].find((p) => p.endsWith("review_me.py")) ?? null;
      const findings = pyTab ? await app.review.run(pyTab) : [];
      const sbProblems = document.querySelector(".sb-problems")?.textContent ?? "";
      const shown = parseInt(sbProblems.replace(/[^0-9]/g, ""), 10);
      steps.statusbar = {
        ok: lang === "Rust" && lastAuthor.length > 0 && blame.indexOf(`${lastAuthor} ·`) === 0 && shown === findings.length,
        lang, blame, problemsShown: shown, findings: findings.length,
      };
    } catch (e) {
      steps.statusbar = { ok: false, error: String(e) };
    }
    // Painel inferior: a aba Output acumulou eventos REAIS do Co-Dev (a sessão worktree do
    // gate session e as corridas de teste acima); a aba Services mostra compose_ps real OU
    // o erro honesto do backend tal-e-qual no DOM (sem docker/stack não há lista simulada).
    try {
      const outText = document.getElementById("output")?.textContent ?? "";
      const outputOk = app.output.count > 0 && outText.includes("harness-proof") && outText.includes("seed_passa");
      const sv = await app.services.refresh();
      const svText = document.getElementById("services")?.textContent ?? "";
      let servicesOk: boolean;
      let servicesNote: unknown;
      if (sv.error) {
        servicesOk = svText.includes(sv.error.slice(0, 40));
        servicesNote = `skipped (${sv.error.slice(0, 80)})`;
      } else {
        servicesOk = document.querySelectorAll("#services .sv-row").length === sv.services.length;
        servicesNote = { listed: sv.services.length };
      }
      steps.panels = { ok: outputOk && servicesOk, outputLines: app.output.count, services: servicesNote };
    } catch (e) {
      steps.panels = { ok: false, error: String(e) };
    }
    // Board: NASCE VAZIO (board_load → null: nunca se gravou nada para esta raiz); criar uma
    // story persiste no SQLite real (board_save) e uma leitura FRESCA do backend (board_load
    // abre nova ligação à base — o equivalente a reabrir o workspace) devolve-a tal-e-qual.
    try {
      const bornEmpty = (await api.boardLoad(app.ws.root)) === null;
      app.openSpecial("board");
      await app.board.refresh();
      const emptyDom = !!document.querySelector("#board .kb-empty") && app.board.storyCount() === 0;
      const st = await app.board.addStory("provar a persistência do quadro", "qa", "o gate confirmar o SQLite real");
      const cardDom = !!document.querySelector(`#board .kc[data-id="${st.id}"]`);
      const re = await api.boardLoad(app.ws.root);
      const got = re?.stories.find((x) => x.id === st.id);
      steps.board = {
        ok: bornEmpty && emptyDom && cardDom && !!got && got.want === st.want && got.stage === "todo" &&
          (re?.stories.length ?? 0) === 1,
        bornEmpty, emptyDom, cardDom, id: st.id, reloaded: re?.stories.length ?? 0,
      };
    } catch (e) {
      steps.board = { ok: false, error: String(e) };
    }
    // Studio: desenho NASCE VAZIO; um desenho mínimo (service —publishes→ broker ←consumes—
    // consumer, evento nomeado) é validado pelo arch_validate REAL (0 erros);
    // arch_scaffold_preview lista os ficheiros que o scaffold escreveria SEM tocar no disco
    // (confirmado com test -e); «gerar backlog» escreve stories reais no Board, contadas por
    // um board_load fresco. O gate NUNCA chama arch_scaffold (esse escreve no disco).
    try {
      app.openSpecial("studio");
      await app.studio.refresh();
      const born = app.studio.componentCount() === 0;
      const svc = app.studio.addComponent("service", "Orders API");
      const bus = app.studio.addComponent("broker", "Bus");
      const wrk = app.studio.addComponent("consumer", "Billing Worker");
      app.studio.connect(svc, bus, "order-created");
      app.studio.connect(wrk, bus, "order-created");
      const findings = await app.studio.validate();
      const errs = findings.filter((f) => f.severity === "error").length;
      app.studio.deselect();
      const files = await app.studio.preview();
      const paths = files.map(([p]) => p);
      const previewOk = paths.includes("services/orders-api/main.rs") &&
        paths.includes("consumers/billing-worker/main.rs") && paths.includes("ARCHITECTURE.md");
      const previewDom = paths.length > 0 &&
        document.querySelectorAll("#studio [data-previewfile]").length === paths.length;
      const nothingWritten =
        (await api.exec("sh", ["-c", "test -e services -o -e consumers -o -e ARCHITECTURE.md"], app.ws.root)).code !== 0;
      const before = (await api.boardLoad(app.ws.root))?.stories.length ?? 0;
      const n = await app.studio.genBacklog();
      const after = (await api.boardLoad(app.ws.root))?.stories.length ?? 0;
      steps.studio = {
        ok: born && errs === 0 && previewOk && previewDom && nothingWritten && n === 2 && after === before + n,
        born, errs, files: paths.length, generated: n, before, after, nothingWritten,
      };
    } catch (e) {
      steps.studio = { ok: false, error: String(e) };
    }
    // Learn: o Percurso de aprendizagem é servido pelo backend de estudo REAL — list_courses
    // devolve os cursos (cards no DOM 1:1), abrir um carrega get_course (unidades/passos reais
    // na árvore) e «Perguntar ao Tutor» responde pelo laço governado de pistas (request_hint,
    // offline-safe) SEM nunca tocar no código do aluno. Sem cursos no host → SKIP honesto.
    try {
      app.openSpecial("learn");
      const courses = await app.learn.loadCourses();
      if (!courses.length) {
        steps.learn = "skipped (no courses from backend)";
      } else {
        const cardsDom = document.querySelectorAll("#learn [data-course]").length;
        const course = await app.learn.openCourse(courses[0].language);
        const units = course ? course.units.length : 0;
        const nSteps = course ? course.units.reduce((a, u) => a + u.steps.length, 0) : 0;
        const unitsDom = document.querySelectorAll("#learn [data-unit]").length;
        const firstStep = course && course.units[0] ? course.units[0].steps[0] : null;
        if (firstStep) app.learn.openStep(firstStep.id);
        const stepOpen = !!firstStep && app.learn.currentStepId() === firstStep.id &&
          !!document.querySelector("#learn .ln-detail");
        const codeBefore = app.learn.studentCode();
        let hint: Hint | null = null;
        let hintErr = "";
        try { hint = await app.learn.hint(); } catch (e) { hintErr = String(e); }
        if (!hint && /provider/i.test(hintErr)) {
          steps.learn = `skipped (${hintErr.slice(0, 80)})`;
        } else {
          // mdInline consome `…`/**…** ao apresentar — normaliza ambos os lados p/ comparar.
          const norm = (s: string): string => s.replace(/[`*]/g, "");
          const hintDom = !!hint &&
            norm(document.querySelector("#learn .ln-hints")?.textContent ?? "").indexOf(norm(hint.text).slice(0, 24)) >= 0;
          const untouched = app.learn.studentCode() === codeBefore; // a pista nunca escreve o buffer
          steps.learn = {
            ok: cardsDom === courses.length && units > 0 && nSteps > 0 && unitsDom === units &&
              stepOpen && !!hint && hint.text.length > 0 && hintDom && untouched,
            courses: courses.length, units, steps: nSteps,
            provider: hint ? hint.provider : hintErr.slice(0, 80), hintDom, untouched,
          };
        }
      }
    } catch (e) {
      steps.learn = { ok: false, error: String(e) };
    }
    // Manager: o Gestor de missões LÊ codev_session_list — a sessão worktree do gate session
    // aparecia na lista (e no DOM) enquanto estava aberta e desapareceu após o deliver; a
    // lista renderizada agora IGUALA o backend. Delegar uma missão (scaffold do Studio) corre
    // o ciclo isolado real agent_task_submit→status e devolve um diff para revisão.
    try {
      app.openSpecial("manager");
      await app.manager.refresh();
      const live = (await api.codevSessionList(app.ws.root)).map((s) => s.slug).sort();
      const dom = app.manager.listedSlugs().sort();
      const mirrors = JSON.stringify(dom) === JSON.stringify(live);
      const mission = await app.manager.delegate();
      const missionDom = !!document.querySelector("#manager .mg-card.mg-done .mg-patch");
      steps.manager = {
        ok: mgrSeen.open && mgrSeen.openDom && mgrSeen.goneAfter && mirrors &&
          mission.state === "done" && mission.patch.indexOf("diff --git") >= 0 && missionDom,
        sawOpen: mgrSeen.open, openDom: mgrSeen.openDom, goneAfter: mgrSeen.goneAfter,
        mirrors, listed: dom.length, mission: mission.state, missionFiles: mission.files,
      };
    } catch (e) {
      steps.manager = { ok: false, error: String(e) };
    }
    // Policy: a matriz no dock Co-Dev é RENDERIZADA de codev_policy — por modo, cada célula
    // mostrada IGUALA o campo correspondente do backend (manual/assist/auto), incluindo a
    // garantia «destrutivo/push pedem sempre». Nunca uma tabela hard-coded.
    try {
      await app.codev.showPolicyMatrix();
      const cells = document.querySelectorAll(".cd-matrix [data-pmx]").length;
      let mismatches = 0;
      for (const m of ["manual", "assist", "auto"]) {
        const p = await api.codevPolicy(m);
        const want: Record<string, string> = {
          edits: p.editsNeedApproval ? "ask" : "auto",
          commands: p.commandsNeedApproval ? "ask" : "auto",
          chains: p.chains ? "on" : "off",
          destructive: p.destructiveAlwaysAsks ? "ask" : "auto",
        };
        for (const f of Object.keys(want)) if (app.codev.matrixCell(m, f) !== want[f]) mismatches++;
      }
      steps.policy = { ok: cells === 12 && mismatches === 0, cells, mismatches };
    } catch (e) {
      steps.policy = { ok: false, error: String(e) };
    }
    // Dock Co-Dev rico (F13): o chip do header ESPELHA list_providers (recalculado aqui
    // de uma chamada fresca, mesma regra: streaming escolhido → primeiro available → «sem
    // provedor»); cartões SÓ com fonte real (zero-demo: sem tab não há cartões; o de
    // «Corrigir» exige um marker de ERRO verdadeiro do rust-analyzer e pré-preenche o
    // composer com o diagnóstico verbatim); o chip @ segue a tab activa e mete o conteúdo
    // REAL do buffer no plano do turno (lastPlan; com provedor, o turno sai carimbado
    // origin tutor-llm); /test corre run_all_tests e o veredicto REAL do cargo entra na
    // conversa e no contexto; o histórico vive em <configDir>/codev-history.json (nunca
    // localStorage), sobrevive a um «reload da vista» (instância FRESCA relê o disco) e
    // o gate apaga a SUA chave (a raiz mktemp do seed) no fim.
    try {
      const provsLive = await api.listProviders();
      const availLive = provsLive.filter((p) => p.available);
      const streamLive = availLive.filter((p) => p.streaming);
      const pick = streamLive[0] ?? availLive[0];
      const wantChip = pick ? (pick.models[0] ? `${pick.id} · ${pick.models[0]}` : pick.id) : t("codev.provNone");
      const chipDom = (document.querySelector("#codev .cd-provtxt")?.textContent ?? "").trim();
      const headerOk = chipDom === wantChip &&
        !!document.querySelector("#codev .cd-histbtn") && !!document.querySelector("#codev .cd-newchat");
      // Estado vazio: novo chat arquiva a conversa real dos gates anteriores.
      app.codev.newChat();
      [...app.openTabs].forEach((tb) => app.closeTab(tb));
      const noTabCards = document.querySelectorAll("#codev .cd-card").length === 0;
      const mdFile = [...app.ws.buffers.keys()].find((p) => p.endsWith("README.md")) ?? files[0];
      app.openFile(mdFile);
      const reviewCard = !!document.querySelector("#codev .cd-card-review");
      const explainCard = !!document.querySelector("#codev .cd-card-explain") === app.codev.hasProvider();
      const fixAbsent = !document.querySelector("#codev .cd-card-fix"); // README sem erros
      // Cartão «Corrigir»: só nasce de um marker de erro REAL (rust-analyzer, diag_gate).
      let fixCard: unknown = "skipped (rust-analyzer missing)";
      const dgF = [...app.ws.buffers.keys()].find((p) => p.endsWith("diag_gate.rs"));
      const raF = (await api.exec("sh", ["-c", "command -v rust-analyzer"], app.ws.root)).code === 0;
      if (dgF && raF) {
        const beforeF = app.ws.buffers.get(dgF) ?? "";
        app.openFile(dgF);
        app.editor.setContent(dgF, beforeF.replace("= 1;", '= "oops";'));
        const errsF = () => app.editor.markers(dgF).filter((mk) => mk.error);
        await upTo(() => errsF().length > 0, 90000);
        app.codev.refreshDock();
        const card = document.querySelector("#codev .cd-card-fix") as HTMLButtonElement | null;
        let prefilled = false;
        if (card) {
          card.click();
          const input = document.querySelector("#codev .cd-input") as HTMLInputElement;
          prefilled = input.value.length > 0 && input.value === errsF()[0]?.message;
          input.value = "";
        }
        fixCard = { ok: !!card && prefilled, prefilled };
        app.editor.setContent(dgF, beforeF);
        await app.autosave();
        app.openFile(mdFile);
      }
      const fixOk = typeof fixCard === "string" || (fixCard as { ok: boolean }).ok;
      // Chip @: segue a tab activa; ligado, o plano do turno leva o conteúdo REAL do buffer.
      const atChip = document.querySelector("#codev .cd-at") as HTMLButtonElement;
      const follows = (atChip.textContent ?? "").includes(mdFile.split("/").pop() ?? mdFile);
      atChip.click();
      const mdContent = app.ws.buffers.get(mdFile) ?? "";
      const plan = app.codev.composePrompt("pergunta de teste");
      const planHasFile = mdContent.length > 0 && plan.includes(mdContent) &&
        plan.includes(`@${mdFile}`) && plan.endsWith("pergunta de teste");
      // Com provedor: um turno real com o chip ligado sai do tutor-llm e o lastPlan (o
      // prompt EXACTO enviado) contém o conteúdo do ficheiro. Sem provedor, skip honesto.
      let originTurn: unknown = "skipped (no provider)";
      if (app.codev.hasProvider()) {
        try {
          const tn = await app.codev.chat("Answer with exactly: ok");
          originTurn = { ok: tn.origin === "tutor-llm" && app.codev.lastPlan.includes(mdContent), origin: tn.origin };
        } catch (e) {
          originTurn = { ok: false, error: String(e) };
        }
      }
      const originOk = typeof originTurn === "string" || (originTurn as { ok: boolean }).ok;
      atChip.click();
      const toggledOff = !app.codev.atIncluded();
      // /test pelo composer: o veredicto REAL do cargo (o seed tem um teste que FALHA)
      // entra na conversa e fica como chip de contexto do próximo turno.
      const composerEl = document.querySelector("#codev .cd-input") as HTMLInputElement;
      composerEl.value = "/test";
      (document.querySelector("#codev .cd-send") as HTMLButtonElement).click();
      const gotVerdict = await upTo(
        () => (document.querySelector("#codev .cd-msgs")?.textContent ?? "").includes("seed_falha"), 180000);
      const testChipDom = !!document.querySelector("#codev .cd-ctx .cd-chip");
      const plan2 = app.codev.composePrompt("x");
      const testCtx = plan2.includes("run_all_tests") && plan2.includes("passed=false");
      (document.querySelector("#codev .cd-chip-x") as HTMLButtonElement | null)?.click();
      const chipCleared = app.codev.composePrompt("y") === "y";
      // Histórico: no disco E numa instância FRESCA do dock (o «reload da vista»).
      await app.codev.historyFlushed();
      const histPath = `${(await api.appInfo()).configDir}/codev-history.json`;
      const histRaw = await api.readTextFile(histPath).catch(() => "");
      const onDiskHist = histRaw.includes(app.ws.root) && histRaw.includes("/test");
      const freshHost = document.createElement("div");
      const codev2 = new Codev(freshHost, {
        root: () => app.ws.root,
        readBuffer: (rel) => app.ws.buffers.get(rel),
        writeBuffer: async () => { /* leitura apenas no reload */ },
        listFiles: () => [...app.ws.buffers.keys()],
        activeTab: () => app.openTab || null,
        markers: (rel) => app.editor.markers(rel),
      });
      await codev2.loadHistory();
      const reloadTxt = freshHost.querySelector(".cd-msgs")?.textContent ?? "";
      const survived = reloadTxt.includes("/test") && reloadTxt.includes("seed_falha");
      // Painel histórico: lista a conversa arquivada pelo «novo chat» acima (do ficheiro).
      (document.querySelector("#codev .cd-histbtn") as HTMLButtonElement).click();
      const histPanel = document.querySelectorAll("#codev .cd-hist-item").length >= 1;
      (document.querySelector("#codev .cd-histbtn") as HTMLButtonElement).click();
      // Limpeza: apagar a chave desta raiz (mktemp) do ficheiro partilhado do configDir.
      const rawClean = await api.readTextFile(histPath).catch(() => "");
      const allClean = rawClean.trim() ? (JSON.parse(rawClean) as Record<string, unknown>) : {};
      delete allClean[app.ws.root];
      await api.writeTextFile(histPath, JSON.stringify(allClean, null, 2) + "\n");
      steps.codevdock = {
        ok: headerOk && noTabCards && reviewCard && explainCard && fixAbsent && fixOk &&
          follows && planHasFile && originOk && toggledOff && gotVerdict && testChipDom &&
          testCtx && chipCleared && onDiskHist && survived && histPanel,
        chip: chipDom, headerOk, noTabCards, reviewCard, explainCard, fixAbsent, fixCard,
        follows, planHasFile, origin: originTurn, toggledOff, gotVerdict, testChipDom,
        testCtx, chipCleared, onDiskHist, survived, histPanel,
      };
    } catch (e) {
      steps.codevdock = { ok: false, error: String(e) };
    }
    // Debug Assistant (F14): a 5.ª tab do painel mostra o diagnóstico REAL (E0308 do
    // diag_gate.rs via rust-analyzer), HYPOTHESES não-vazias derivadas SÓ dos notes do
    // próprio diagnostic (o gate compara-as com o marker), e NEXT com acções reais:
    // breakpoint armado na linha do erro (afirmado via breakpointList) e re-corrida do
    // último teste falhado (o gate tests correu seed_falha por último). ANALYSING-LLM:
    // skip honesto sem provedor; com provedor afirma apenas que uma resposta não-vazia
    // chegou do tutor-llm — nunca o conteúdo. A identidade de revisão é provada no fim:
    // repor o buffer descarta a análise (nunca pinta sobre código que mudou).
    try {
      const dgA = [...app.ws.buffers.keys()].find((p) => p.endsWith("diag_gate.rs"));
      const raA = (await api.exec("sh", ["-c", "command -v rust-analyzer"], app.ws.root)).code === 0;
      if (!dgA || !raA) {
        steps.dbgassist = dgA ? "skipped (rust-analyzer missing on host)" : "skipped (no diag_gate.rs in seed)";
      } else {
        const beforeA = app.ws.buffers.get(dgA) ?? "";
        const badLineA = beforeA.split("\n").findIndex((l) => l.includes("let value")) + 1;
        app.openFile(dgA);
        app.editor.setContent(dgA, beforeA.replace("= 1;", '= "oops";'));
        const errA = () => app.editor.markers(dgA).filter((mk) => mk.error && mk.line === badLineA);
        await upTo(() => errA().length > 0, 90000);
        (document.querySelector('.panel-tab[data-ptab="dbgassist"]') as HTMLElement).click();
        const paneShown = document.getElementById("dbgassist")?.classList.contains("hidden") === false;
        const marker = errA()[0];
        const st0 = app.dbgassist.state();
        // A tab espelha o marker real (ficheiro, linha, mensagem) — e o DOM mostra-o.
        const headTxt = document.querySelector("#dbgassist .dba-head")?.textContent ?? "";
        const showsDiag = !!marker && st0.file === dgA && st0.line === badLineA &&
          st0.message === marker.message && headTxt.includes(`${dgA}:${badLineA}`) &&
          headTxt.includes(marker.message.split("\n")[0]);
        // HYPOTHESES: não-vazias, CADA uma verbatim do próprio diagnostic (substring do
        // marker ou entrada do relatedInformation — nunca prosa inventada), e o DOM
        // espelha-as uma a uma (fonte "diag").
        const domHyps = [...document.querySelectorAll('#dbgassist .dba-row[data-src="diag"] .dba-txt')]
          .map((r) => r.textContent ?? "");
        const hypsOk = !!marker && st0.hypsDiag.length > 0 &&
          st0.hypsDiag.every((h) => marker.message.includes(h) || st0.related.includes(h)) &&
          domHyps.length === st0.hypsDiag.length && domHyps.every((h, i) => h === st0.hypsDiag[i]);
        // NEXT: «Depurar isto» arma um breakpoint REAL na linha do erro e abre a vista Debug.
        (document.querySelector("#dbgassist .dba-debug") as HTMLButtonElement).click();
        const bpOk = app.editor.breakpointList().some((b) => b.rel === dgA && b.line === badLineA);
        const debugViewShown = document.querySelector(".view-debug")?.classList.contains("hidden") === false;
        // «Correr o teste afectado» só existe porque o último run_test REAL (seed_falha) falhou.
        const testBtnTxt = document.querySelector("#dbgassist .dba-test")?.textContent ?? "";
        const testBtn = testBtnTxt.includes("seed_falha");
        // ANALYSING: com provedor, UM turno por clique — afirma-se só a chegada (origin/len).
        let llm: unknown = "skipped (no provider)";
        let driftOk = true;
        if (app.codev.hasProvider()) {
          (document.querySelector("#dbgassist .dba-analyze") as HTMLButtonElement).click();
          await upTo(() => app.dbgassist.state().analysis !== null, 180000);
          const a = app.dbgassist.state().analysis;
          llm = { ok: !!a && a.origin === "tutor-llm" && a.len > 0, origin: a?.origin, len: a?.len ?? 0, note: app.dbgassist.state().note.slice(0, 80) };
          // Identidade de revisão: repor o buffer tem de DESCARTAR a análise (drift honesto).
          app.editor.setContent(dgA, beforeA);
          driftOk = app.dbgassist.state().analysis === null;
        } else {
          // Sem provedor: rótulo honesto + o texto do compilador verbatim, nada de prosa nossa.
          const noprov = !!document.querySelector("#dbgassist .dba-noprov");
          const compTxt = document.querySelector("#dbgassist .dba-comp")?.textContent ?? "";
          llm = { ok: noprov && !!marker && compTxt.startsWith(marker.message), skipped: "no provider" };
          app.editor.setContent(dgA, beforeA);
        }
        const llmOk = typeof llm === "string" || (llm as { ok: boolean }).ok;
        await app.autosave();
        app.editor.removeBreakpoint(dgA, badLineA);
        (document.querySelector('.panel-tab[data-ptab="term"]') as HTMLElement).click();
        steps.dbgassist = {
          ok: paneShown && showsDiag && hypsOk && bpOk && debugViewShown && testBtn && llmOk && driftOk,
          line: badLineA, paneShown, showsDiag, hyps: st0.hypsDiag.length, hypsOk,
          bp: bpOk, debugViewShown, testBtn, llm, driftOk,
        };
      }
    } catch (e) {
      steps.dbgassist = { ok: false, error: String(e) };
    }
    const dbgassistOk = typeof steps.dbgassist === "string" || (steps.dbgassist as { ok: boolean }).ok;
    // Theatre/trace (F9): trace_execution corre o src/main.rs do seed DE VERDADE (cópia
    // instrumentada, compilada e executada) e devolve os passos medidos (linha/evento/
    // função/locals/stdout). A vista só os reproduz; a linha do passo corrente realça no
    // Monaco do theatre — lida das DECORAÇÕES do model, não do nosso estado. Relações:
    // symbol_relations("main") encontra os DOIS `fn main` do seed (src/main.rs e
    // src/bin/diag_gate.rs) → o chip TEM de dizer como a relação foi estabelecida
    // (ambíguo/inferido — espelho do backend, nunca um rótulo fixo). O gate fixa o motor
    // sandbox em "host" (toolchain local, provada pelo gate tests) e repõe-no no fim —
    // o caminho container (rust:1-slim) é real mas lento/não determinista no CI.
    const engine0 = await api.getSandboxEngine().catch(() => null);
    if (engine0 && engine0 !== "host") await api.setSandboxEngine("host").catch(() => {});
    try {
      const rsT = [...app.ws.buffers.keys()].find((p) => p.endsWith("src/main.rs"));
      if (!rsT) {
        steps.trace = "skipped (no seed src/main.rs)";
      } else {
        app.openFile(rsT);
        app.openSpecial("theatre");
        let dto: ExecutionTraceDto | null = null;
        let traceErr = "";
        try { dto = await app.theatre.runTrace(); } catch (e) { traceErr = String(e); }
        if (!dto) {
          steps.trace = `skipped (${traceErr.slice(0, 100)})`;
        } else if (!dto.supported) {
          steps.trace = `skipped (${dto.notes.slice(0, 100)})`;
        } else {
          const src = app.ws.buffers.get(rsT) ?? "";
          const srcLines = src.split("\n");
          const letLine = srcLines.findIndex((l) => l.includes("let x")) + 1;
          const sane = dto.steps.length > 0 && dto.steps.every((s) =>
            s.line >= 1 && s.line <= srcLines.length && ["line", "call", "return"].indexOf(s.event) >= 0);
          const letIdx = dto.steps.findIndex((s) => s.line === letLine);
          // Algum passo viu o binding com o valor REAL (5) — lido do frame, não inventado.
          const varSeen = dto.steps.some((s) => s.locals.some((v) => v.name === "x" && v.value.indexOf("5") >= 0));
          const target = letIdx >= 0 ? letIdx : 0;
          app.theatre.goto(target);
          const highlighted = app.theatre.decoratedLine() === dto.steps[target].line;
          const outOk = dto.stdout.indexOf("5") >= 0; // o println!("{x}") do seed
          let chipOk = false;
          let ambiguous = false;
          try {
            const rels = await app.theatre.showRelations("main");
            ambiguous = rels.ambiguous;
            const wantRes = rels.ambiguous ? "ambiguous" : rels.resolution;
            const chip = app.theatre.chipState();
            chipOk = !!chip && chip.res === wantRes && (chip.label ?? "").length > 0 && rels.definitions.length >= 2;
          } catch { chipOk = false; }
          steps.trace = {
            ok: sane && letIdx >= 0 && varSeen && highlighted && outOk && chipOk,
            steps: dto.steps.length, letLine, letIdx, varSeen, highlighted, outOk, chipOk, ambiguous,
          };
        }
      }
    } catch (e) {
      steps.trace = { ok: false, error: String(e) };
    }
    const traceOk = typeof steps.trace === "string" || (steps.trace as { ok: boolean }).ok;
    // Theatre/pipeline (F9): compile_pipeline emite as representações REAIS da toolchain
    // sobre o código do seed — o IR/ASM contém o crate-name que o backend usa
    // (pipeline_ll/pipeline_asm: artefactos reais, não fixos) e os bytes do binário são
    // medidos no disco; o DOM mostra EXACTAMENTE o que o backend devolveu. SKIP honesto
    // se o backend responder erro no host.
    try {
      let p: PipelineDto | null = null;
      let pipeErr = "";
      try { p = await app.theatre.runPipeline(); } catch (e) { pipeErr = String(e); }
      if (!p) {
        steps.pipeline = `skipped (${pipeErr.slice(0, 100)})`;
      } else {
        app.theatre.showMode("pipeline");
        const ir = p.llvmIr + p.asm;
        const realArtifacts = ir.length > 0 && /pipeline_ll|pipeline_asm/.test(ir);
        const domLlvm = document.querySelector('#theatre .th-stage[data-stage="llvm"] pre')?.textContent ?? "";
        const domAsm = document.querySelector('#theatre .th-stage[data-stage="asm"] pre')?.textContent ?? "";
        const domShows = (p.llvmIr ? domLlvm === p.llvmIr : true) && (p.asm ? domAsm === p.asm : true);
        const bytesDom = (document.querySelector('#theatre .th-stage[data-stage="bin"] .th-bytes')?.textContent ?? "")
          .indexOf(String(p.binaryBytes)) >= 0;
        steps.pipeline = {
          ok: p.binaryBytes > 0 && realArtifacts && domShows && bytesDom,
          bytes: p.binaryBytes, llvm: p.llvmIr.length, asm: p.asm.length, mir: p.mir.length,
          disasm: p.disasm.length, domShows, bytesDom, notes: p.notes.slice(0, 80),
        };
      }
    } catch (e) {
      steps.pipeline = { ok: false, error: String(e) };
    } finally {
      if (engine0 && engine0 !== "host") await api.setSandboxEngine(engine0).catch(() => {});
    }
    const pipelineOk = typeof steps.pipeline === "string" || (steps.pipeline as { ok: boolean }).ok;
    // Extensions/VSIX (F10): o gate GERA um .vsix verdadeiro (zip com extension.vsixmanifest
    // + extension/package.json) via exec — nunca um fixture binário committado — e prova o
    // ciclo honesto: ler o manifesto REAL (vsix_manifest, parse do zip no backend) →
    // instalar por acção explícita (registo em FICHEIRO no configDir, não localStorage) →
    // nome/versão/engines reais no DOM → remover apaga do disco E da lista. A vista declara
    // que extensões NÃO executam (sem host de extensão) e cada `contributes` do manifesto
    // aparece «não suportado» — nenhum botão simula activação. SKIP honesto sem `zip`.
    try {
      const zipThere = (await api.exec("sh", ["-c", "command -v zip"], app.ws.root)).code === 0;
      if (!zipThere) {
        steps.vsix = "skipped (zip missing on host)";
      } else {
        const mk = await api.exec("sh", ["-c",
          'set -e; d=$(mktemp -d); mkdir -p "$d/extension"; ' +
          'printf %s \'{"name":"dxnext-gate-ext","publisher":"dxgate","version":"0.0.7",' +
          '"displayName":"DX Gate Extension","description":"vsix gate proof",' +
          '"engines":{"vscode":"^1.90.0"},"contributes":{"commands":[{"command":"dx.hi","title":"Hi"}],"themes":[]}}\' ' +
          '> "$d/extension/package.json"; ' +
          'printf %s "<PackageManifest/>" > "$d/extension.vsixmanifest"; ' +
          'cd "$d" && zip -q gate.vsix extension.vsixmanifest extension/package.json && echo "$d/gate.vsix"',
        ], app.ws.root);
        if (mk.code !== 0) {
          steps.vsix = { ok: false, error: (mk.stderr || mk.stdout).slice(0, 160) };
        } else {
          const vsixPath = mk.stdout.trim();
          const tmpDir = vsixPath.slice(0, vsixPath.lastIndexOf("/"));
          const regPath = `${(await api.appInfo()).configDir}/extensions.json`;
          // Um run anterior abortado entre instalar e remover deixaria a id no registo e
          // tornava before+1 falso — limpar primeiro torna o gate determinista.
          await app.extensions.remove("dxgate.dxnext-gate-ext").catch(() => {});
          const before = (await app.extensions.refresh()).installed.length;
          const entry = await app.extensions.openVsix(vsixPath);
          // O manifesto mostrado é o que o GATE escreveu dentro do zip — parse real, não eco.
          const manifestReal = entry.id === "dxgate.dxnext-gate-ext" &&
            entry.version === "0.0.7" && entry.engine === "^1.90.0" &&
            entry.contributes.length === 2;
          await app.extensions.install();
          const regRaw = await api.readTextFile(regPath).catch(() => "");
          const onDisk = regRaw.includes("dxgate.dxnext-gate-ext") && regRaw.includes("0.0.7");
          const card = document.querySelector('#extensions .ext-card[data-id="dxgate.dxnext-gate-ext"]');
          const cardText = card?.textContent ?? "";
          const listed = !!card && cardText.includes("0.0.7") && cardText.includes("^1.90.0");
          const notSupported = card ? card.querySelectorAll(".ext-cap-no").length : 0;
          const declares = !!document.querySelector("#extensions .ext-banner") && notSupported === 2;
          const grew = app.extensions.state().installed.length === before + 1;
          await app.extensions.remove(entry.id);
          const regAfter = await api.readTextFile(regPath).catch(() => "");
          const removedDisk = !regAfter.includes("dxnext-gate-ext");
          const removedDom = !document.querySelector('#extensions .ext-card[data-id="dxgate.dxnext-gate-ext"]');
          const restored = app.extensions.state().installed.length === before;
          await api.exec("rm", ["-rf", "--", tmpDir], app.ws.root);
          steps.vsix = {
            ok: manifestReal && onDisk && listed && declares && grew && removedDisk && removedDom && restored,
            name: entry.name, version: entry.version, engine: entry.engine,
            contributes: entry.contributes, onDisk, listed, declares, removedDisk, removedDom,
          };
        }
      }
    } catch (e) {
      steps.vsix = { ok: false, error: String(e) };
    }
    const vsixOk = typeof steps.vsix === "string" || (steps.vsix as { ok: boolean }).ok;
    // Infra/K8s (F11): kubectl REAL contra o cluster do KUBECONFIG — o gate só corre com
    // servidor alcançável (kubectl version --request-timeout decide o SKIP honesto; o
    // CI/portátil não tem cluster garantido). Ciclo completo num namespace PRÓPRIO
    // (dxnext-gate): deploy dos manifests do PREVIEW do Studio (o desenho do gate studio
    // ainda está vivo; arch_scaffold_preview nunca escreve no workspace) → kubectl get
    // lista os Deployments/Services criados (espelhados 1:1 no DOM) → delete do namespace
    // limpa tudo (confirmado por um get posterior). Nunca toca recursos fora do namespace.
    try {
      const inf = await app.infra.refresh();
      if (!inf.kubectl) {
        steps.k8s = "skipped (kubectl missing on host)";
      } else if (!inf.server) {
        steps.k8s = `skipped (no cluster reachable: ${(inf.serverErr ?? "").slice(0, 80)})`;
      } else {
        const ctxDom = document.querySelector("#infra .inf-ctx")?.textContent ?? "";
        const ctxOk = !!inf.context && ctxDom === inf.context;
        const manifestsOk = inf.manifests.length >= 2 && inf.manifests.every((p) => p.startsWith("deploy/k8s/"));
        const ns = "dxnext-gate";
        const dep = await app.infra.deploy(ns);
        const resNames = dep.resources.map((r) => `${r.kind}/${r.name}`);
        const hasDeploys = resNames.includes("Deployment/orders-api") && resNames.includes("Deployment/billing-worker");
        const hasSvc = dep.resources.some((r) => r.kind === "Service" && r.name === "orders-api");
        const domRows = document.querySelectorAll("#infra .inf-list .inf-res").length === dep.resources.length;
        const destroyed = await app.infra.destroy(ns);
        const after = await api.exec("kubectl", ["get", "deploy", "-n", ns, "-o", "name"], app.ws.root);
        const gone = after.code !== 0 || after.stdout.trim() === "";
        steps.k8s = {
          ok: ctxOk && manifestsOk && !dep.error && hasDeploys && hasSvc && domRows && destroyed && gone,
          context: inf.context, server: inf.server, manifests: inf.manifests.length,
          resources: resNames, domRows, destroyed, gone, error: dep.error,
        };
      }
    } catch (e) {
      steps.k8s = { ok: false, error: String(e) };
    }
    const k8sOk = typeof steps.k8s === "string" || (steps.k8s as { ok: boolean }).ok;
    // Conta/Observabilidade (F12): os contadores mostrados têm de IGUALAR o acumulador do
    // Co-Dev — que foi preenchido com os ChatResp.inputTokens/outputTokens que o backend
    // devolveu nos gates codev/explain, e com os turnos de streaming do gate stream como
    // «não medido» (llm://done não traz contagens; nada é estimado). Sem provedor os
    // contadores são zeros reais, não um skip. A Conta nunca pode render uma chave em
    // claro (mesma regra dos gates providers/settings).
    try {
      const u = app.codev.usage();
      await app.account.refresh();
      const num = (sel: string): number =>
        parseInt((document.querySelector(sel)?.textContent ?? "").replace(/[^0-9-]/g, ""), 10);
      const mirrors = num("#account .ac-turns") === u.turns && num("#account .ac-in") === u.inputTokens &&
        num("#account .ac-out") === u.outputTokens && num("#account .ac-unm") === u.unmeasured;
      const hadTurns = typeof steps.codev !== "string";   // o gate codev correu um turno real
      const hadStream = typeof steps.stream !== "string"; // o gate stream completou um done real
      const consistent = (!hadTurns || (u.turns >= 1 && u.inputTokens + u.outputTokens > 0)) &&
        (!hadStream || u.unmeasured >= 1);
      const acText = document.getElementById("account")?.textContent ?? "";
      const leaks = /sk-ant-|sk-[A-Za-z0-9]{12}|AIza[A-Za-z0-9]{10}/.test(acText);
      const activeShown = (document.querySelector("#account .ac-active")?.textContent ?? "").length > 0;
      steps.observ = {
        ok: mirrors && consistent && !leaks && activeShown,
        ...u, mirrors, hadTurns, hadStream, leaks,
      };
    } catch (e) {
      steps.observ = { ok: false, error: String(e) };
    }
    // Changelog «o que mudou e porquê» (F12): a timeline espelha o git_log REAL do seed
    // (hash/assunto/autor/data — datas são relativas (%cr), por isso compara-se com o
    // snapshot da PRÓPRIA vista, não com um git_log fresco que já diria «há 1 segundo a
    // mais»); o «porquê» é a mensagem de commit verdadeira. Clicar num commit NÃO-merge
    // (um merge limpo pode não ter patch no git show) abre o diff real com `diff --git`.
    try {
      await app.changelog.refresh();
      const cs = app.changelog.commits;
      const live = await api.gitLog(app.ws.root, 30);
      const rows = [...document.querySelectorAll("#changelog .cl-row")];
      const mirrors = cs.length > 0 && cs.length === live.length && rows.length === cs.length &&
        rows.every((r, i) => r.getAttribute("data-hash") === cs[i].hash);
      const firstTxt = rows[0]?.textContent ?? "";
      const headOk = firstTxt.includes(cs[0]?.subject ?? " ") &&
        firstTxt.includes(cs[0]?.author ?? " ") && (cs[0]?.date ?? "").length > 0 &&
        firstTxt.includes(cs[0]?.date ?? " ");
      const target = cs.find((c) => c.parents.length === 1);
      let diffOk = false;
      if (target) {
        await app.changelog.openCommit(target.hash);
        const diffText = document.querySelector("#changelog .cl-diff pre")?.textContent ?? "";
        diffOk = diffText.includes("diff --git") && diffText.includes(target.subject);
      }
      steps.changelog = {
        ok: mirrors && headOk && !!target && diffOk,
        commits: cs.length, mirrors, headOk, picked: target?.short, diffOk,
      };
    } catch (e) {
      steps.changelog = { ok: false, error: String(e) };
    }
    const observOk = (steps.observ as { ok: boolean }).ok;
    const changelogOk = (steps.changelog as { ok: boolean }).ok;
    const learnOk = typeof steps.learn === "string" || (steps.learn as { ok: boolean }).ok;
    rep.ok =
      (steps.autosave as { ok: boolean }).ok &&
      (steps.treeReal as { hasNoDemoPaths: boolean }).hasNoDemoPaths &&
      (steps.terminal as { ok: boolean }).ok &&
      (steps.kill as { ok: boolean }).ok &&
      (steps.scm as { ok: boolean }).ok &&
      codevOk && lspOk && (steps.tabs as { ok: boolean }).ok &&
      (steps.search as { ok: boolean }).ok && (steps.welcome as { ok: boolean }).ok &&
      (steps.graph as { ok: boolean }).ok && (steps.remote as { ok: boolean }).ok && debugOk && outlineOk && reviewOk && explainOk && chromeOk && toolbarOk &&
      (steps.session as { ok: boolean }).ok && (steps.codemap as { ok: boolean }).ok &&
      (steps.providers as { ok: boolean }).ok && (steps.team as { ok: boolean }).ok &&
      (steps.i18n as { ok: boolean }).ok && (steps.theme as { ok: boolean }).ok &&
      (steps.settings as { ok: boolean }).ok &&
      (steps.gitflow as { ok: boolean }).ok && (steps.diff as { ok: boolean }).ok &&
      (steps.fileops as { ok: boolean }).ok &&
      (steps.tests as { ok: boolean }).ok && (steps.statusbar as { ok: boolean }).ok &&
      (steps.panels as { ok: boolean }).ok &&
      (steps.board as { ok: boolean }).ok && (steps.studio as { ok: boolean }).ok &&
      (steps.pty as { ok: boolean }).ok && streamOk &&
      learnOk && (steps.manager as { ok: boolean }).ok && (steps.policy as { ok: boolean }).ok &&
      (steps.codevdock as { ok: boolean }).ok && dbgassistOk &&
      referencesOk && renameOk && diagnosticsOk && containersOk && traceOk && pipelineOk && vsixOk && k8sOk &&
      observOk && changelogOk;
  } catch (e) {
    rep.error = String(e);
  }
  await api.selftestReport(rep);
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  if (isDesktop()) {
    api.appInfo().then((info) => {
      const start = info.openAtStart;
      if (info.selftest && start) void runSelftest(app, start);
      else if (start) void app.open(start);
    });
  }
});
