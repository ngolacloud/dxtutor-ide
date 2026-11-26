/* Notas para a documentação oficial do Learning Track. Por agora o selector (linguagens e
   frameworks/ferramentas) e os passos de projecto; o resto do percurso entra quando for
   documentado. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const LEARN_NOTES: FeatureNotes = {
  id: "learn",
  title: "Learning Track",
  summary:
    "Percursos guiados para aprender uma linguagem, um framework ou uma ferramenta: ler o conceito, escrever o programa linha a linha e aplicar num desafio que os testes ocultos avaliam. Os cursos chegam como plugins (`ngolacloud/dxtutor-course-<id>`).",
  code: [
    "ui-app/src/features/learn/domain/catalog.ts",
    "ui-app/src/features/learn/domain/project.ts",
    "ui-app/src/features/learn/application/catalog-service.ts",
    "ui-app/src/features/learn.ts",
    "crates/tutor-core/src/project.rs",
    "src-tauri/src/study.rs",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Escolher o que aprender: linguagens e «Frameworks & tools»",
      where: ["Learning Track › «Choose what to learn»", "o selector que abre quando não há percurso"],
      what: "Mostra as 10 linguagens oficiais e, numa secção à parte, os frameworks e as ferramentas oficiais (Dxjs, Seiva, Django, Delonix Engine, Docker, Podman, Kubernetes, Odoo). Um cartão com curso instalado diz «Available» e abre a escolha do nível; sem curso diz «Coming soon» e fica desactivado.",
      howTo: [
        "Abre o Learning Track e carrega em «Choose what to learn».",
        "Escolhe uma linguagem, ou um cartão da secção «Frameworks & tools».",
        "Escolhe os níveis (Basic, Intermediate, Advanced) e carrega em «Start».",
      ],
      flow: [
        "No desktop, o catálogo pergunta ao backend os plugins instalados (`plugin_list`) e os cursos (`list_courses`, com a categoria e o `subject` de cada um).",
        "Um curso de linguagem carrega-se com `get_course(language)`; um de framework/ferramenta com `get_course(language, subject)`, e o percurso fica com a chave do `subject` (por exemplo `django`).",
        "A linguagem do curso (por exemplo `python` num curso de Django) é a que escreve e avalia os exercícios: dá a extensão dos ficheiros, a indentação e o avaliador.",
        "Os cartões oficiais sem curso não têm progresso nem conteúdo de demonstração; os frameworks de plugins da comunidade com curso entram no fim, como «Community».",
      ],
      tips: [
        "Um framework ou ferramenta instala-se como uma linguagem: em «Course plugins», escreve o id (`django`) para o plugin oficial, ou `owner/repo` para outro.",
        "No primeiro passo, «About» mostra a documentação oficial e o que instalar para praticar.",
      ],
      limits: [
        "No browser só há os cursos embutidos de Rust e Go: os frameworks ficam todos «Coming soon».",
        "Os cursos oficiais de frameworks e ferramentas ainda não existem: chegam em fases próximas.",
      ],
      covers: ["lt-pick", "lt-onboard", "lt-install", "lt-remove"],
    },
    {
      title: "Passo de projecto: vários ficheiros",
      where: ["Learning Track › um desafio com a lista de ficheiros por cima do editor"],
      what: "Um desafio pode ser um pequeno projecto: vários ficheiros (um aberto primeiro, alguns só de leitura) e testes ocultos que correm sobre o projecto inteiro. «Submit» envia todos os ficheiros que podes editar.",
      howTo: [
        "Abre o desafio: o ficheiro principal abre no editor.",
        "Carrega no nome de outro ficheiro, na lista por cima do editor, para o abrir; os marcados «read-only» lêem-se mas não se mudam.",
        "Escreve a solução nos ficheiros que for preciso e carrega em «Submit».",
      ],
      flow: [
        "Cada ficheiro do passo entra no workspace do Learning Track com o conteúdo inicial, uma só vez (o que escreveste fica).",
        "«Submit» chama `submit_step` com `files`: os ficheiros editáveis com o conteúdo actual. Os só de leitura nunca vão.",
        "O backend monta a árvore (`ProjectFiles::learner_tree`): recusa um ficheiro só de leitura ou desconhecido, põe os que faltam como no início e os só de leitura sempre com a cópia do curso.",
        "O avaliador escreve a árvore e os testes ocultos numa pasta nova (caminhos verificados, sem `..`) e corre o comando de projecto do avaliador da linguagem (`project_test_cmd`). Código de saída 0 = passou.",
        "Ao passar, a solução de referência chega em ficheiros, com a explicação; antes disso, nem os testes nem a solução saem do backend.",
      ],
      tips: [
        "Os testes ocultos correm sobre todos os ficheiros: um módulo por fazer faz falhar o passo, mesmo com o principal certo.",
      ],
      limits: [
        "Só na app desktop.",
        "Hoje só o avaliador de Python corre passos de projecto; as outras linguagens dizem que ainda não o suportam.",
        "Não se criam ficheiros novos: o passo traz todos os ficheiros com que se trabalha.",
      ],
      covers: ["lt-file", "learn:go"],
    },
  ],
};
