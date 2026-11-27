/* ═════════ feature `newproject` — caso de uso: o diálogo New Project ═════════
   Escolher um template (linguagem, framework, servidor ou aplicação), dar-lhe um nome, a pasta-mãe e a versão,
   e criar: o backend diz onde fica e o que acontece (`project_new_plan`), o humano aprova no diálogo partilhado,
   o backend cria (auditado) e a pasta abre-se logo como workspace. Sem DOM, sem window. */

import { nameProblem, parseCreated, parsePlan, parseTemplates, slug, type Created, type Template } from "../domain/catalog";
import type { HumanPort, NewProjectCopy, ScaffoldPort, WorkspacePort } from "./ports";

export interface NewProjectState {
  open: boolean;
  step: "pick" | "form" | "busy" | "done";
  templates: Template[] | null;
  loading: boolean;
  error: string | null;
  selected: Template | null;
  name: string;
  parent: string;
  version: string;
  result: Created | null;
}

export interface NewProjectDeps {
  scaffold: ScaffoldPort;
  workspace: WorkspacePort;
  human: HumanPort;
  copy: NewProjectCopy;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : String(e));

export function makeNewProject(deps: NewProjectDeps) {
  let st: NewProjectState = { open: false, step: "pick", templates: null, loading: false, error: null, selected: null, name: "", parent: "", version: "", result: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<NewProjectState>): void => {
    st = { ...st, ...patch };
    listeners.forEach((f) => f());
  };

  async function load(): Promise<void> {
    set({ loading: true, error: null });
    try {
      set({ templates: parseTemplates(await deps.scaffold.templates()), loading: false });
    } catch (e: unknown) {
      set({ loading: false, error: message(e) });
    }
  }

  return {
    state: (): NewProjectState => st,
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    /** Abre o diálogo na escolha do template. */
    open(): void {
      if (!deps.scaffold.available()) {
        set({ open: true, step: "pick", error: deps.copy("needsDesktop") });
        return;
      }
      set({ open: true, step: "pick", error: null, result: null, parent: st.parent || deps.workspace.defaultParent() || "" });
      if (!st.templates && !st.loading) void load();
    },
    close(): void {
      if (st.step !== "busy") set({ open: false });
    },
    pick(id: string): void {
      const t = st.templates?.find((x) => x.id === id);
      if (!t) return;
      set({ selected: t, step: "form", version: t.version, name: st.name || slug(`${t.id}-app`), error: null });
    },
    back(): void {
      if (st.step === "form") set({ step: "pick", error: null });
    },
    /** O nome enquanto se escreve (sem redesenhar: devolve o problema para a vista o mostrar). */
    setName(v: string): ReturnType<typeof nameProblem> {
      st = { ...st, name: v.trim() };
      return nameProblem(st.name);
    },
    setParent(v: string): void {
      st = { ...st, parent: v.trim() };
    },
    setVersion(v: string): void {
      st = { ...st, version: v };
    },
    async chooseParent(): Promise<void> {
      const p = await deps.workspace.pickFolder();
      if (p) set({ parent: p });
    },
    /** Plano → aprovação → criação → a pasta abre-se como workspace. */
    async create(): Promise<boolean> {
      const t = st.selected;
      if (!t || st.step !== "form") return false;
      if (nameProblem(st.name) || !st.parent) {
        set({});
        return false;
      }
      const version = t.version ? st.version || t.version : null;
      try {
        const plan = parsePlan(await deps.scaffold.plan(st.parent, st.name, t.id, version));
        if (!plan) throw new Error(deps.copy("badResponse"));
        const d = await deps.human.approve({ title: deps.copy("approveTitle", { name: st.name, template: t.name }), command: plan.command, scope: plan.dir });
        if (!d.approved) return false;
        set({ step: "busy", error: null });
        const made = parseCreated(await deps.scaffold.create(st.parent, st.name, t.id, version));
        if (!made) throw new Error(deps.copy("badResponse"));
        set({ step: "done", result: made });
        await deps.workspace.open(made.dir);
        return true;
      } catch (e: unknown) {
        set({ step: "form", error: message(e) });
        return false;
      }
    },
  };
}

export type NewProject = ReturnType<typeof makeNewProject>;
