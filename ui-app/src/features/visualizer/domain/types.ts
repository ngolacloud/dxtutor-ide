/* ═══════════ feature `visualizer` — tipos de domínio (ADR-0002, Fase 2) ═══════════
   Formas PURAS do pipeline de compilador do subconjunto de Rust: tokens do lexer,
   nós do AST, hipóteses de tipo, eventos/passos do interpretador, notas da narração
   e o catálogo de exemplos. Sem DOM, sem `window`, sem Tauri — só dados.

   O AST é polimórfico (um `k` discrimina ~30 formas de nó). `VzNode` reúne-as num
   único tipo de campos opcionais: o lexer/parser/hints tipam-se contra ele; o
   interpretador (`vzRun`, @ts-nocheck) consome-o livremente. Os objectos-valor do
   interpretador (`{t,v,ty}`) ficam opacos aqui (vivem no ficheiro @ts-nocheck). */

/** Um token do lexer. `v` é o número (k=num), o texto (id/str/char) ou o operador
 *  (op); `suf`/`f` só existem em literais numéricos. */
export interface Token {
  k: "num" | "id" | "str" | "char" | "op" | "eof";
  v?: number | string;
  suf?: string | null;
  f?: boolean | null;
  line: number;
}

/** Um nó do AST. União achatada por campos opcionais, discriminada por `k`
 *  (int/float/bool/charlit/strlit/unit/arr/arrrep/vec/vecrep/mac/path/var/un/ref/
 *  deref/bin/assign/range/cast/if/block/call/mcall/idx/let/while/for/loop/ret/brk/
 *  cont/expr/empty). `tail` é um nó (cauda de bloco) OU o marcador `true` que `stmt`
 *  devolve para a cauda sem `;`. */
export interface VzNode {
  k?: string;
  line?: number;
  v?: number | string | boolean;
  suf?: string | null;
  name?: string;
  mut?: boolean;
  ty?: string | null;
  init?: VzNode | null;
  cond?: VzNode;
  body?: VzNode;
  it?: VzNode;
  e?: VzNode | null;
  op?: string;
  tg?: VzNode;
  a?: VzNode;
  b?: VzNode;
  incl?: boolean;
  fn?: string;
  args?: VzNode[];
  obj?: VzNode;
  m?: string;
  i?: VzNode;
  items?: VzNode[];
  n?: VzNode;
  parts?: string[];
  c?: VzNode;
  th?: VzNode;
  el?: VzNode | null;
  stmts?: VzNode[];
  tail?: VzNode | boolean | null;
  end?: number;
}

/** Um parâmetro de função: nome, mutabilidade e tipo escrito. */
export interface FnParam { name: string; mut: boolean; ty: string }

/** Uma função do programa: assinatura + corpo (bloco). */
export interface FnDef {
  name: string;
  params: FnParam[];
  ret: string | null;
  body: VzNode;
  line: number;
}

/** O AST de um programa: as suas funções, indexadas por nome. */
export interface Ast { fns: Record<string, FnDef> }

/** Uma hipótese de tipo inferida por uso (`t`: tipo escalar; `el`: tipo do elemento
 *  de um slice/Vec). */
export interface Hint { t?: string; el?: string }
/** Hipóteses por função → por variável. */
export type Hints = Record<string, Record<string, Hint>>;

/** Um evento do interpretador (o que aconteceu num passo). União achatada: `k`
 *  discrimina (start/bind/alloc/noalloc/grow/free/dropnoop/move/copyarr/borrow/
 *  call/ret/bounds/ovf/set/iter/consume/cond/push/pushstr/clone/format/print/cast/
 *  sum/scope/panic/unwind/comp/exit/assert); os restantes campos são os dados que
 *  a narração (`vzTell`) lê. Campos opcionais explícitos (sem `any`); o interpretador
 *  (@ts-nocheck) produz-os livremente. */
export interface VzEvent {
  k: string;
  name?: string;
  val?: string | number;
  v?: number | string | boolean;
  ty?: string;
  size?: number;
  kind?: string;
  ro?: { addr: number } | null;
  addr?: number;
  bytes?: number;
  what?: string;
  cap?: number;
  label?: string;
  old?: number;
  nc?: number;
  to?: number | string;
  from?: number | string;
  copied?: number;
  es?: number;
  unw?: number;
  loop?: number;
  as?: string;
  mut?: boolean;
  fat?: boolean;
  fn?: string;
  args?: Array<{ name: string; mem?: boolean; regs?: string[] }>;
  depth?: number;
  reg?: string | null;
  i?: number;
  len?: number;
  ok?: boolean;
  op?: string;
  via?: boolean;
  src?: string;
  n?: number;
  add?: string;
  est?: number;
  wrapped?: boolean;
  sat?: boolean;
  r?: number;
  names?: string[];
  so?: number;
  msg?: string;
  code?: string;
  hint?: string;
  nl?: boolean;
  err?: boolean;
}

/** Uma nota da narração: título (`t`), detalhe de máquina (`m`), insight (`i`:
 *  [chave-de-dedup, html]) e o `k` do evento que a originou. */
export interface VzNote {
  t?: string;
  m?: string | null;
  i?: [string, string] | null;
  k?: string;
}

/** Um passo do traço: linha, eventos, saída acumulada e um retrato das frames/heap.
 *  O conteúdo detalhado (frames/heap/ro) é produzido pelo interpretador @ts-nocheck;
 *  aqui ficam os campos que o overlay e a narração consomem. */
export interface VzStep {
  line: number;
  ev: VzEvent[];
  out: string;
  err: string;
  cnt: Record<string, number>;
  extra: { retFrom?: string } | null;
  frames: unknown[];
  heap: unknown[];
  ro: unknown[];
}

/** O desfecho do programa: terminou bem, estourou (panic), não compila (comp) ou
 *  foi parado ao limite de passos. */
export interface VzEnd {
  ok?: boolean;
  panic?: string;
  comp?: string;
  msg?: string;
  line?: number;
  hint?: string;
  limit?: boolean;
}

/** O resultado completo de uma corrida: passos, desfecho, stdout e stderr. */
export interface VzRunResult {
  steps: VzStep[];
  end: VzEnd | null;
  out: string;
  err: string;
}

/** Um exemplo do catálogo: `[título, fonte]`. */
export type Sample = [string, string];
/** O catálogo de exemplos, indexado por chave curta (sum/grow/own/…). */
export type SampleCatalog = Record<string, Sample>;
