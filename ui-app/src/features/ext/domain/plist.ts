/* ═══════════ feature `ext` — property lists em XML (LSP P4) ═══════════
   Muitas extensões VS Code (sobretudo as que vêm do TextMate e do Sublime) trazem a gramática como
   um `.tmLanguage`: uma property list da Apple em XML, não JSON. Aqui um leitor pequeno e exacto do
   formato (`<plist>` com `dict`, `array`, `string`, `key`, `integer`, `real`, `true`, `false`,
   `date` e `data`): o texto de cada `<string>` fica TAL COMO ESTÁ (espaços e mudanças de linha
   contam numa regex `(?x)`), com as entidades XML (`&lt;`, `&#x41;`…) e as secções CDATA resolvidas;
   a declaração XML, o DOCTYPE e os comentários saltam-se. Um documento mal formado dá um erro com o
   sítio. Sem DOMParser (o domínio não tem DOM). PURO. */

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

/** Lê uma property list XML; lança `Error` se não for uma. */
export function parsePlist(text: string): PlistValue {
  const p = new Reader(text);
  p.skipMisc();
  const root = p.open();
  if (root.name !== "plist") {
    // aceita-se um valor solto (há gramáticas sem o `<plist>` à volta)
    const v = p.value(root);
    p.skipMisc();
    p.end();
    return v;
  }
  if (root.selfClosing) throw p.error("empty <plist>");
  p.skipMisc();
  const v = p.value(p.open());
  p.skipMisc();
  p.close("plist");
  p.skipMisc();
  p.end();
  return v;
}

/** É um documento XML (e não JSON)? Pelo primeiro carácter que não é espaço (ou um BOM). */
export const looksLikeXml = (text: string): boolean => /^\uFEFF?\s*</.test(text);

interface Tag {
  name: string;
  selfClosing: boolean;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

class Reader {
  private i = 0;
  constructor(private readonly s: string) {
    if (s.charCodeAt(0) === 0xfeff) this.i = 1;
  }

  error(msg: string): Error {
    const before = this.s.slice(0, this.i);
    const line = before.split("\n").length;
    return new Error(`plist: ${msg} (line ${line})`);
  }

  /** Espaços, a declaração `<?xml …?>`, o `<!DOCTYPE …>` e os comentários. */
  skipMisc(): void {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith("<?", this.i)) this.skipPast("?>");
      else if (this.s.startsWith("<!--", this.i)) this.skipPast("-->");
      else if (this.s.startsWith("<!DOCTYPE", this.i)) this.skipDoctype();
      else return;
    }
  }

  private skipPast(end: string): void {
    const at = this.s.indexOf(end, this.i);
    if (at < 0) throw this.error(`missing ${end}`);
    this.i = at + end.length;
  }

  /** O DOCTYPE pode ter um subconjunto interno `[ … ]`. */
  private skipDoctype(): void {
    let depth = 0;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (c === ">" && depth <= 0) {
        this.i++;
        return;
      }
    }
    throw this.error("unterminated DOCTYPE");
  }

  end(): void {
    if (this.i < this.s.length) throw this.error("text after the document");
  }

  /** Uma etiqueta de abertura `<nome …>` ou `<nome/>` (os atributos ignoram-se). */
  open(): Tag {
    if (this.s[this.i] !== "<" || this.s[this.i + 1] === "/") throw this.error("expected an element");
    const m = /^<([A-Za-z_][\w.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(this.s.slice(this.i, this.i + 512));
    if (!m) throw this.error("malformed tag");
    this.i += m[0].length;
    return { name: m[1], selfClosing: m[3] === "/" };
  }

  close(name: string): void {
    const m = /^<\/([A-Za-z_][\w.-]*)\s*>/.exec(this.s.slice(this.i, this.i + 256));
    if (!m || m[1] !== name) throw this.error(`expected </${name}>`);
    this.i += m[0].length;
  }

  /** O texto até à próxima etiqueta, com entidades e CDATA resolvidos (comentários saltam-se). */
  private text(): string {
    let out = "";
    for (;;) {
      const lt = this.s.indexOf("<", this.i);
      if (lt < 0) throw this.error("unexpected end of the document");
      out += decode(this.s.slice(this.i, lt), (m) => this.error(m));
      this.i = lt;
      if (this.s.startsWith("<![CDATA[", this.i)) {
        const at = this.s.indexOf("]]>", this.i);
        if (at < 0) throw this.error("unterminated CDATA");
        out += this.s.slice(this.i + 9, at);
        this.i = at + 3;
      } else if (this.s.startsWith("<!--", this.i)) {
        this.skipPast("-->");
      } else return out;
    }
  }

  /** O valor de um elemento cuja etiqueta de abertura já se leu. */
  value(tag: Tag): PlistValue {
    const { name, selfClosing } = tag;
    switch (name) {
      case "true":
      case "false":
        if (!selfClosing) {
          this.skipMisc();
          this.close(name);
        }
        return name === "true";
      case "string":
      case "date":
      case "data": {
        if (selfClosing) return "";
        const t = this.text();
        this.close(name);
        return name === "data" ? t.replace(/\s+/g, "") : t;
      }
      case "integer":
      case "real": {
        const t = selfClosing ? "" : this.text().trim();
        if (!selfClosing) this.close(name);
        const n = Number(t);
        if (t === "" || Number.isNaN(n)) throw this.error(`<${name}> is not a number: ${t}`);
        return n;
      }
      case "array": {
        const out: PlistValue[] = [];
        if (selfClosing) return out;
        for (;;) {
          this.skipMisc();
          if (this.s.startsWith("</", this.i)) break;
          out.push(this.value(this.open()));
        }
        this.close("array");
        return out;
      }
      case "dict": {
        const out: { [key: string]: PlistValue } = {};
        if (selfClosing) return out;
        for (;;) {
          this.skipMisc();
          if (this.s.startsWith("</", this.i)) break;
          const k = this.open();
          if (k.name !== "key") throw this.error(`expected <key> in <dict>, got <${k.name}>`);
          const key = k.selfClosing ? "" : this.text();
          if (!k.selfClosing) this.close("key");
          this.skipMisc();
          if (this.s.startsWith("</", this.i)) throw this.error(`<key>${key}</key> without a value`);
          out[key] = this.value(this.open());
        }
        this.close("dict");
        return out;
      }
      default:
        throw this.error(`unknown element <${name}>`);
    }
  }
}

function decode(raw: string, error: (m: string) => Error): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw error(`bad character reference &${e};`);
      return String.fromCodePoint(code);
    }
    const v = ENTITIES[e];
    if (v === undefined) throw error(`unknown entity &${e};`);
    return v;
  });
}
