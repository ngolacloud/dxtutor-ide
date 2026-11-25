/* ═════════ feature `infra`: legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da subárvore `features/infra/` autorizado a ler ou escrever
   `window.*` (A8 do arch-check). O motor (`application/infra-engine.ts`) e a
   cablagem de acções (`ui/actions.ts`) importam daqui — ou recebem adaptadores
   compostos sobre estes acessores — em vez de usar nomes globais livres; por isso
   são TIPADOS e o `any` confina-se a este ficheiro (regra «zero any fora do bridge»).

   O resíduo strangler `features/infra.ts` (fora desta subárvore, @ts-nocheck) é
   dono do estado (ENVS/ENVX/K8S/STACK/DEVC/OBS window-backed) e do DOM, e COMPÕE
   o motor com os adaptadores daqui.

   Como os bridges do Co-Dev/scm/debug/board, os acessores lêem `window`/`G` NO ACTO
   da chamada, nunca no import: `infra.ts` e a sua subárvore avaliam ANTES de
   `app.ts`/`v5.ts`/`v6.ts` publicarem os seus globais (FS/SD/TECH/KIND/GIT, os
   helpers goPane/dlg/echo/…). Capturar um valor ansiosamente aqui congelaria em
   `undefined`. Funções e getters são seguros porque só correm depois do arranque
   (cliques, delegações, deploys).

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito é `let`/
   `const`/`function` solta (não em `interface Window`), logo `window.x` não tipa.
   Cada acessor exportado tem mesmo assim uma assinatura concreta e não-`any`. */

import { toast, log, rerender, writeFile, svg, esc, show, dlg as coreDlg } from "../../../core";
import type {
  Design, Files, Envs, EnvX, K8sState, Commit, TechSpec, KindSpec, DesignNode,
  Devc, StackItem, ComposeSvc, DlgCfg, OpenTabArg,
} from "../domain/types";
/* donos que avaliam antes desta ponte importam-se; os que avaliam depois, pelo registo (ADR-0004, U7p1) */
import { echo as echoImpl, echoCmd as echoCmdImpl, newInput as newInputImpl } from "../../terminal";
import { note as noteImpl } from "../../notifications";
import { services } from "../../../app/services";

export { toast, log, rerender, writeFile, svg, esc, show };
export type {
  Design, Files, Envs, EnvX, K8sState, Commit, TechSpec, KindSpec, DesignNode,
  Devc, StackItem, ComposeSvc, DlgCfg, OpenTabArg,
};

const G = window as unknown as Record<string, any>;

/* ───── estado window-backed (o resíduo é dono; aqui só os acessores) ───── */
export const envs = (): Envs => G.ENVS;
/* o ENVX/K8S/DEVC/P_DC são deste módulo desde a U7p2 do ADR-0004 (eram window.*): o resíduo dá a referência do
   ENVX ao avaliar, e o desktop, o auto-teste e os testes lêem-nos e escrevem-nos por estes acessores */
let ENVX_REF: EnvX;
let K8S: K8sState | null = null;
let DEVC: Devc | null = null;
let P_DC: string | undefined;
export const setEnvxRef = (v: EnvX): void => { ENVX_REF = v; };
export const envx = (): EnvX => ENVX_REF;
export const k8s = (): K8sState | null => K8S;
export const setK8s = (v: K8sState | null): void => { K8S = v; };
export const stack = (): StackItem[] | null => G.STACK;
export const setStack = (v: StackItem[] | null): void => { G.STACK = v; };
export const devc = (): Devc | null => DEVC;
export const setDevc = (v: Devc | null): void => { DEVC = v; };
export const pDc = (): string => P_DC as string;
export const setPDc = (v: string): void => { P_DC = v; };

/* ───── design do Studio + catálogo + FS + raiz (donos do monólito/studio) ───── */
export const design = (): Design => G.SD;
export const files = (): Files => G.FS;
export const root = (): string => G.ROOT;
export const tech = (): Record<string, TechSpec> => services.studio!.TECH as Record<string, TechSpec>;
export const kind = (): Record<string, KindSpec> => services.studio!.KIND as Record<string, KindSpec>;
export const isApp = (n: DesignNode): boolean => services.studio!.isApp(n as never);
export const nodeSlug = (n: DesignNode): string => services.studio!.sl(n as never);
export const composeServices = (): ComposeSvc[] | null => G.composeServices();

/* ───── git (promoções lêem as refs + o grafo de commits) ───── */
export const gitRefs = (): Record<string, string> => G.GIT.refs;
export const gitCommits = (): Record<string, Commit> => G.GIT.c;

/* ───── persistência (porta de infra: LS é inoperante em headless) ───── */
export const lsGet = <T,>(k: string, d: T): T => G.LS.get(k, d);
export const lsSet = (k: string, v: unknown): void => { G.LS.set(k, v); };

/* ───── navegação / separadores / painel / diálogo ───── */
export const goPane = (p: string): void => { G.goPane(p); };
export const openPath = (p: string): void => { G.openPath(p); };
export const openTab = (t: OpenTabArg): void => { G.openTab(t); };
export const dlg = (cfg: DlgCfg): void => { coreDlg(cfg); };  /* o diálogo é do core (era window.dlg do v6.ts; ADR-0004, U4g7) */

/* ───── terminal (saída simulada no browser) ───── */
export const echo = (html: string): void => { echoImpl(html); };
export const echoCmd = (cmd: string): void => { echoCmdImpl(cmd); };
export const newInput = (nofocus?: boolean): void => { newInputImpl(nofocus); };
export const setPanelTab = (tab: string, nofocus?: boolean): void => { G.setPanelTab(tab, nofocus); };
export const getVar = (k: string): string => services.shell!.getVar(k);

/* ───── estado da vista + notificações ───── */
export const drawStack = (): void => { G.drawStack(); };
export const note = (m: string): void => { noteImpl(m); };
export const rel = (at: number): string => G.rel(at);

