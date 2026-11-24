import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";
import { deriveScopes, parseTeamJson, teamJson } from "../src/features/team-scopes";

/* ADR-0006, R3c: a equipa e os escopos vêm do projecto; Tasks com os sprints do backlog e sem
 * custos inventados. */

describe("deriveScopes — os escopos a partir da estrutura real da pasta", () => {
  it("um projecto Rust na raiz: o backend tem o código e o manifesto; os comandos detectados", () => {
    const s = deriveScopes(["Cargo.toml", "src/main.rs", "tests/it.rs", "migrations/0001.sql"], "cargo test", "cargo clippy --all-targets");
    expect(s.be.paths).toEqual(expect.arrayContaining(["src/**", "Cargo.toml"]));
    expect(s.be.cmds).toEqual(["cargo test", "cargo clippy --all-targets"]);
    expect(s.fe.paths).toEqual([]); // sem package.json não há frontend
    expect(s.db.paths).toContain("migrations/**");
    expect(s.lead.paths).toEqual(["**"]);
  });

  it("um monorepo: cada projecto numa pasta (backend Go + web com package.json); node_modules não conta", () => {
    const s = deriveScopes(["services/api/go.mod", "services/api/main.go", "web/package.json", "web/src/App.tsx", "web/node_modules/x/package.json"], null, null);
    expect(s.be.paths).toEqual(["services/api/**"]);
    expect(s.fe.paths).toEqual(["web/**"]);
    expect(s.be.cmds).toEqual([]);
  });

  it("nada do projecto de demonstração nos padrões", () => {
    const all = JSON.stringify(deriveScopes([], null, null));
    expect(all).not.toMatch(/crates\/\*\/tests|desktop\/src|db\/migrations|apps\//);
  });
});

describe(".dxtutor/team.json", () => {
  it("lê só as entradas válidas e ida-e-volta com teamJson", () => {
    const t = parseTeamJson(JSON.stringify({ agents: { be: { paths: ["svc/**"], cmds: ["go test ./..."], max: 9 }, fe: { paths: "não é lista" }, x: 3 } }))!;
    expect(t.be).toEqual({ paths: ["svc/**"], cmds: ["go test ./..."], max: 9 });
    expect(t.fe).toEqual({});
    expect(parseTeamJson("{ estragado")).toBeNull();
    expect(parseTeamJson(teamJson({ qa: { paths: ["t/**"], cmds: [] } }))).toEqual({ qa: { paths: ["t/**"], cmds: [] } });
  });
});

describe("na cadeia real", () => {
  let w: any;
  let TMod: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7e)
  beforeEach(async () => { w = await bootApp(); TMod = await import("../src/features/team"); });
  afterEach(() => { delete w.DXR; });

  const open = () => document.dispatchEvent(new window.CustomEvent("dx:workspace", { detail: { root: "/proj" } }));

  it("ao abrir a pasta, os escopos vêm da estrutura dela e o team.json do projecto manda", () => {
    w.DXR = { root: "/proj", projectCmd: (k: string) => (k === "test" ? { cmd: "cargo test" } : null) };
    w.writeFile(w.ROOT + ".dxtutor/team.json", JSON.stringify({ agents: { qa: { paths: ["e2e/**"], cmds: ["npm run e2e"] } } }));
    open();
    expect(w.AGENTS.be.paths).toEqual(expect.arrayContaining(["crates/**", "Cargo.toml"])); // a fixture tem crates/ e um Cargo.toml na raiz
    expect(w.AGENTS.be.cmds).toEqual(["cargo test"]);
    expect(w.AGENTS.qa.paths).toEqual(["e2e/**"]);
    expect(w.AGENTS.qa.cmds).toEqual(["npm run e2e"]);
    expect(TMod.inScope("qa", w.ROOT + "e2e/login.spec.ts")).toBe(true);
  });

  it("com pasta, gravar a equipa escreve .dxtutor/team.json no projecto", () => {
    w.DXR = { root: "/proj" };
    w.AGENTS.db.paths = ["sql/**"];
    TMod.saveTeam();
    const saved = parseTeamJson(w.FS[w.ROOT + ".dxtutor/team.json"].content)!;
    expect(saved.db.paths).toEqual(["sql/**"]);
  });

  it("Tasks: os filtros de sprint vêm do backlog (não «Sprint 1/2» fixos)", () => {
    w.mkIssue({ title: "a", agent: "be", sprint: 0 });
    w.mkIssue({ title: "b", agent: "be", sprint: 2 });
    if (!document.getElementById("pane-tasks")) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-tasks"></div>'); // nasce no boot6, que não corre no harness
    w.RP.tasks();
    const labels = [...document.querySelectorAll("#pane-tasks .tk-f .seg button")].map((b) => b.textContent);
    expect(labels).toEqual(["All", "Sprint 1", "Sprint 3"]);
  });

  it("Tasks: sem custo medido, o conselho não inventa tokens nem dólares", () => {
    const it = w.mkIssue({ title: "Lista", agent: "be", sprint: 0, stage: "todo" });
    w.openIssue(it.id);
    const t = document.body.textContent || "";
    expect(t).toMatch(/no measured cost for Backend in this project yet/);
    expect(t).not.toMatch(/≈1\.2k tokens|≈\d[\d.]*k? tokens · ~\$/);
  });
});

it("RF-A06: gravar os escopos dos assistentes mantém as pessoas e os papéis do team.json", async () => {
  const { teamJsonKeeping } = await import("../src/features/team-scopes");
  const prev = JSON.stringify({ agents: { be: { paths: ["old/**"], cmds: [] } }, people: [{ email: "ana@x.pt", roles: ["architect"] }] });
  const out = JSON.parse(teamJsonKeeping({ be: { paths: ["src/**"], cmds: ["cargo"] } } as never, prev));
  expect(out.agents.be.paths).toEqual(["src/**"]);
  expect(out.people).toEqual([{ email: "ana@x.pt", roles: ["architect"] }]);
  // no previous file, or not JSON: only the agents
  expect(Object.keys(JSON.parse(teamJsonKeeping({} as never, undefined)))).toEqual(["agents"]);
  expect(Object.keys(JSON.parse(teamJsonKeeping({} as never, "{nope")))).toEqual(["agents"]);
});
