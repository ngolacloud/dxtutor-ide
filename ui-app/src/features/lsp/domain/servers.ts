/* ═════════ feature `lsp` — os servidores de linguagem vivos (LSP P6) ═════════
   A lista que o backend devolve (`lsp_servers`: pid, raiz, ficheiros abertos, tempo inactivo, memória) e
   as regras PURAS de como se mostra: durações e memória legíveis, o caminho da raiz relativo à pasta aberta,
   o estado e quando um servidor inactivo vai parar. Quem pára e quando decide-o o backend
   (`src-tauri/src/lsp/lifecycle.rs`); aqui só se desenha. */

/** `lifecycle::ServerInfo` (camelCase). */
export interface ServerInfo {
  key: string;
  /** o id do servidor no registo (`rust`) */
  server: string;
  /** o nome por que é conhecido (`rust-analyzer`) */
  label: string;
  root: string;
  project: string | null;
  pid: number | null;
  state: "starting" | "indexing" | "ready";
  /** os ficheiros abertos nele (caminhos absolutos) */
  documents: string[];
  idleSecs: number;
  /** quando pára por estar inactivo (sem ficheiros abertos e com um tempo definido) */
  stopsInSecs: number | null;
  uptimeSecs: number;
  /** memória residente do servidor e do que ele arrancou (KiB; só Linux) */
  memoryKib: number | null;
}

/** `lifecycle::ServersView`. */
export interface ServersView {
  servers: ServerInfo[];
  /** 0: um servidor inactivo nunca pára */
  idleMinutes: number;
  maxServers: number;
}

/** O `lsp://limit`: o tecto não se cumpriu porque todos os servidores que restam têm ficheiros abertos. */
export interface LimitNotice {
  running: number;
  max: number;
  servers: string[];
}

/** Uma duração curta e legível: `45 s`, `3 min`, `2 h 5 min`. */
export function duration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Memória legível: `850 KiB`, `312 MiB`, `1.4 GiB`; `—` quando não se sabe. */
export function memory(kib: number | null): string {
  if (kib == null) return "—";
  if (kib < 1024) return `${kib} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${Math.round(mib)} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}

/** O caminho a mostrar: relativo à pasta aberta (`.` se é ela), o absoluto se está fora dela. */
export function relativeTo(path: string, folder: string | null): string {
  if (!folder) return path;
  const f = folder.replace(/\/+$/, "");
  if (path === f) return ".";
  return path.startsWith(`${f}/`) ? path.slice(f.length + 1) : path;
}

/** Uma linha da lista, já com o texto de cada coluna (a língua vem de `copy`). */
export interface ServerRow {
  key: string;
  label: string;
  root: string;
  pid: string;
  state: ServerInfo["state"];
  documents: number;
  /** os ficheiros (relativos à pasta), para a dica */
  files: string[];
  /** «a uso» com ficheiros abertos; senão há quanto tempo está inactivo e quando pára */
  idle: string;
  memory: string;
}

export type ServerCopy = (key: "inUse" | "idleFor" | "idleStops" | "idleNever", params?: Record<string, string>) => string;

/** As linhas da lista, pela ordem do backend (raiz e nome). */
export function serverRows(view: ServersView, folder: string | null, copy: ServerCopy): ServerRow[] {
  return view.servers.map((s) => {
    const files = s.documents.map((d) => relativeTo(d, folder));
    const idle = files.length
      ? copy("inUse", { n: String(files.length) })
      : s.stopsInSecs != null
        ? copy("idleStops", { idle: duration(s.idleSecs), left: duration(s.stopsInSecs) })
        : view.idleMinutes === 0
          ? copy("idleNever", { idle: duration(s.idleSecs) })
          : copy("idleFor", { idle: duration(s.idleSecs) });
    return {
      key: s.key,
      label: s.label,
      root: relativeTo(s.root, folder),
      pid: s.pid == null ? "—" : String(s.pid),
      state: s.state,
      documents: files.length,
      files,
      idle,
      memory: memory(s.memoryKib),
    };
  });
}

/** A memória de todos juntos (`null` quando nenhum a sabe). */
export function totalMemory(view: ServersView): number | null {
  const known = view.servers.map((s) => s.memoryKib).filter((k): k is number => k != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
