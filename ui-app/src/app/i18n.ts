/* ═════════ textos por chave (ADR-0004, U6b) ═════════
   Cada feature tem o seu catálogo tipado (en + ptAO) e um `t` feito com `translator(catálogo)`: `t("chave")`
   devolve o texto na língua actual (`LOCALE`, que o motor de tradução de features/i18n.ts guarda), com
   `{nome}` substituído pelos parâmetros. Convive com o motor durante a transição: o texto já sai na língua
   certa, e o motor não tem nada para trocar (não há par para o traduzido). Os catálogos nascem do motor — os
   valores são os que ele produzia — e o teste tests/i18n.catalogs.test.ts confirma cada entrada contra os
   pares dele; os goldens (normalizados para inglês) provam o inglês de cada chave no markup.
   Os parâmetros entram tal e qual: quem os passa escapa-os (`esc`) se forem para HTML. */
export type LocaleId = "en" | "ptAO";
export type Messages<K extends string> = Record<LocaleId, Record<K, string>>;

/** A língua actual da interface (o motor de tradução é o dono do `LOCALE`; nasce `en`). */
export const currentLocale = (): LocaleId => ((window as unknown as { LOCALE?: string }).LOCALE === "ptAO" ? "ptAO" : "en");

/** O `t` de um catálogo: chaves tipadas, texto na língua actual (cai no inglês se faltar), `{nome}` → parâmetro. */
export function translator<K extends string>(m: Messages<K>): (key: K, params?: Record<string, string | number>) => string {
  return (key, params) => {
    const s = m[currentLocale()][key] ?? m.en[key];
    return params ? s.replace(/\{(\w+)\}/g, (all, n: string) => (n in params ? String(params[n]) : all)) : s;
  };
}
