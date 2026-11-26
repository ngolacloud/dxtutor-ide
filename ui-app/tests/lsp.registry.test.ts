// feature `lsp` — o registo de linguagens: UM ficheiro (`languages/registry.json`) lido pela UI e pelo backend.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRY, languageFor, languageForName, serverOf } from "../src/features/lsp/domain/registry";
import { languageIdFor } from "../src/features/lsp/domain/languages";
import { languageName, missingServerNotice } from "../src/features/lsp/domain/server-status";
import { KNOWN_LANGUAGE_SERVERS, languageOf } from "../src/features/ext/domain/contributions";

const REPO = resolve(__dirname, "../..");

describe("o registo de linguagens", () => {
  it("a UI e o backend lêem o MESMO ficheiro", () => {
    // o Rust embute-o com include_str!, relativo a crates/tutor-eval/src/langreg.rs
    const rsFile = resolve(REPO, "crates/tutor-eval/src/langreg.rs");
    const rsSpec = /include_str!\("([^"]+)"\)/.exec(readFileSync(rsFile, "utf-8"))?.[1];
    expect(rsSpec).toBeTruthy();
    const fromRust = resolve(dirname(rsFile), rsSpec!);
    // a UI importa-o pelo Vite, relativo a features/lsp/domain/registry.ts
    const tsFile = resolve(REPO, "ui-app/src/features/lsp/domain/registry.ts");
    const tsSpec = /import data from "([^"]+)"/.exec(readFileSync(tsFile, "utf-8"))?.[1];
    expect(tsSpec).toBeTruthy();
    const fromUi = resolve(dirname(tsFile), tsSpec!);
    expect(fromUi).toBe(fromRust);
    expect(fromUi).toBe(resolve(REPO, "languages/registry.json"));
    // e o que a UI tem é exactamente o conteúdo do ficheiro
    expect(REGISTRY).toEqual(JSON.parse(readFileSync(fromRust, "utf-8")));
  });

  it("cada extensão e cada nome de ficheiro pertence a uma só linguagem; cada servidor existe", () => {
    const exts = new Map<string, string>(), names = new Map<string, string>();
    for (const l of REGISTRY.languages) {
      expect(l.name.trim()).not.toBe("");
      for (const e of l.extensions ?? []) {
        expect(e).toBe(e.toLowerCase());
        expect(exts.get(e), `.${e}`).toBeUndefined();
        exts.set(e, l.id);
      }
      for (const f of l.filenames ?? []) {
        expect(names.get(f.toLowerCase()), f).toBeUndefined();
        names.set(f.toLowerCase(), l.id);
      }
      if (l.server) expect(serverOf(l), l.id).not.toBeNull();
    }
  });

  it("reconhece sem distinguir maiúsculas, pelo nome inteiro e pelo shebang", () => {
    const id = (p: string, c?: string) => languageFor(p, c)?.id ?? null;
    expect(id("q.SQL")).toBe("sql");
    expect(id("src/Main.JAVA")).toBe("java");
    expect(id("C:\\w\\lib.RS")).toBe("rust");
    expect(id("proj/Dockerfile")).toBe("dockerfile");
    expect(id("proj/dockerfile")).toBe("dockerfile");
    expect(id("proj/Makefile")).toBe("makefile");
    expect(id("proj/GNUmakefile")).toBe("makefile");
    expect(id("proj/Gemfile")).toBe("ruby");
    expect(id(".gitignore")).toBeNull();
    expect(id("a.b/README")).toBeNull();
    expect(id("scripts/deploy", "#!/usr/bin/env python3\nprint(1)\n")).toBe("python");
    expect(id("bin/run", "#!/bin/bash\n")).toBe("shellscript");
    expect(id("bin/x", "#!/usr/bin/fish\n")).toBeNull();
    expect(id("a.rs", "#!/usr/bin/env python3\n")).toBe("rust"); // o nome ganha
    expect(languageForName("x.H")?.id).toBe("cpp");
  });

  it("o languageId LSP: só para linguagens com servidor", () => {
    expect(languageIdFor("A.KT")).toBe("kotlin");
    expect(languageIdFor("a/b.mjs")).toBe("javascript");
    expect(languageIdFor("a/b.c")).toBe("c");
    expect(languageIdFor("a/b.h")).toBe("cpp");
    expect(languageIdFor("Dockerfile")).toBeNull(); // conhecida, mas sem servidor
    expect(languageIdFor("tools/gen", "#!/usr/bin/env python3\n")).toBe("python");
    expect(languageIdFor("tools/gen")).toBeNull();
  });

  it("as extensões VS Code apontam para o servidor que o backend procura (o kotlin-language-server)", () => {
    expect(KNOWN_LANGUAGE_SERVERS["jetbrains.kotlin"]).toEqual({ language: "kotlin", server: "kotlin-language-server" });
    expect(KNOWN_LANGUAGE_SERVERS["fwcd.kotlin"]).toEqual({ language: "kotlin", server: "kotlin-language-server" });
    expect(KNOWN_LANGUAGE_SERVERS["ms-python.python"]).toEqual({ language: "python", server: "pyright-langserver" });
    const commands = new Set(REGISTRY.servers.map((s) => s.command));
    for (const [ext, v] of Object.entries(KNOWN_LANGUAGE_SERVERS)) expect(commands.has(v.server), ext).toBe(true);
    expect(languageOf("h", [])).toBe("cpp");
    expect(languageOf("MJS", [])).toBe("javascript");
  });

  it("o aviso de servidor em falta: nomes e instruções do registo, comando só se for o permitido", () => {
    expect(languageName("cpp")).toBe("C/C++");
    expect(languageName("typescript")).toBe("TypeScript/JavaScript");
    expect(languageName("nada")).toBe("nada");
    const runnable = ["rust-analyzer", "gopls", "typescript-language-server", "pyright", "csharp-ls", "sqls"];
    for (const s of REGISTRY.servers) {
      const n = missingServerNotice({ language: s.id, server: s.label, installed: false })!;
      expect(n.install).toBe(s.install);
      expect(n.command !== null, s.label).toBe(runnable.includes(s.label));
    }
    expect(missingServerNotice({ language: "x", server: "who-knows", installed: false })!.command).toBeNull();
  });
});
