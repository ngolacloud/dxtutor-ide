/* ═════════ domínio: comandos de verificação de um projecto real ═════════
   Que comando corre os testes e o lint DESTE projecto. Puro: recebe o mapa
   caminho-relativo → conteúdo (o `DXR.disk` do bridge) e não toca em DOM, Tauri
   nem globais — por isso é testável com `node --test` sem browser.

   Ordem de decisão, da mais explícita para a mais genérica:
     1. `.dxtutor/commands.json`  {"test": "…", "lint": "…"} (override do projecto)
     2. scripts do `package.json` (test / lint|typecheck), com o gestor do lockfile
     3. alvos `test:` / `lint:` de um Makefile
     4. convenção do ecossistema (Cargo, Go, Python, Maven, Gradle, .NET)

   `trusted` distingue a origem para a política de aprovação: um comando escrito
   por extenso num ficheiro do repositório (override, script, Makefile) é texto
   arbitrário do repo e NÃO é auto-aprovado no modo Assistido; as convenções da
   tabela (ex.: `cargo test`) são-no, tal como antes. */

export type VerifyKind = "test" | "lint";

export interface VerifyCommand {
  cmd: string;
  /** De onde veio: "commands.json" | "package.json" | "Makefile" | "Cargo.toml" | … */
  from: string;
  /** Comando da tabela fixa do ecossistema (não texto livre vindo do repositório). */
  trusted: boolean;
}

export type ProjectCommands = Record<VerifyKind, VerifyCommand | null>;

const NPM_PLACEHOLDER = /no test specified/i;

function parseJson(s: string | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function packageManager(files: Record<string, string>): string {
  if ("pnpm-lock.yaml" in files) return "pnpm";
  if ("yarn.lock" in files) return "yarn";
  if ("bun.lockb" in files || "bun.lock" in files) return "bun";
  return "npm";
}

function fromOverride(files: Record<string, string>, kind: VerifyKind): VerifyCommand | null {
  const o = parseJson(files[".dxtutor/commands.json"]);
  const v = o && o[kind];
  return typeof v === "string" && v.trim() ? { cmd: v.trim(), from: "commands.json", trusted: false } : null;
}

function fromPackageJson(files: Record<string, string>, kind: VerifyKind): VerifyCommand | null {
  const pkg = parseJson(files["package.json"]);
  const scripts = pkg && (pkg.scripts as Record<string, unknown> | undefined);
  if (!scripts || typeof scripts !== "object") return null;
  const pm = packageManager(files);
  const has = (k: string) => typeof scripts[k] === "string" && (scripts[k] as string).trim() !== "";
  if (kind === "test") {
    if (has("test") && !NPM_PLACEHOLDER.test(scripts.test as string)) {
      return { cmd: pm === "npm" ? "npm test" : `${pm} test`, from: "package.json", trusted: false };
    }
    return null;
  }
  for (const k of ["lint", "typecheck"]) {
    if (has(k)) return { cmd: `${pm} run ${k}`, from: "package.json", trusted: false };
  }
  return null;
}

function fromMakefile(files: Record<string, string>, kind: VerifyKind): VerifyCommand | null {
  const mk = files["Makefile"] ?? files["makefile"] ?? files["GNUmakefile"];
  if (!mk) return null;
  const target = new RegExp(`^${kind}\\s*:(?!=)`, "m");
  return target.test(mk) ? { cmd: `make ${kind}`, from: "Makefile", trusted: false } : null;
}

function fromEcosystem(files: Record<string, string>, kind: VerifyKind): VerifyCommand | null {
  const has = (p: string) => p in files;
  const t = (cmd: string, from: string): VerifyCommand => ({ cmd, from, trusted: true });
  if (has("Cargo.toml"))
    return kind === "test" ? t("cargo test", "Cargo.toml") : t("cargo clippy --all-targets", "Cargo.toml");
  if (has("go.mod")) return kind === "test" ? t("go test ./...", "go.mod") : t("go vet ./...", "go.mod");
  const py = ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini", "tox.ini"].find(has);
  if (py) {
    if (kind === "test") return t("python -m pytest -q", py);
    const pp = files["pyproject.toml"] || "";
    return /\[tool\.ruff/.test(pp) || has("ruff.toml") || has(".ruff.toml")
      ? t("ruff check .", "pyproject.toml")
      : null;
  }
  if (has("pom.xml")) return kind === "test" ? t("mvn -q test", "pom.xml") : null;
  if (has("gradlew")) return kind === "test" ? t("./gradlew test", "gradlew") : null;
  const dotnet = Object.keys(files).find((p) => !p.includes("/") && /\.(sln|csproj|fsproj)$/.test(p));
  if (dotnet) return kind === "test" ? t("dotnet test", dotnet) : null;
  return null;
}

/** Os comandos de teste e lint do projecto cujos ficheiros (caminhos relativos à raiz) são `files`. */
export function detectCommands(files: Record<string, string>): ProjectCommands {
  const pick = (kind: VerifyKind): VerifyCommand | null =>
    fromOverride(files, kind) ??
    fromPackageJson(files, kind) ??
    fromMakefile(files, kind) ??
    fromEcosystem(files, kind);
  return { test: pick("test"), lint: pick("lint") };
}

/** Uma linha de resumo da saída de um comando de verificação (para o cartão e o log). */
export function summarizeRun(code: number | null, timedOut: boolean, stdout: string, stderr: string): string {
  if (timedOut) return "excedeu o tempo limite";
  const lines = (stdout + "\n" + stderr)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const KEY =
    /(test result:|tests? (passed|failed)|\d+ (passed|failed)|^ok\b|^FAIL\b|^PASS\b|error(\[E\d+\])?:|warning: .* generated|problems?\b)/i;
  const hit = [...lines].reverse().find((l) => KEY.test(l)) || lines[lines.length - 1] || "";
  const head = code === 0 ? "✓ exit 0" : `✖ exit ${code ?? "?"}`;
  return hit ? `${head} · ${hit.slice(0, 140)}` : head;
}
