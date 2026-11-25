import { afterEach, describe, expect, it } from "vitest";
import { BUILD, buildLabel, mountBuildBadge } from "../src/app/build-info";

/* r23 F1: a barra de estado mostra a build (versão · commit, `*` com alterações por commitar). */

afterEach(() => { document.body.innerHTML = ""; });

describe("a build na barra de estado", () => {
  it("o rótulo: versão e commit; sem o define do vite (testes) fica dev", () => {
    expect(buildLabel({ version: "0.7.0", commit: "5ea8115", dirty: false, date: "" })).toBe("0.7.0 · 5ea8115");
    expect(buildLabel({ version: "0.7.0", commit: "5ea8115", dirty: true, date: "" })).toBe("0.7.0 · 5ea8115*");
    expect(BUILD.version).toBe("dev");
    expect(buildLabel()).toBe("dev");
  });

  it("entra antes do sino, uma só vez, e a versão da app desktop substitui-a", () => {
    document.body.innerHTML = '<div class="status"><button id="st-mode"></button><button id="st-bell"></button></div>';
    mountBuildBadge();
    mountBuildBadge("0.7.0");
    const items = document.querySelectorAll("#st-build");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("0.7.0");
    expect((items[0].nextElementSibling as HTMLElement).id).toBe("st-bell");
  });
});
