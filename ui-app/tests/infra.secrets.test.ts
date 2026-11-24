import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* A0.5 (docs/v2/UI-AUDIT.md): staging/production secret values were saved in plain text in
 * localStorage (key envx6). They now live in memory for the session only, and values saved
 * by earlier versions are removed the first time the environments state is loaded.
 * ADR-0006 R5c1: the state moved to key envx7 (envx6 also held made-up deployment state), so
 * the old key is emptied as a whole. */

const KEY = "dx2.envx7", OLD = "dx2.envx6";
let w: any;
let infra: any;

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe("environment secrets are never written to localStorage", () => {
  it("initSecrets keeps the values in memory but saves the rest without them", async () => {
    w = await bootApp();
    infra = await import("../src/features/infra");
    infra.initSecrets();
    expect(w.ENVX.sec).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    expect(saved).not.toHaveProperty("sec");
    expect(saved).toHaveProperty("cur");
  });

  it("removes secret values saved by earlier versions", async () => {
    localStorage.setItem(OLD, JSON.stringify({ cur: "staging", sec: { staging: { api: { DATABASE_URL: "postgres://app:s3cret@db/app" } }, production: {} } }));
    localStorage.setItem(KEY, JSON.stringify({ cur: "staging", sec: { staging: { api: { DATABASE_URL: "postgres://app:t0p@db/app" } }, production: {} } }));
    w = await bootApp();
    infra = await import("../src/features/infra");
    infra.initSecrets();
    expect(localStorage.getItem(OLD) || "").not.toContain("s3cret");
    const raw = localStorage.getItem(KEY) || "";
    expect(raw).not.toContain("t0p");
    expect(JSON.parse(raw)).not.toHaveProperty("sec");
    expect(w.ENVX.cur).toBe("staging");
    expect(JSON.stringify(w.ENVX.sec)).not.toContain("t0p"); // fresh keys to fill in, not the saved values
  });
});
