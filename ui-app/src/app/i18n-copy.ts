/* ═════════ a porta `copy` sem língua escolhida (i18n dos motores) ═════════
   Os motores (`application/`) recebem os textos por uma porta `copy(chave, parâmetros)` que a composição
   faz com `translator(CATÁLOGO)` (app/i18n.ts, que lê o `LOCALE` do window). Quando um motor é construído
   sem ela (os fakes dos testes antigos), usa `fixedCopy(CATÁLOGO.ptAO)`: os textos de antes, em português.
   Puro: sem window, para os motores o poderem importar. */

/** O `copy` de uma língua fixa de um catálogo: chave → texto, com `{nome}` substituído pelos parâmetros. */
export function fixedCopy<K extends string>(table: Record<K, string>): (key: K, params?: Record<string, string | number>) => string {
  return (key, params) => {
    const s = table[key];
    return params ? s.replace(/\{(\w+)\}/g, (all, n: string) => (n in params ? String(params[n]) : all)) : s;
  };
}
