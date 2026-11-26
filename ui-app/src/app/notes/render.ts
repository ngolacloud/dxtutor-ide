/* ═════════ notas para a documentação oficial — gerador ═════════
   Transforma as notas das features (dados) no markdown de `docs/notes/NOTAS.md`. Puro e
   determinista (sem datas do relógio): o mesmo registo dá sempre o mesmo texto, por isso o teste
   pode comparar o ficheiro gravado com o gerado. */

import type { ActionNote, FeatureNotes } from "./types";

const anchor = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");

const list = (xs: string[], ordered = false): string => xs.map((x, i) => `${ordered ? `${i + 1}.` : "-"} ${x}`).join("\n");

function action(a: ActionNote): string {
  const parts = [
    `### ${a.title}`,
    `**Onde:** ${a.where.join(" · ")}`,
    a.what,
    `**Como usar**\n\n${list(a.howTo, true)}`,
    `**Fluxo (por dentro)**\n\n${list(a.flow, true)}`,
  ];
  if (a.tips?.length) parts.push(`**Dicas**\n\n${list(a.tips)}`);
  if (a.limits?.length) parts.push(`**Limites**\n\n${list(a.limits)}`);
  parts.push(`<sub>Cobre: ${a.covers.map((c) => `\`${c}\``).join(", ")}</sub>`);
  return parts.join("\n\n");
}

function feature(f: FeatureNotes): string {
  return [
    `## ${f.title}`,
    f.summary,
    `<sub>Código: ${f.code.map((c) => `\`${c}\``).join(", ")} · revisto em ${f.updated}</sub>`,
    `| Acção | Onde |\n|---|---|\n${f.actions.map((a) => `| [${a.title}](#${anchor(a.title)}) | ${a.where.join(" · ")} |`).join("\n")}`,
    ...f.actions.map(action),
  ].join("\n\n");
}

/** O documento inteiro. `pending`: acções da interface que ainda não têm nota (só encolhe). */
export function renderNotes(features: FeatureNotes[], pending: string[]): string {
  const head = `<!-- GERADO por \`npm run docs:notes\` a partir de \`ui-app/src/features/*/notes.ts\`. Não edites à mão: edita as notas da feature e regenera. -->

# dxtutor IDE — notas para a documentação oficial

Notas de trabalho, acção a acção: o que faz, como usar, o fluxo por dentro, dicas e limites. São a base da documentação oficial do dxtutor-ide e mantêm-se em dia sozinhas: cada feature descreve as suas acções em \`ui-app/src/features/<feature>/notes.ts\`, o teste \`ui-app/tests/notes.docs.test.ts\` falha se uma acção da interface não tiver nota ou se este ficheiro estiver desactualizado, e \`npm run docs:notes\` regenera-o.

## Índice

${features.map((f) => `- [${f.title}](#${anchor(f.title)}) — ${f.actions.length} ${f.actions.length === 1 ? "acção" : "acções"}`).join("\n")}`;
  const tail = pending.length
    ? `## Ainda sem notas\n\nAcções da barra do editor que ainda não têm nota (a lista só encolhe):\n\n${list(pending.map((p) => `\`${p}\``))}`
    : "";
  return [head, ...features.map(feature), tail].filter(Boolean).join("\n\n---\n\n") + "\n";
}
