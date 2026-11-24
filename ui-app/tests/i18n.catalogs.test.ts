// U6b (ADR-0004): os textos por chave. O `translator` (src/app/i18n.ts) e os catálogos das features: cada entrada
// tem de ser a que o motor de tradução produzia (nos dois sentidos), para a migração não mudar o que se vê em
// nenhuma das línguas. Os goldens (normalizados para inglês) provam o inglês no markup; este teste prova o par.
import { beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";
import { translator, type Messages } from "../src/app/i18n";
import { BOOT_MESSAGES } from "../src/app/boot-steps.messages";
import { ACCOUNT_MESSAGES } from "../src/features/account.messages";
import { BOARD_MESSAGES } from "../src/features/board/ui/messages";
import { CHANGELOG_MESSAGES } from "../src/features/changelog.messages";
import { CHECKPOINT_MESSAGES } from "../src/features/checkpoint.messages";
import { CODEREVIEW_MESSAGES } from "../src/features/codereview/ui/messages";
import { DIAGNOSTICS_MESSAGES } from "../src/features/diagnostics.messages";
import { EXPLORER_MESSAGES } from "../src/features/explorer.messages";
import { EXT_MESSAGES } from "../src/features/ext/ui/messages";
import { GRAPH_MESSAGES } from "../src/features/graph.messages";
import { INFRA_MESSAGES } from "../src/features/infra/ui/messages";
import { LEARN_MESSAGES } from "../src/features/learn/ui/messages";
import { NOTIFICATIONS_MESSAGES } from "../src/features/notifications.messages";
import { PALETTE_MESSAGES } from "../src/features/palette.messages";
import { SCM_MESSAGES } from "../src/features/scm/ui/messages";
import { SEARCH_MESSAGES } from "../src/features/search.messages";
import { STACK_MESSAGES } from "../src/features/stack.messages";
import { STUDIO_MESSAGES } from "../src/features/studio.messages";
import { TASKS_MESSAGES } from "../src/features/tasks.messages";
import { TEAM_MESSAGES } from "../src/features/team.messages";
import { TERMINAL_MESSAGES } from "../src/features/terminal.messages";
import { TUTOR_MESSAGES } from "../src/features/tutor.messages";
import { VISUALIZER_MESSAGES } from "../src/features/visualizer/ui/messages";
import { WELCOME_MESSAGES } from "../src/features/welcome.messages";
import { AGENT_TASKS_MESSAGES } from "../src/platform/desktop/agent-tasks.messages";
import { LLM_MESSAGES } from "../src/platform/desktop/llm.messages";

type W = Window & { trText: (s: string, toEn?: boolean) => string | null; LOCALE: string; RP: Record<string, () => void> } & Record<string, unknown>;
let w: W;
beforeEach(async () => { w = (await bootApp()) as unknown as W; w.LOCALE = "en"; });

/* parâmetros de exemplo para as entradas com {nome} */
const SAMPLE: Record<string, Record<string, string>> = { commit: { staged: " (staged)", branch: "develop" } };
const CATALOGS: Record<string, Messages<string>> = {
  boot: BOOT_MESSAGES,
  account: ACCOUNT_MESSAGES,
  board: BOARD_MESSAGES,
  changelog: CHANGELOG_MESSAGES,
  checkpoint: CHECKPOINT_MESSAGES,
  codereview: CODEREVIEW_MESSAGES,
  diagnostics: DIAGNOSTICS_MESSAGES,
  explorer: EXPLORER_MESSAGES,
  ext: EXT_MESSAGES,
  graph: GRAPH_MESSAGES,
  infra: INFRA_MESSAGES,
  learn: LEARN_MESSAGES,
  notifications: NOTIFICATIONS_MESSAGES,
  palette: PALETTE_MESSAGES,
  scm: SCM_MESSAGES,
  search: SEARCH_MESSAGES,
  stack: STACK_MESSAGES,
  studio: STUDIO_MESSAGES,
  tasks: TASKS_MESSAGES,
  team: TEAM_MESSAGES,
  terminal: TERMINAL_MESSAGES,
  tutor: TUTOR_MESSAGES,
  visualizer: VISUALIZER_MESSAGES,
  welcome: WELCOME_MESSAGES,
  agent_tasks: AGENT_TASKS_MESSAGES,
  llm: LLM_MESSAGES,
};

describe("translator", () => {
  const M = { en: { hi: "Hello {name}", only: "only en" }, ptAO: { hi: "Olá {name}", only: "" } } as const;
  it("dá o texto da língua actual, com os parâmetros, e deixa um {nome} sem parâmetro como está", () => {
    const t = translator(M as unknown as Messages<"hi" | "only">);
    expect(t("hi", { name: "Ana" })).toBe("Hello Ana");
    w.LOCALE = "ptAO";
    expect(t("hi", { name: "Ana" })).toBe("Olá Ana");
    expect(t("hi")).toBe("Olá {name}");
  });
});

describe("catálogos = o que o motor de tradução produzia", () => {
  for (const [ns, cat] of Object.entries(CATALOGS)) {
    it(`${ns}: cada entrada en/ptAO é um par do motor, no sentido da origem (ou o mesmo texto nas duas)`, () => {
      expect(Object.keys(cat.ptAO).sort()).toEqual(Object.keys(cat.en).sort());
      for (const k of Object.keys(cat.en)) {
        const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_a, n: string) => SAMPLE[k]?.[n] ?? n);
        const en = fill(cat.en[k]), pt = fill(cat.ptAO[k]);
        // o texto de origem estava numa das línguas: o motor traduzia-o para a outra. Algumas regras do motor só vão
        // de português para inglês (p.ex. «✓ Commit … em …»), por isso basta o sentido da origem.
        const fromPt = (w.trText(pt, true) ?? pt) === en, fromEn = (w.trText(en, false) ?? en) === pt;
        expect(fromPt || fromEn, `${ns}.${k}: «${en}» / «${pt}» não é um par do motor`).toBe(true);
      }
    });
  }
});

describe("o pane Source Control nas duas línguas", () => {
  it("em ptAO os textos saem em português, já na língua certa (o motor não tem nada para trocar)", () => {
    if (!document.getElementById("pane-scm")) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-scm"></div>');
    w.LOCALE = "ptAO";
    w.RP.scm();
    const txt = document.getElementById("pane-scm")!.textContent!;
    expect(txt).toContain("Alterações");
    expect(txt).toContain("Gitflow — próximo passo");
    expect(txt).toMatch(/✓ Commit em \S+/);
    expect((document.getElementById("scm-msg") as HTMLInputElement).placeholder).toBe("Mensagem de commit");
    w.LOCALE = "en";
    w.RP.scm();
    expect(document.getElementById("pane-scm")!.textContent).toContain("Changes");
  });
});
