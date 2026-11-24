/* ═════════ dxtutor IDE — os comandos de um projecto (ADR-0006, R2d) ═════════
   Regra PURA: dado o tipo de um projecto detectado (`detect_projects`) e os ficheiros que tem,
   os comandos habituais do ecossistema para o correr, compilar e testar — os do Node vêm dos
   `scripts` reais do package.json, com o gestor de pacotes do lockfile. Sem DOM nem `window`:
   recebe o mundo por argumento. Um tipo sem comandos conhecidos devolve lista vazia (a vista
   di-lo em vez de inventar). */

export interface ProjectCommand {
  cmd: string;
  label: string;
}

/** O que a regra precisa de saber sobre a pasta do projecto. */
export interface ProjectFiles {
  /** O ficheiro (relativo à pasta do projecto) existe? */
  has(file: string): boolean;
  /** O conteúdo de um ficheiro de texto (relativo), ou null. */
  read(file: string): string | null;
}

/** O gestor de pacotes do Node pelo lockfile (npm por omissão). */
export function nodePm(f: ProjectFiles): string {
  if (f.has("pnpm-lock.yaml")) return "pnpm";
  if (f.has("yarn.lock")) return "yarn";
  if (f.has("bun.lockb") || f.has("bun.lock")) return "bun";
  return "npm";
}

export function commandsFor(kind: string, f: ProjectFiles): ProjectCommand[] {
  switch (kind) {
    case "rust":
      return [{ cmd: "cargo run", label: "Correr" }, { cmd: "cargo build", label: "Compilar" }, { cmd: "cargo test", label: "Testes" }];
    case "go":
      return [{ cmd: "go run .", label: "Correr" }, { cmd: "go build ./...", label: "Compilar" }, { cmd: "go test ./...", label: "Testes" }];
    case "node": {
      const pm = nodePm(f);
      let scripts: Record<string, unknown> = {};
      try { scripts = (JSON.parse(f.read("package.json") || "{}").scripts || {}) as Record<string, unknown>; } catch { scripts = {}; }
      const names = Object.keys(scripts).filter((k) => typeof scripts[k] === "string");
      if (!names.length) return [{ cmd: `${pm} install`, label: "Instalar dependências (o package.json não tem scripts)" }];
      return names.map((k) => ({ cmd: `${pm} run ${k}`, label: String(scripts[k]) }));
    }
    case "python": {
      const out: ProjectCommand[] = [];
      if (f.has("manage.py")) out.push({ cmd: "python3 manage.py runserver", label: "Servidor Django" });
      if (f.has("main.py")) out.push({ cmd: "python3 main.py", label: "Correr main.py" });
      out.push({ cmd: "python3 -m pytest", label: "Testes (pytest)" }, { cmd: "python3 -m unittest discover -v", label: "Testes (unittest)" });
      return out;
    }
    case "java":
      if (f.has("pom.xml")) return [{ cmd: "mvn -q package", label: "Compilar" }, { cmd: "mvn -q test", label: "Testes" }];
      return f.has("gradlew")
        ? [{ cmd: "./gradlew build", label: "Compilar" }, { cmd: "./gradlew test", label: "Testes" }]
        : [{ cmd: "gradle build", label: "Compilar" }, { cmd: "gradle test", label: "Testes" }];
    case "php":
      return [{ cmd: "composer install", label: "Instalar dependências" }];
    case "ruby":
      return f.has("Rakefile")
        ? [{ cmd: "bundle install", label: "Instalar dependências" }, { cmd: "bundle exec rake", label: "Rake" }]
        : [{ cmd: "bundle install", label: "Instalar dependências" }];
    default:
      return [];
  }
}
