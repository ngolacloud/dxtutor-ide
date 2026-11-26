/* ═══════════ feature `vault` — ui: the Vault screen (r23 F4c) ═══════════
   Connection and sign-in, the KV browser (metadata; local keys with show/patch), dynamic credentials.
   Texts from the catalog, the rest escaped. Actions: data-action="vault:…" + data-on. No window. */
import { esc } from "../../../core";
import { ttlText } from "../domain/rules";
import type { VaultState } from "../application/vault-service";
import type { KvMeta } from "../domain/types";
import type { VaultKey } from "./messages";

export type T = (k: VaultKey, p?: Record<string, string | number>) => string;

const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="vault:${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;
const field = (key: string, label: string, value: string, ph = ""): string =>
  `<label class="vt-f"><span>${label}</span><input class="inp notr" data-action="vault:field" data-on="${key}" value="${esc(value)}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off"></label>`;
const envKey = (e: string | null): VaultKey => (e === "local" ? "envLocal" : e === "staging" ? "envStaging" : e === "production" ? "envProduction" : "envUnknown");

function statusCard(t: T, st: VaultState): string {
  const s = st.status, b = st.busy !== null;
  if (!st.target.addr) return "";
  if (!s) return `<div class="sec-empty">${b ? "…" : ""}</div>`;
  const head = !s.reachable ? `<span class="vt-bad">${t("unreachable")}</span>` : s.sealed ? `<span class="vt-bad">${t("sealed")}</span>`
    : s.signedIn ? `<span class="vt-ok">${esc(t("signedInAs", { who: s.displayName ?? "?" }))}</span> <span class="vt-dim">${s.ttl === 0 ? t("never") : esc(t("expires", { t: ttlText(s.ttl) }))}</span>`
    : `<span class="vt-dim">${t("signedOut")}</span>`;
  const info = [s.version ? esc(t("version", { v: s.version })) : "", s.policies.length ? esc(t("policies", { p: s.policies.join(", ") })) : "", s.notes && !s.signedIn ? `<span class="notr">${esc(s.notes)}</span>` : ""].filter(Boolean).join(" · ");
  const acts = s.reachable && !s.sealed
    ? s.signedIn ? btn("renew", t("renew"), "", "btn ghost", b || !s.renewable) + btn("signout", t("signOut"), "", "btn ghost", b)
      : btn("oidc", st.busy === "oidc" ? t("waitingBrowser") : t("signInBrowser"), "", "btn", b) + btn("token", t("pasteTokenBtn"), "", "btn ghost", b)
    : "";
  return `<div class="vt-card"><div>${head}</div><div class="vt-dim">${info}</div>${!s.keychain ? `<div class="vt-bad notr">${esc(t("keychainOff", { e: s.keychainNote ?? "" }))}</div>` : ""}${!s.cli ? `<div class="vt-dim">${t("cliMissing")}</div>` : ""}<div class="vt-bar">${acts}</div></div>`;
}

function metaView(t: T, st: VaultState, m: KvMeta): string {
  const env = `<span class="vt-env e-${m.env ?? "none"}">${t(envKey(m.env))}</span>`;
  const kids = m.children.length ? `<div class="vt-kids">${m.children.map((c) => `<button class="vt-kid notr" data-action="vault:open" data-on="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : "";
  if (!m.exists) return `<div class="vt-bar">${env}</div>${kids || `<div class="sec-empty">${t("noSecret")}</div>`}`;
  const versions = m.versions.map((v) => `<div class="vt-row"><span class="notr">v${v.version}</span><span class="vt-dim notr">${esc(v.created)}</span>${v.version === m.currentVersion ? `<span class="vt-ok">${t("current")}</span>` : ""}${v.destroyed ? `<span class="vt-bad">${t("destroyed")}</span>` : v.deleted ? `<span class="vt-dim">${t("deleted")}</span>` : ""}</div>`).join("");
  const custom = Object.entries(m.customMetadata);
  const keys = m.keys
    ? m.keys.map((k) => {
      const shown = st.shown && st.shown.key === k && st.shown.path === m.path ? st.shown : null;
      return `<div class="vt-row"><span class="notr vt-key">${esc(k)}</span>${shown ? `<code class="vt-val notr">${esc(shown.value)}</code>${btn("hide", t("hide"))}` : btn("reveal", t("reveal"), k)}<span class="vt-sp"></span>${btn("patch", t("patch"), k)}</div>`;
    }).join("")
    : `<div class="vt-dim">${m.env ? esc(t("metadataOnly", { env: t(envKey(m.env)) })) : t("noEnv")}</div><div class="vt-bar">${btn("patch", t("patchKey"))}</div>`;
  return `<div class="vt-bar">${env}<span class="vt-dim notr">${esc(m.created ? t("created", { t: m.created }) : "")} · ${esc(m.updated ? t("updated", { t: m.updated }) : "")}</span></div>${kids}
    <div class="vt-ct">${t("keys")}</div>${keys}
    <div class="vt-ct">${t("versions")}</div>${versions}
    ${custom.length ? `<div class="vt-ct">${t("customMeta")}</div>${custom.map(([k, v]) => `<div class="vt-row"><span class="notr">${esc(k)}</span><span class="vt-dim notr">${esc(v)}</span></div>`).join("")}` : ""}`;
}

export function renderVault(t: T, st: VaultState, desktop: boolean): string {
  if (!desktop) return `<div class="vt"><div class="sec-empty">${t("needDesktop")}</div></div>`;
  const tg = st.target, signed = !!st.status?.signedIn, b = st.busy !== null;
  const conn = `<section class="vt-sec"><div class="vt-form">${field("addr", t("addr"), tg.addr, "https://vault.example:8200")}${field("namespace", t("namespace"), tg.namespace)}${field("oidcMount", t("oidcMount"), tg.oidcMount)}${field("role", t("role"), tg.role)}</div>${statusCard(t, st)}</section>`;
  const kv = signed ? `<section class="vt-sec"><h3>${t("kv")}</h3><div class="vt-bar">${field("kvMount", t("kvMount"), tg.kvMount)}<input class="inp notr vt-path" data-action="vault:path" value="${esc(st.path)}" placeholder="${esc(t("path"))}" spellcheck="false">${btn("browse", t("browse"), "", "btn ghost", b)}${st.path ? btn("up", t("up")) : ""}</div>${st.meta ? metaView(t, st, st.meta) : ""}</section>` : "";
  const dyn = signed ? `<section class="vt-sec"><h3>${t("dyn")}</h3><div class="vt-bar">${field("dynMount", t("dynMount"), tg.dynMount)}${field("dynRole", t("dynRole"), tg.dynRole)}${btn("dynamic", t("dynIssue"), "", "btn ghost", b)}</div>${st.leases.length ? st.leases.map((l) => `<div class="vt-row"><span class="notr vt-key">${esc(l.leaseId)}</span><span class="vt-dim">${esc(t("leaseTtl", { t: ttlText(l.ttl) }))}</span><span class="vt-dim notr">${esc(t("leaseFields", { f: l.fields.join(", "), env: l.env.join(" ") }))}</span><span class="vt-sp"></span>${btn("use-lease", t("leaseUse"), l.leaseId)}${btn("revoke-lease", t("leaseRevoke"), l.leaseId)}</div>`).join("") : `<div class="sec-empty">${t("noLeases")}</div>`}</section>` : "";
  return `<div class="vt"><div class="vt-top"><b>${t("title")}</b><span class="vt-dim">${t("sub")}</span></div>${st.error ? `<pre class="vt-err notr">${esc(st.error)}</pre>` : ""}${conn}${kv}${dyn}</div>`;
}
