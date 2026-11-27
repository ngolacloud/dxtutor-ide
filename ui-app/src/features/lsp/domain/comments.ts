/* ═════════ feature `lsp` — comentários de bloco sem servidor (LSP P5) ═════════
   O `blockComment` do registo de linguagens (o par barra-asterisco do C, `["<!--", "-->"]`…), ou o de uma extensão
   instalada, aplicado ao texto da textarea:
     • `toggleBlockComment` — o Toggle Block Comment (Ctrl+Shift+A): envolve a selecção, ou tira o
       comentário que a envolve (como o `BlockCommentCommand` do VS Code: procura o marcador de abertura
       para trás na linha onde a selecção começa e o de fecho para a frente na linha onde acaba);
     • `toggleLinesWithBlock` — o Ctrl+/ de uma linguagem SEM comentário de linha (HTML, CSS, Markdown):
       comenta as linhas inteiras da selecção com um só bloco, ou tira o bloco que lá está.
   Um espaço separa o marcador do texto (e sai com ele). Quando o texto entre os marcadores encontrados já
   tem um fecho, são dois comentários diferentes: acrescenta-se um novo à volta (como no VS Code; nas
   linguagens sem comentários aninhados, C ou CSS, o resultado não compila — é o que o humano pediu).
   PURO. */

export type CommentPair = readonly [string, string];

export interface CommentEdit {
  text: string;
  selStart: number;
  selEnd: number;
}

interface Line {
  start: number;
  end: number;
  text: string;
}

function lineAt(text: string, offset: number): Line {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const nl = text.indexOf("\n", offset);
  const end = nl < 0 ? text.length : nl;
  return { start, end, text: text.slice(start, end) };
}

/** Os marcadores encontrados (índices absolutos), já com o espaço interior que sai com eles. */
interface Found {
  /** onde começa o marcador de abertura */
  open: number;
  /** onde começa o texto comentado (depois da abertura e do espaço) */
  inner: number;
  /** onde começa o fecho (com o espaço antes dele) */
  close: number;
  /** onde acaba o fecho */
  end: number;
}

function found(text: string, openAt: number, closeAt: number, [open, close]: CommentPair): Found | null {
  if (openAt < 0 || closeAt < 0 || openAt + open.length > closeAt) return null;
  let inner = openAt + open.length;
  let closeStart = closeAt;
  if (text[inner] === " " && inner < closeStart) inner++;
  if (text[closeStart - 1] === " " && closeStart - 1 >= inner) closeStart--;
  return { open: openAt, inner, close: closeStart, end: closeAt + close.length };
}

/** Tira os marcadores; a selecção acompanha o texto (o que estava dentro de um marcador fica no sítio dele). */
function remove(text: string, f: Found, selStart: number, selEnd: number): CommentEdit {
  const out = text.slice(0, f.open) + text.slice(f.inner, f.close) + text.slice(f.end);
  const map = (o: number): number => {
    if (o <= f.open) return o;
    if (o <= f.inner) return f.open;
    if (o <= f.close) return o - (f.inner - f.open);
    if (o <= f.end) return f.close - (f.inner - f.open);
    return o - (f.inner - f.open) - (f.end - f.close);
  };
  return { text: out, selStart: map(selStart), selEnd: map(selEnd) };
}

/** Insere a abertura em `at` e o fecho em `to`; a selecção acompanha o texto (fica antes do fecho). */
function wrap(text: string, at: number, to: number, [open, close]: CommentPair, selStart: number, selEnd: number): CommentEdit {
  if (at === to) {
    const out = text.slice(0, at) + open + "  " + close + text.slice(at);
    const caret = at + open.length + 1;
    return { text: out, selStart: caret, selEnd: caret };
  }
  const head = open + " ", tail = " " + close;
  const out = text.slice(0, at) + head + text.slice(at, to) + tail + text.slice(to);
  const map = (o: number): number => (o < at ? o : o <= to ? o + head.length : o + head.length + tail.length);
  return { text: out, selStart: map(selStart), selEnd: map(selEnd) };
}

/** Toggle Block Comment (Ctrl+Shift+A) na selecção `[selStart, selEnd)`. Sem selecção, e fora de um
 *  comentário, insere um comentário vazio com o cursor no meio. */
export function toggleBlockComment(text: string, selStart: number, selEnd: number, pair: CommentPair): CommentEdit {
  const [open, close] = pair;
  const s = Math.min(selStart, selEnd), e = Math.max(selStart, selEnd);
  const first = lineAt(text, s), last = lineAt(text, e);
  // a abertura pode começar até ao fim do seu tamanho depois do início da selecção; o fecho, até ao seu
  // tamanho antes do fim (seleccionar `/* x */` inteiro conta como estar dentro)
  const openIdx = first.text.lastIndexOf(open, s - first.start + open.length);
  const closeIdx = last.text.indexOf(close, Math.max(0, e - last.start - close.length));
  let f: Found | null = null;
  if (openIdx >= 0 && closeIdx >= 0) {
    const openAt = first.start + openIdx, closeAt = last.start + closeIdx;
    const between = text.slice(openAt + open.length, closeAt);
    // já fechado pelo meio: são dois comentários, não um
    const twoComments = first.start === last.start ? between.includes(close) : first.text.slice(openIdx + open.length).includes(close) || last.text.slice(0, closeIdx).includes(close);
    if (!twoComments) f = found(text, openAt, closeAt, pair);
  }
  if (f) return remove(text, f, selStart, selEnd);
  return wrap(text, s, e, pair, s, e);
}

/** Ctrl+/ numa linguagem sem comentário de linha: um bloco à volta das linhas da selecção (do primeiro
 *  carácter que não é espaço ao fim da última linha), ou tira o bloco que lá está. Uma selecção que acaba
 *  no início de uma linha não inclui essa linha. */
export function toggleLinesWithBlock(text: string, selStart: number, selEnd: number, pair: CommentPair): CommentEdit {
  const [open, close] = pair;
  const s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  if (e > s && text[e - 1] === "\n") e--;
  const first = lineAt(text, s);
  let last = lineAt(text, e);
  const empty = s === e;
  const lead = (l: Line): number => {
    const i = l.text.search(/\S/);
    return i < 0 ? l.text.length : i;
  };
  // a abertura pode estar antes do cursor ou começar logo a seguir; o fecho, depois do fim
  let openIdx = first.text.lastIndexOf(open, Math.max(lead(first), s - first.start) + open.length);
  let closeIdx = last.text.indexOf(close, Math.max(0, e - last.start - close.length));
  let openLine = first;
  if (openIdx >= 0 && closeIdx < 0) {
    closeIdx = first.text.indexOf(close, openIdx + open.length);
    last = first;
  } else if (openIdx < 0 && closeIdx >= 0) {
    openIdx = last.text.lastIndexOf(open, closeIdx);
    openLine = last;
  }
  if (empty && (openIdx < 0 || closeIdx < 0)) {
    // sem selecção: o primeiro comentário da linha, onde quer que esteja o cursor
    openIdx = first.text.indexOf(open);
    closeIdx = openIdx >= 0 ? first.text.indexOf(close, openIdx + open.length) : -1;
    openLine = last = first;
  }
  const f = openIdx >= 0 && closeIdx >= 0 ? found(text, openLine.start + openIdx, last.start + closeIdx, pair) : null;
  if (f) return remove(text, f, selStart, selEnd);
  const endLine = lineAt(text, e);
  return wrap(text, first.start + lead(first), empty ? first.end : endLine.end, pair, selStart, selEnd);
}
