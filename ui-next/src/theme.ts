// Temas do ui-next: CSS vars em style.css comutadas por data-theme no <html>.
// "graphite" é o visual v7 por omissão; "dark" e "light" são overrides completos das vars.
// Persistência em localStorage ("dxnext-theme"); aplicado no arranque ao importar.

export type Theme = "graphite" | "dark" | "light";

export const THEMES: Theme[] = ["graphite", "dark", "light"];

const STORE = "dxnext-theme";

function stored(): Theme {
  try {
    const v = localStorage.getItem(STORE);
    return v === "dark" || v === "light" ? v : "graphite";
  } catch {
    return "graphite";
  }
}

let theme: Theme = stored();

export function getTheme(): Theme {
  return theme;
}

/** Comuta o tema: muda data-theme no <html> (as CSS vars seguem) e persiste. */
export function setTheme(tm: Theme): void {
  theme = tm;
  document.documentElement.dataset.theme = tm;
  try { localStorage.setItem(STORE, tm); } catch { /* storage indisponível */ }
}

// Aplica o tema persistido logo no import (antes do primeiro paint do app).
document.documentElement.dataset.theme = theme;
