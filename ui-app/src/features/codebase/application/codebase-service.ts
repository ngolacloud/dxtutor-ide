/* ═══════════ feature `codebase` — application: Dependencies and Onboarding (A10) ═══════════
   Dependencies: what is behind and vulnerable (offline first; online asks the registries); each update
   is the exact command, approved and run in a terminal, then the tests. Onboarding: the project's map,
   and Co-Dev's tour of it. No DOM, no window. */

import { mapText, upgradeLatest, updateCompatible } from "../domain/rules";
import type { DepsReport, OnboardMap } from "../domain/types";
import type { CodebasePort, CodevPort, HumanPort, WorldPort } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

export interface CodebaseState {
  deps: DepsReport | null;
  depsBusy: boolean;
  online: boolean;
  map: OnboardMap | null;
  mapBusy: boolean;
  ran: string | null;
  error: string;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeCodebase(deps: { port: CodebasePort; world: WorldPort; human: HumanPort; codev: CodevPort; say: Say }) {
  const { port, world, human, codev, say } = deps;
  const st: CodebaseState = { deps: null, depsBusy: false, online: false, map: null, mapBusy: false, ran: null, error: "" };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function loadDeps(online = st.online): Promise<void> {
    const root = world.root();
    if (!root || st.depsBusy) return;
    st.online = online; st.depsBusy = true; st.error = ""; emit();
    try { st.deps = await port.deps(root, online); } catch (e) { st.error = msg(e); }
    st.depsBusy = false; emit();
  }
  async function loadMap(): Promise<void> {
    const root = world.root();
    if (!root || st.mapBusy) return;
    st.mapBusy = true; st.error = ""; emit();
    try { st.map = await port.map(root); } catch (e) { st.error = msg(e); }
    st.mapBusy = false; emit();
  }
  function find(eco: number, name: string) {
    const e = st.deps?.ecosystems[eco];
    const d = e?.outdated.find((x) => x.name === name);
    return e && d ? { e, d } : null;
  }
  function run(what: string, cmd: string): void {
    if (!human.confirm(say("confirmCmd", { what, cmd }))) return;
    world.runInTerminal(cmd);
    st.ran = cmd; emit();
  }

  return {
    state: (): CodebaseState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    loadDeps, loadMap,
    update: (eco: number, name: string, latest: boolean) => {
      const f = find(eco, name);
      if (!f) return;
      const cmd = latest ? upgradeLatest(f.e, f.d) : updateCompatible(f.e, f.d);
      if (cmd) run(say(latest ? "upgradeWhat" : "updateWhat", { n: name, v: (latest ? f.d.latest : f.d.compatible) ?? "" }), cmd);
    },
    planUpgrade: (eco: number, name: string) => {
      const f = find(eco, name);
      if (!f || !codev.available()) return;
      codev.ask({ intent: "change", text: say("askUpgrade", { n: name, from: f.d.current, to: f.d.latest ?? f.d.compatible ?? "" }), context: [{ kind: "problem", label: `${f.e.kind} ${name}`, text: `${f.e.kind} dependency ${name}: ${f.d.current} → ${f.d.latest ?? f.d.compatible} (${f.d.jump}${f.d.direct ? ", direct" : ", transitive"}) in ${f.e.dir}` }], send: false });
    },
    explainVuln: (eco: number, id: string) => {
      const v = st.deps?.ecosystems[eco]?.vulns.find((x) => x.id === id);
      if (!v || !codev.available()) return;
      codev.ask({ intent: "explain", text: say("askVuln"), context: [{ kind: "problem", label: `${v.id} · ${v.package}`, text: `${v.id} (${v.severity}) in ${v.package} ${v.version}: ${v.title}\nfixed in: ${v.fixed.join(", ") || "no fixed version"}\n${v.url}` }], send: true });
    },
    tour: () => {
      if (!st.map || !codev.available()) return;
      codev.ask({ intent: "explain", text: say("askTour"), context: [{ kind: "file", label: say("mapLabel"), text: mapText(st.map) }], send: true });
    },
    runEntry: (i: number) => {
      const e = st.map?.entries[i];
      if (e?.run) run(say("runWhat", { n: e.name }), e.run);
    },
    open: (rel: string) => world.open(rel),
    showTests: () => world.showTests(),
  };
}

export type Codebase = ReturnType<typeof makeCodebase>;
