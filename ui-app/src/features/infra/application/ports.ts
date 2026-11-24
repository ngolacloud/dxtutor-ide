/* ═══════════ feature `infra` — application ports (ADR-0002, Fase 3) ═══════════
   O motor (`infra-engine.ts`) depende SÓ de `domain/`, de `esc` (puro) e das
   interfaces declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no
   legacy-bridge — essas capacidades são fornecidas, no acto da composição
   (`features/infra.ts`, o resíduo strangler), por adaptadores sobre
   `infrastructure/legacy-bridge.ts`.

   Isto torna os dois motores (runtime/K8s + environments/drift/observabilidade)
   testáveis e livres de `window`: dá-se-lhes acesso ao estado (ENVS/ENVX/K8S/STACK/
   DEVC), ao design/catálogo/FS/git do monólito, à persistência, ao terminal
   simulado, à navegação, ao diálogo, às notificações e à vista, e a orquestração
   corre sem browser. A regra de dependências aponta para dentro: as portas importam
   `domain/`, nunca o contrário. (Verificado por A7/A8 do `arch-check`.) */

import type {
  Design, DesignNode, Envs, EnvX, Files, K8sState, KindSpec, TechSpec, Commit,
  EnvDep, EnvState, SecretCheck, DriftReport, Secrets,
  Devc, StackItem, ComposeSvc, DlgCfg, OpenTabArg,
} from "../domain/types";

/* ───── estado window-backed (o resíduo é dono; o motor lê/escreve por aqui) ───── */
export interface State {
  envs(): Envs;
  envx(): EnvX;
  k8s(): K8sState | null;
  setK8s(v: K8sState | null): void;
  stack(): StackItem[] | null;
  setStack(v: StackItem[] | null): void;
  devc(): Devc | null;
  setDevc(v: Devc | null): void;
  pDc(): string;
  setPDc(v: string): void;
}

/** Design do Studio + catálogo + predicados (donos do monólito/studio). */
export interface CatalogPort {
  design(): Design;
  tech(): Record<string, TechSpec>;
  kind(): Record<string, KindSpec>;
  isApp(n: DesignNode): boolean;
  slug(n: DesignNode): string;
}

/** Sistema de ficheiros virtual + compose (os geradores lêem-nos). */
export interface Workspace {
  files(): Files;
  writeFile(p: string, content: string): void;
  composeServices(): ComposeSvc[] | null;
  root(): string;
}

/** Git: refs (develop p/ o drift) + grafo de commits (p/ a promoção). */
export interface Scm {
  refs(): Record<string, string>;
  commits(): Record<string, Commit>;
}

/** Persistência (porta de infra: LS, inoperante em headless). */
export interface Persist {
  get<T>(k: string, d: T): T;
  set(k: string, v: unknown): void;
}

/** Terminal simulado no browser. */
export interface Terminal {
  echo(html: string): void;
  echoCmd(cmd: string): void;
  newInput(nofocus?: boolean): void;
  setPanelTab(tab: string, nofocus?: boolean): void;
  getVar(k: string): string;
}

/** Navegação / separadores / diálogo modal / debugger. */
export interface Nav {
  goPane(p: string): void;
  openPath(p: string): void;
  openTab(t: OpenTabArg): void;
  dlg(cfg: DlgCfg): void;
}

/** Notificações + registo de eventos. */
export interface Notifier {
  toast(m: string): void;
  note(m: string): void;
  log(src: string, msg: string): void;
}

/** Re-desenho da vista após mudança de estado. */
export interface View {
  redraw(): void;
  rerender(kind: string): void;
  rerenderDebug(): void;
  drawStack(): void;
}

/** Relógio (Date.now) — injectado para a promoção/redeploy ficarem determinista
 *  nos testes (o golden fixa o relógio). */
export interface Clock {
  now(): number;
}

/* ───────── pacote de dependências entregue ao motor ───────── */
export interface InfraDeps {
  state: State;
  catalog: CatalogPort;
  workspace: Workspace;
  scm: Scm;
  persist: Persist;
  terminal: Terminal;
  nav: Nav;
  notifier: Notifier;
  view: View;
  clock: Clock;
}

/** Resultado de um deploy (o decorador v6 lê `.ok`). */
export interface DeployResult { ok: boolean }

/** O separador de observabilidade, no que a parte desktop lê. */
export interface ObserveTab { env?: string; name: string }

/** A parte desktop da infra (ADR-0004, U4h4), injectada pela app Tauri em `desktopPorts.infra`:
 *  o socket do runtime e o cluster reais, o deploy real para o cluster e os logs reais na
 *  vista de observabilidade. Cada operação recebe a versão simulada (`virtual`). */
export interface InfraDesktop {
  rtConnect(virtual: () => void): unknown;
  k8sConnect(virtual: () => void): unknown;
  dxDeploy(virtual: () => { ok: boolean; sum?: string }): { ok: boolean; sum?: string };
  observe(t: ObserveTab, host: HTMLElement, virtual: (t: ObserveTab, host: HTMLElement) => void): void;
}

/** A superfície que o motor devolve (os dois motores da Infra). */
export interface InfraEngine {
  /* runtime / dev-container / Kubernetes */
  hydrateEnvs(): void;
  saveEnv(): void;
  cli(): string;
  needRt(): boolean;
  rtConnect(): void;
  k8sConnect(): void;
  projectContext(): Array<[string, string]>;
  devcontainerJson(): string;
  dcAttach(): void;
  dcDetach(): void;
  appEnv(n: DesignNode, D: Design): string[];
  k8sInfra(D: Design): string;
  k8sDocs(): K8sState["docs"];
  dxDeploy(): DeployResult;
  k8sScale(n: string, d: number): void;
  k8sDown(): void;
  runTaskQuiet(c: string, out: string): void;
  ctlLogs(n: string): void;
  /* environments / drift / secrets */
  hydrateEnvx(): void;
  saveEnvx(): void;
  designApps(): DesignNode[];
  localSecrets(): Secrets;
  initSecrets(): void;
  envDeps(env: string): EnvDep[];
  envState(env: string): EnvState | null;
  envHealth(env: string): string;
  secretCheck(to: string): SecretCheck;
  commitsBetween(from: string | null | undefined, to: string | undefined): Commit[];
  promote(to: string): void;
  redeployEnv(env: string): void;
  openEnvs(): void;
  driftReport(env: string): DriftReport;
  openObserve(env: string, n: string): void;
}
