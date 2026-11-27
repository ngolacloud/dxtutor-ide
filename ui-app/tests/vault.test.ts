import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TARGET, childPath, isKey, parentPath, patchCommand, statusKind, ttlText } from "../src/features/vault/domain/rules";
import { makeVault } from "../src/features/vault/application/vault-service";
import type { ApprovalRequest, VaultPort } from "../src/features/vault/application/ports";
import type { KvMeta, VaultStatus, VaultTarget } from "../src/features/vault/domain/types";
import { tauriVault } from "../src/features/vault/infrastructure/tauri";
import { renderVault } from "../src/features/vault/ui/view";

/* r23 F4c (docs/v2/AUDIT-r23.md §4.4, K01–K05): o ecrã do Vault — o token só vai para o backend (keychain) e
 * nunca volta; metadados de todos os ambientes, valores só de `local`, 20 s, com motivo; mudar um valor é num
 * terminal (aprovado e auditado); credenciais dinâmicas como lease, revogado quando o terminal acaba. */

const TOKEN = "hvs.pasted-token-SECRET";
const ON: VaultStatus = { addr: "http://127.0.0.1:8200", namespace: null, reachable: true, initialized: true, sealed: false, version: "2.2.2", signedIn: true, displayName: "token-ana", policies: ["default", "dev"], ttl: 3500, renewable: true, notes: "", cli: true, keychain: true, keychainNote: null };
const OFF: VaultStatus = { ...ON, signedIn: false, displayName: null, policies: [], ttl: null, notes: "not signed in" };
const META = (path: string, env: KvMeta["env"]): KvMeta => ({ mount: "secret", path, env, exists: true, currentVersion: 2, versions: [{ version: 2, created: "2026-11-26T10:00:00Z", deleted: false, destroyed: false }, { version: 1, created: "2026-11-25T10:00:00Z", deleted: true, destroyed: false }], created: "2026-11-25T10:00:00Z", updated: "2026-11-26T10:00:00Z", customMetadata: { owner: "shop" }, keys: env === "local" ? ["DB_PASSWORD", "DB_USER"] : null, children: [] });

describe("domínio", () => {
  it("TTL, estado da barra, o comando de patch (lê o valor do stdin) e caminhos", () => {
    expect([ttlText(null), ttlText(0), ttlText(45), ttlText(600), ttlText(7500)]).toEqual(["", "∞", "45s", "10m", "2h 5m"]);
    const tg: VaultTarget = { ...DEFAULT_TARGET, addr: "http://v:8200" };
    expect(statusKind(DEFAULT_TARGET, null)).toBe("none");
    expect(statusKind(tg, null)).toBe("unreachable");
    expect(statusKind(tg, { ...ON, sealed: true })).toBe("sealed");
    expect(statusKind(tg, OFF)).toBe("signedOut");
    expect(statusKind(tg, { ...ON, ttl: 300 })).toBe("expiring");
    expect(statusKind(tg, { ...ON, ttl: 0 })).toBe("signedIn");
    expect(patchCommand("secret", "apps/shop/local/db", "DB_PASSWORD")).toBe("vault kv patch -mount=secret apps/shop/local/db DB_PASSWORD=-");
    expect(patchCommand("kv v2", "a b", "k")).toBe("vault kv patch -mount='kv v2' 'a b' k=-");
    expect([childPath("apps", "shop/"), childPath("", "apps/"), parentPath("apps/shop/local"), parentPath("apps")]).toEqual(["apps/shop", "apps", "apps/shop", ""]);
    expect([isKey("DB_PASSWORD"), isKey("a.b-c"), isKey("1x"), isKey("a b"), isKey("x;rm")]).toEqual([true, true, false, false, false]);
  });
});

function fakes(opts: { approve?: boolean } = {}) {
  let status: VaultStatus = OFF;
  const calls: string[] = [];
  const confirms: ApprovalRequest[] = [];
  const audited: Array<{ action: string; approved: boolean; outcome?: string; command: string }> = [];
  const ran: Array<{ cmd: string; vault: { addr: string; namespace: string | null; lease?: string | null } }> = [];
  const toasts: string[] = [];
  const timers: Array<() => void> = [];
  let revoked: ((lease: string, ok: boolean) => void) | null = null;
  let saved: VaultTarget | null = null;
  let secret: string | null = TOKEN;
  const texts: Array<string | null> = [];
  const port: VaultPort = {
    status: async () => { calls.push("status"); return status; },
    loginToken: async (_w, tok) => { calls.push(`loginToken ${tok === TOKEN ? "TOKEN" : tok}`); status = ON; return status; },
    loginOidc: async (_w, mount, role) => { calls.push(`oidc ${mount} ${role}`); status = ON; return status; },
    renew: async () => { calls.push("renew"); return status; },
    revoke: async () => { calls.push("revoke"); status = OFF; return status; },
    kvMeta: async (_w, _m, path) => { calls.push(`meta ${path}`); return path.includes("/local/") ? META(path, "local") : path.includes("/production/") ? META(path, "production") : { ...META(path, null), exists: false, children: ["local/", "production/"] }; },
    reveal: async (root, _w, mount, path, key, reason) => { calls.push(`reveal ${root} ${mount}/${path} ${key} «${reason}»`); return { id: "r1", path, key, ttlMs: 20_000 }; },
    revealRead: async () => "local-pw-123",
    dynamic: async (root, _w, mount, role, reason) => { calls.push(`dynamic ${root} ${mount} ${role} «${reason}»`); return { leaseId: "database/creds/app/L1", ttl: 900, renewable: true, fields: ["password", "username"], env: ["VAULT_DYN_PASSWORD", "VAULT_DYN_USERNAME"] }; },
    leaseRevoke: async (_r, _w, lease) => { calls.push(`leaseRevoke ${lease}`); },
    onLeaseRevoked: (f) => { revoked = f; },
  };
  const v = makeVault({
    vault: port,
    world: {
      root: () => "/proj",
      runInTerminal: (cmd, vault) => { ran.push({ cmd, vault }); return Promise.resolve(0); },
      loadTarget: () => ({ addr: "http://127.0.0.1:8200", role: "dev", dynRole: "app" }),
      saveTarget: (x) => { saved = x; },
      now: () => 1_000, after: (_ms, f) => { timers.push(f); },
    },
    human: {
      approve: async (r) => { confirms.push(r); return { approved: opts.approve ?? true, reason: opts.approve === false ? "" : "rotating the local db", decidedAt: 5 }; },
      secret: async () => secret, text: async () => texts.shift() ?? null, toast: (m) => toasts.push(m),
    },
    audit: { record: async (_root, e) => { audited.push(e); } },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return { v, calls, confirms, audited, ran, toasts, timers, texts, saved: () => saved, revoked: () => revoked!, noSecret: () => { secret = null; } };
}

describe("o serviço", () => {
  it("entrar com um token colado: vai ao backend uma vez e não fica no estado; OIDC; sair", async () => {
    const f = fakes();
    await f.v.refresh();
    expect(f.v.state().status?.signedIn).toBe(false);
    await f.v.loginToken();
    expect(f.calls).toContain("loginToken TOKEN");
    expect(JSON.stringify(f.v.state())).not.toContain(TOKEN);
    await f.v.signOut();
    expect(f.v.state().status?.signedIn).toBe(false);
    await f.v.loginOidc();
    expect(f.calls).toContain("oidc oidc dev");
    expect(f.toasts.at(-1)).toContain("signedIn");
    f.noSecret();
    const n = f.calls.length;
    await f.v.loginToken();
    expect(f.calls).toHaveLength(n);
  });

  it("produção: só metadados, sem «mostrar»; local: mostrar pede motivo, o Rust audita, e o valor desaparece ao fim do prazo", async () => {
    const f = fakes();
    await f.v.loginToken();
    await f.v.browse("apps/shop/production/db");
    expect(f.v.state().meta?.keys).toBeNull();
    await f.v.reveal("DB_PASSWORD");
    expect(f.confirms).toHaveLength(0);
    await f.v.browse("apps/shop/local/db/");
    expect(f.v.state().path).toBe("apps/shop/local/db");
    await f.v.reveal("DB_PASSWORD");
    expect(f.confirms[0]).toMatchObject({ reasonRequired: true });
    expect(f.calls).toContain("reveal /proj secret/apps/shop/local/db DB_PASSWORD «rotating the local db»");
    expect(f.v.state().shown).toMatchObject({ key: "DB_PASSWORD", value: "local-pw-123", until: 21_000 });
    f.timers[0]();
    expect(f.v.state().shown).toBeNull();
    await f.v.up();
    expect(f.v.state().path).toBe("apps/shop/local");
  });

  it("mudar um valor: aprovado, auditado antes e com o resultado, num terminal com o Vault do backend (o valor nunca passa aqui)", async () => {
    const f = fakes();
    await f.v.loginToken();
    await f.v.browse("apps/shop/production/db");
    f.texts.push("DB_PASSWORD");
    await f.v.patch();
    expect(f.confirms[0]).toMatchObject({ command: "vault kv patch -mount=secret apps/shop/production/db DB_PASSWORD=-", destructive: true, confirmText: "DB_PASSWORD" });
    expect(f.ran[0]).toEqual({ cmd: "vault kv patch -mount=secret apps/shop/production/db DB_PASSWORD=-", vault: { addr: "http://127.0.0.1:8200", namespace: null } });
    await vi.waitFor(() => expect(f.audited.map((a) => `${a.action}:${a.approved}:${a.outcome}`)).toEqual(["vault.patch:true:sent", "vault.patch:true:ok"]));
    f.texts.push("not a key!");
    await f.v.patch();
    expect(f.toasts.at(-1)).toBe("badKey");
  });

  it("recusado: nada corre e a recusa vai para o registo", async () => {
    const f = fakes({ approve: false });
    await f.v.loginToken();
    await f.v.browse("apps/shop/local/db");
    await f.v.patch("DB_USER");
    expect(f.ran).toEqual([]);
    await vi.waitFor(() => expect(f.audited.map((a) => `${a.action}:${a.approved}`)).toEqual(["vault.patch:false"]));
    await f.v.reveal("DB_USER");
    expect(f.calls.some((c) => c.startsWith("reveal"))).toBe(false);
  });

  it("credenciais dinâmicas: o lease; um terminal com ele; revogado quando o terminal acaba (ou já)", async () => {
    const f = fakes();
    await f.v.loginToken();
    await f.v.dynamic();
    expect(f.calls).toContain("dynamic /proj database app «rotating the local db»");
    expect(f.v.state().leases[0].leaseId).toBe("database/creds/app/L1");
    f.v.useLease("database/creds/app/L1");
    expect(f.ran[0].vault).toEqual({ addr: "http://127.0.0.1:8200", namespace: null, lease: "database/creds/app/L1" });
    f.revoked()("database/creds/app/L1", true);
    expect(f.v.state().leases).toEqual([]);
    expect(f.toasts.at(-1)).toContain("leaseRevoked");
    await f.v.dynamic();
    await f.v.revokeLease("database/creds/app/L1");
    expect(f.calls.at(-1)).toBe("leaseRevoke database/creds/app/L1");
    expect(f.v.state().leases).toEqual([]);
  });

  it("mudar o endereço guarda-o (sem token) e volta a ler o estado", async () => {
    const f = fakes();
    f.v.setTarget({ addr: " https://vault.example:8200 " });
    expect(f.saved()?.addr).toBe("https://vault.example:8200");
    expect(JSON.stringify(f.saved())).not.toContain("hvs.");
    await vi.waitFor(() => expect(f.calls.at(-1)).toBe("status"));
  });
});

describe("o adaptador Tauri", () => {
  it("os comandos e os argumentos", async () => {
    const seen: Array<[string, unknown]> = [];
    let listener: ((p: unknown) => void) | null = null;
    const port = tauriVault(async (cmd: string, args?: unknown) => { seen.push([cmd, args]); return null as never; }, (_e, f) => { listener = f; });
    const w = { addr: "http://v:8200", namespace: " " };
    await port.status(w);
    await port.loginToken(w, "t");
    await port.reveal("/p", { ...w, namespace: "team" }, "secret", "a/local/b", "K", "why");
    await port.dynamic("/p", w, "database", "app", "why");
    expect(seen).toEqual([
      ["vault_status", { addr: "http://v:8200", namespace: null }],
      ["vault_login_token", { addr: "http://v:8200", namespace: null, token: "t" }],
      ["vault_reveal_local", { root: "/p", addr: "http://v:8200", namespace: "team", mount: "secret", path: "a/local/b", key: "K", reason: "why" }],
      ["vault_dynamic", { root: "/p", addr: "http://v:8200", namespace: null, mount: "database", role: "app", reason: "why" }],
    ]);
    const got: string[] = [];
    port.onLeaseRevoked((l, ok) => got.push(`${l}:${ok}`));
    listener!({ lease: "L1", ok: true });
    expect(got).toEqual(["L1:true"]);
  });
});

describe("a vista", () => {
  it("sem sessão: entrar; com sessão: KV e credenciais; produção só com metadados; o valor local à vista", async () => {
    const f = fakes();
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    const host = document.createElement("div");
    const draw = (): void => { host.innerHTML = renderVault(t as never, f.v.state(), true); };
    await f.v.refresh();
    draw();
    expect(host.querySelector('[data-action="vault:oidc"]')).not.toBeNull();
    expect(host.querySelector('[data-action="vault:browse"]')).toBeNull();
    await f.v.loginToken();
    await f.v.browse("apps/shop/production/db");
    draw();
    expect(host.querySelector(".vt-env.e-production")).not.toBeNull();
    expect(host.textContent).toContain("metadataOnly");
    expect(host.querySelector('[data-action="vault:reveal"]')).toBeNull();
    expect(host.querySelectorAll(".vt-row").length).toBeGreaterThan(1);
    await f.v.browse("apps/shop/local/db");
    await f.v.reveal("DB_PASSWORD");
    draw();
    expect(host.querySelector(".vt-val")?.textContent).toBe("local-pw-123");
    expect(host.querySelector('[data-action="vault:reveal"][data-on="DB_USER"]')).not.toBeNull();
    expect(host.innerHTML).not.toContain(TOKEN);
    expect(renderVault(t as never, f.v.state(), false)).toContain("needDesktop");
  });
});
