/* ═════════ dxtutor IDE — estado com dono, publicado no window por acessor (ADR-0004, U3) ═════════
   Durante a migração, o monólito continua a ler e a escrever estas globais por nome
   (`window.MODE = …`, `MODE = …`, `cur = id`). Em vez de as deixar soltas no window, cada
   uma passa a ter um DONO (um módulo de `app/store/`) que guarda o valor e a publica no
   window como acessor (get/set): as escritas antigas passam pelo dono e cada mudança
   emite o seu evento no bus. Os acessores são shims de transição — a U7 do ADR-0004
   remove-os quando os consumidores lerem o dono por import (métrica no ui-metrics). */

const W = window as unknown as Record<string, unknown>;

export interface Owned<T> {
  get(): T;
  set(v: T): void;
}

/**
 * Publica `name` no window como acessor de um valor com dono. Se o window já tinha um
 * valor (uma reavaliação do módulo, ou alguém que escreveu antes), herda-o; senão começa
 * em `initial`. `changed(next, prev)` corre a cada mudança real (valor diferente).
 */
/**
 * O mesmo valor com dono, sem o acessor no window (ADR-0004, U7i): para os estados que já ninguém lê por nome.
 * Cada avaliação começa em `initial` (nos testes, cada `bootApp` reavalia o store: é o reset por teste).
 */
export function ownedValue<T>(initial: T, changed?: (next: T, prev: T) => void): Owned<T> {
  let value = initial;
  const set = (v: T): void => {
    const prev = value;
    value = v;
    if (!Object.is(prev, v)) changed?.(v, prev);
  };
  return { get: () => value, set };
}

export function ownedGlobal<T>(name: string, initial: T, changed?: (next: T, prev: T) => void): Owned<T> {
  const had = Object.prototype.hasOwnProperty.call(W, name);
  let value = (had ? (W[name] as T) : initial) ?? initial;
  const set = (v: T): void => {
    const prev = value;
    value = v;
    if (!Object.is(prev, v)) changed?.(v, prev);
  };
  Object.defineProperty(window, name, {
    configurable: true, // o harness dos testes reavalia os módulos e reinstala
    enumerable: true,
    get: () => value,
    set,
  });
  return { get: () => value, set };
}
