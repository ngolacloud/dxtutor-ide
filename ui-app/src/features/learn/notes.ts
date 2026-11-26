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
    "crates/tutor-core/src/support.rs",
    "crates/tutor-core/src/build.rs",
    "crates/tutor-eval/src/course_cache.rs",
    "ui-app/src/features/learn/application/prepare-service.ts",
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
        "Dos frameworks e ferramentas oficiais, o Dxjs e o Seiva têm curso (embutidos na app); os outros chegam em fases próximas.",
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
        "Hoje os avaliadores de Python (`unittest`), de TypeScript (`node --test`) e de Rust (`cargo test`, um crate ou um workspace) correm passos de projecto; as outras linguagens dizem que ainda não o suportam.",
        "Não se criam ficheiros novos: o passo traz todos os ficheiros com que se trabalha.",
      ],
      covers: ["lt-file", "learn:go"],
    },
    {
      title: "O curso Dxjs: da primeira signal a uma pequena app",
      where: ["Learning Track › «Choose what to learn» › «Frameworks & tools» › Dxjs"],
      what: "O curso oficial do dxjs, o motor de interfaces reactivas da NgolaCloud: 12 unidades, das signals, computeds e effects ao `@dxjs/query`, ao `@dxjs/forms`, aos templates `html`, aos componentes e a uma app de tarefas. Os exercícios escrevem-se em TypeScript e correm contra o dxjs 1.2.0 verdadeiro.",
      howTo: [
        "Escolhe o cartão Dxjs na secção «Frameworks & tools» e os níveis que queres.",
        "Lê o texto de conceitos de cada unidade, escreve os drills linha a linha e resolve os desafios; quatro deles são projectos de vários ficheiros.",
        "Escreve `import { signal } from \"@dxjs/core\"` como num projecto real: o curso traz a biblioteca.",
      ],
      flow: [
        "O curso vem embutido no backend (`courses/dxjs/`, `include_str!`), na categoria `framework`, avaliado pelo descritor de TypeScript (Node com remoção de tipos).",
        "O dxjs não está no npm: o curso declara ficheiros de apoio (`[support]`), só de leitura — o bundle `cdn/dxjs.js` da versão 1.2.0, um módulo por pacote `@dxjs/*` e um DOM para o Node (happy-dom) — que o avaliador escreve ao lado dos ficheiros de cada passo. A avaliação corre sem rede.",
        "Um ficheiro de apoio nunca substitui um ficheiro do passo, nem o contrário; os ficheiros de apoio nunca vão para a interface.",
      ],
      tips: [
        "Precisa do Node.js 22.18 ou mais recente (também o encontrado pelo nvm, Volta ou fnm).",
        "No primeiro passo, «About» leva à documentação oficial, em ngolacloud.github.io/dxjs.",
      ],
      limits: [
        "Só na app desktop; no browser o cartão fica «Coming soon».",
        "No dxjs 1.2.0, uma ligação reactiva dentro de uma linha de `list` deixa de actualizar depois da primeira mudança da lista: o curso ensina a pôr na chave o que muda na linha.",
      ],
      covers: ["lt-pick", "submit_step"],
    },
    {
      title: "Preparar um curso (Seiva): descarregar as bibliotecas uma vez",
      where: ["Learning Track › um passo do curso Seiva › cartão «Prepare this course»"],
      what: "Um curso que compila contra bibliotecas de fora (o Seiva 0.2.0, o tokio, o axum) avalia-se sempre sem rede. Antes da primeira avaliação, «Prepare course» descarrega essas bibliotecas uma vez para uma cache deste curso e compila-as; depois, cada passo compila offline em poucos segundos.",
      howTo: [
        "Abre um passo do curso Seiva: enquanto o curso não está preparado, aparece o cartão «Prepare this course».",
        "Carrega em «Prepare course» e lê, no diálogo, os comandos exactos e a pasta onde correm.",
        "Aprova: a preparação demora cerca de um minuto; no fim o cartão desaparece e «Submit» já avalia.",
      ],
      flow: [
        "O backend constrói os comandos (`course_prepare_status`): `cargo fetch` (a única ida à rede) e `cargo test --offline --no-run`, com um `CARGO_HOME` e um `target` só do curso — o `~/.cargo` não é tocado.",
        "O diálogo de aprovação partilhado mostra-os. Uma recusa vai para o registo de auditoria e nada corre.",
        "Aprovado, `course_prepare` só corre se o comando aprovado for o plano actual; regista a operação na auditoria antes de correr e outra vez com o resultado.",
        "No fim fica um marcador com a impressão digital das dependências e o `Cargo.lock`; cada avaliação corre com `--offline`, essa cache e o tempo limite do curso.",
        "Sem preparação (ou se o curso mudou as bibliotecas), a avaliação recusa com `COURSE_NOT_PREPARED` e o cartão volta a aparecer.",
      ],
      tips: [
        "Na linha de comandos, `dxt plugin prepare courses/seiva` faz o mesmo para a mesma cache.",
        "A cache fica em `<dados do utilizador>/dxtutor/course-cache/seiva-basics` (uns 650 MB); apagá-la só obriga a preparar outra vez.",
      ],
      limits: [
        "Só na app desktop, e só para cursos avaliados em Rust.",
        "Precisa de rede na preparação (crates.io e GitHub).",
      ],
      covers: ["lt-prepare"],
    },
  ],
};
