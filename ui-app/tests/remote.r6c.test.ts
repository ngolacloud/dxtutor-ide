import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { parseSshConfig, sshTarget } from "../src/features/remote-config";

/* ADR-0006, R6c: o Remote Explorer deixa os hosts fixos («delonix», kaeso-preprod,
 * ngolacloud-cp-01). Os hosts vêm do ~/.ssh/config real (porta `desktopPorts.remote`, falsa
 * aqui) mais os acrescentados no pane Infra; cada um abre um terminal SSH ou testa a ligação. */

describe("parseSshConfig", () => {
  const cfg = `# comentário
Host *
  ServerAliveInterval 30
Host prod web-01   # dois nomes
  HostName 10.0.0.5
  User deploy
  Port 2222
Host prod
  User outro          # o primeiro valor ganha
Host = bastion
  HostName=bastion.example.com
  IdentityFile ~/.ssh/id_ed25519
Host gw-?
  User x
Match host *.internal
  User y
Include ~/.ssh/config.d/*
`;
  it("os hosts concretos, com o que o bloco lhes dá; padrões, Match e o primeiro valor como no OpenSSH", () => {
    const c = parseSshConfig(cfg);
    expect(c.hosts).toEqual([
      { name: "prod", hostname: "10.0.0.5", user: "deploy", port: "2222" },
      { name: "web-01", hostname: "10.0.0.5", user: "deploy", port: "2222" },
      { name: "bastion", hostname: "bastion.example.com", identityFile: "~/.ssh/id_ed25519" },
    ]);
    expect(c.includes).toEqual(["~/.ssh/config.d/*"]);
  });
  it("sshTarget: user@hostname:porta (sem a porta 22)", () => {
    expect(sshTarget({ name: "prod", hostname: "10.0.0.5", user: "deploy", port: "2222" })).toBe("deploy@10.0.0.5:2222");
    expect(sshTarget({ name: "box", port: "22" })).toBe("box");
  });
  it("vazio ou lixo não rebenta", () => {
    expect(parseSshConfig("")).toEqual({ hosts: [], includes: [] });
    expect(parseSshConfig("???").hosts).toEqual([]);
  });
});

let w: any;
let desktopPorts: Record<string, any>;
const pane = () => document.getElementById("pane-remote")!;

beforeEach(async () => {
  w = await bootApp();
  desktopPorts = (await import("../src/app/desktop")).desktopPorts as Record<string, any>;
  if (!pane()) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-remote"></div>');
});

afterEach(() => {
  delete desktopPorts.remote;
  vi.restoreAllMocks();
});

describe("Remote Explorer", () => {
  it("no browser: sem hosts inventados; diz de onde vêm", async () => {
    (await import("../src/features/remote")).renderRemotePane();
    expect(pane().textContent).toMatch(/~\/\.ssh\/config in the desktop app/);
    expect(pane().textContent).not.toMatch(/kaeso|ngolacloud|delonix/);
  });

  it("no desktop: os hosts do ~/.ssh/config e os do Infra; terminal e teste de ligação", async () => {
    const connect = vi.fn(), test = vi.fn(async () => ({ ok: false, message: "Connection refused" }));
    desktopPorts.remote = { config: async () => ({ text: "Host prod\n  HostName 10.0.0.5\n  User deploy\n" }), connect, test, local: () => "me@box" };
    w.ENVS.ssh = ["dev@edge-01"];
    (await import("../src/features/remote")).renderRemotePane();
    await vi.waitFor(() => expect(pane().textContent).toMatch(/deploy@10\.0\.0\.5/));
    expect(pane().textContent).toMatch(/me@box/);
    expect(pane().textContent).toMatch(/dev@edge-01.*added in Infra/);
    (pane().querySelector('[data-remote="connect"][data-host="prod"]') as HTMLElement).click();
    expect(connect).toHaveBeenCalledWith("prod");
    (pane().querySelector('[data-remote="test"][data-host="prod"]') as HTMLElement).click();
    expect(pane().textContent).toMatch(/a testar/);
    await vi.waitFor(() => expect(pane().textContent).toMatch(/✖ Connection refused/));
    expect(test).toHaveBeenCalledWith("prod");
  });

  it("sem ~/.ssh/config, diz que não há hosts; um erro de leitura diz-se", async () => {
    desktopPorts.remote = { config: async () => ({ text: null, error: "Permission denied" }), connect: vi.fn(), test: vi.fn(), local: () => "me@box" };
    w.ENVS.ssh = [];
    (await import("../src/features/remote")).renderRemotePane();
    await vi.waitFor(() => expect(pane().textContent).toMatch(/Permission denied/));
  });

  it("Infra: clicar num host abre o terminal SSH no desktop; no browser diz que não há como", () => {
    w.ENVS.ssh = ["dev@edge-01"];
    if (!document.getElementById("pane-infra")) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-infra"></div>'); // nasce no boot5, fora do harness
    w.renderInfraPane();
    const toast = vi.spyOn(w, "toast");
    const rowEl = () => document.querySelector('#pane-infra [data-action="ssh-open"]') as HTMLElement | null;
    expect(rowEl()).toBeTruthy();
    rowEl()!.click();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/need the desktop app/));
    const connect = vi.fn();
    desktopPorts.remote = { config: async () => ({ text: "" }), connect, test: vi.fn(), local: () => "" };
    rowEl()!.click();
    expect(connect).toHaveBeenCalledWith("dev@edge-01");
  });
});
