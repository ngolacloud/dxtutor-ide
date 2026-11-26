/* Textos que o caso de uso do painel de documento escreve (o resumo local do Explain sem modelo).
   Texto NOVO (sem par no motor de tradução): o teste do catálogo verifica-lhe só a estrutura.
   O motor recebe-os pela porta `copy` — não importa o `translator` (lê o `window`). */
export const DOC_COPY = {
  en: {
    summary: "Summary",
    lines: "{n} lines",
    defines: "defines {list}",
    rightNow: "Right now",
    watch: "What to watch",
    noModel: "This is a summary from the code itself. Connect a model in Settings (Claude, OpenAI, Gemini or Ollama) and Explain writes the full document: how it works, the key pieces, the risks and suggestions.",
    stopped: "Stopped.",
  },
  ptAO: {
    summary: "Resumo",
    lines: "{n} linhas",
    defines: "define {list}",
    rightNow: "Neste momento",
    watch: "A que ter atenção",
    noModel: "Este é um resumo tirado do próprio código. Liga um modelo nas Definições (Claude, OpenAI, Gemini ou Ollama) e o Explain escreve o documento completo: como funciona, as peças principais, os riscos e as sugestões.",
    stopped: "Parado.",
  },
} as const;

export type DocCopyKey = keyof typeof DOC_COPY.en;
