/* ═════════ dxtutor IDE — os hosts do `~/.ssh/config` (ADR-0006, R6c) ═════════
   Regra PURA: lê o texto de um `ssh_config` e devolve os hosts concretos (os nomes de `Host`
   sem padrões `*`/`?`/`!`) com o HostName, o User, o Port e a IdentityFile que o bloco lhes dá.
   Os blocos `Match` ignoram-se; as linhas `Include` não se seguem (devolvem-se para a vista o
   dizer). Sem DOM nem `window`: recebe o texto por argumento. */

export interface SshHost {
  /** O nome por que se chama o `ssh` (`ssh <name>`). */
  name: string;
  hostname?: string;
  user?: string;
  port?: string;
  identityFile?: string;
}

export interface SshConfig {
  hosts: SshHost[];
  /** Os ficheiros de `Include` (não lidos). */
  includes: string[];
}

const PATTERN = /[*?!]/;

/** Os hosts concretos de um `ssh_config`, pela ordem em que aparecem (sem repetir nomes: o
 *  primeiro valor de cada opção ganha, como no OpenSSH). */
export function parseSshConfig(text: string): SshConfig {
  const hosts: SshHost[] = [], includes: string[] = [];
  let cur: SshHost[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^(\S+?)\s*(?:=\s*|\s+)(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim().replace(/^"(.*)"$/, "$1");
    if (key === "host") {
      cur = val.split(/\s+/).filter((n) => n && !PATTERN.test(n)).map((name) => {
        let h = hosts.find((x) => x.name === name);
        if (!h) { h = { name }; hosts.push(h); }
        return h;
      });
    } else if (key === "match") cur = [];
    else if (key === "include") includes.push(...val.split(/\s+/));
    else {
      const field = ({ hostname: "hostname", user: "user", port: "port", identityfile: "identityFile" } as const)[key as "hostname" | "user" | "port" | "identityfile"];
      if (field) cur.forEach((h) => { if (h[field] === undefined) h[field] = val; });
    }
  }
  return { hosts, includes };
}

/** O que se mostra ao lado do nome: `user@hostname:port` (só o que o bloco define). */
export function sshTarget(h: SshHost): string {
  return `${h.user ? h.user + "@" : ""}${h.hostname || h.name}${h.port && h.port !== "22" ? ":" + h.port : ""}`;
}
