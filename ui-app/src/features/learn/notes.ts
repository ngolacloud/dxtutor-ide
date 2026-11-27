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
        "Dos frameworks e ferramentas oficiais, o Dxjs, o Seiva, o Kubernetes e o Delonix Engine têm curso (embutidos na app); os outros chegam em fases próximas.",
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
        "Hoje os avaliadores de Python (`unittest`; num projecto com `manage.py` na raiz, o `manage.py test` do Django), de TypeScript (`node --test`) e de Rust (`cargo test`, um crate ou um workspace) correm passos de projecto; as outras linguagens dizem que ainda não o suportam.",
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
      title: "O curso Django: de uma vista a uma pequena app de leituras",
      where: ["Learning Track › «Choose what to learn» › «Frameworks & tools» › Django"],
      what: "O curso oficial de Django 5.2 LTS: 9 unidades — vistas e URLs, modelos e migrações, o ORM, templates, formulários, o admin, testes e uma API JSON só com Django — que constroem uma pequena app de leituras (livros, autores e críticas). Os exercícios correm contra o Django verdadeiro, com o próprio executor de testes do Django.",
      howTo: [
        "Escolhe o cartão Django na secção «Frameworks & tools» e os níveis que queres.",
        "Na primeira vez, prepara o curso (cartão «Prepare this course»): instala o Django num ambiente Python só deste curso.",
        "Lê os conceitos de cada unidade, escreve os drills linha a linha e resolve os projectos: cada um é um projecto Django com `manage.py`, onde só os ficheiros da tarefa são editáveis.",
      ],
      flow: [
        "O curso vem embutido no backend (`courses/django/`, `include_str!`), na categoria `framework`, avaliado pelo descritor de Python.",
        "As dependências (Django, asgiref e sqlparse) estão fixadas no `[build]` do curso, cada uma com a versão exacta e o hash sha256; a avaliação usa o venv do curso, sem rede e só com SQLite.",
        "Num passo de projecto, o descritor vê o `manage.py` na raiz e corre `manage.py test`: a base de dados de teste é criada em memória, as migrações correm e os testes ocultos decidem; um teste que não corre nunca conta como aprovado.",
      ],
      tips: [
        "Precisa do Python 3.10 ou mais recente com o módulo `venv` (no Debian/Ubuntu, o pacote `python3-venv`).",
        "No primeiro passo, «About» leva à documentação oficial do Django 5.2, em docs.djangoproject.com/en/5.2.",
      ],
      limits: [
        "Só na app desktop; no browser o cartão fica «Coming soon».",
        "Não se criam ficheiros novos: uma migração a escrever já vem no passo, vazia.",
      ],
      covers: ["lt-pick", "submit_step"],
    },
    {
      title: "Os cursos de Kubernetes e do Delonix: manifestos avaliados sem cluster",
      where: ["Learning Track › «Choose what to learn» › «Frameworks & tools» › Kubernetes ou Delonix Engine"],
      what: "Dois cursos de ferramentas em que se escreve YAML: o de Kubernetes (11 unidades, dos objectos e Pods ao Kustomize) e o do Delonix Engine 0.2.0 (9 unidades, dos manifestos e Pods aos ficheiros compose e a um projecto inteiro num Stack). Cada desafio é avaliado na tua máquina, sem cluster e sem tocar no motor de contentores.",
      howTo: [
        "Escolhe o cartão Kubernetes ou Delonix Engine na secção «Frameworks & tools» e os níveis que queres.",
        "Lê os conceitos, escreve os drills linha a linha (o drill de YAML só confirma que o ficheiro se lê) e resolve os desafios: cada um é um pequeno projecto de ficheiros YAML.",
        "Carrega em «Submit»: o resultado lista cada verificação, ✓ ou ✗, com o que se esperava e o que se encontrou.",
      ],
      flow: [
        "Os cursos vêm embutidos no backend (`courses/kubernetes/`, `courses/delonix/`), na categoria `tool`, e escrevem-se e avaliam-se em `yaml`.",
        "Cada desafio traz, nos ficheiros ocultos, um `checks.toml`: verificações sobre o YAML (um caminho e uma afirmação — igual, corresponde a, só estas chaves, um selector que escolhe as etiquetas de outro documento, um nome que existe noutro ficheiro) e, às vezes, um comando de uma ferramenta.",
        "Os comandos só podem ser os da lista do backend (`tutor_core::toolcheck`): `kubectl kustomize <pasta>`, `delonix manifest render -f <ficheiro>` e `delonix compose config -f <ficheiro> -p <projecto>`. Nenhum vai à rede, a um cluster ou ao motor de contentores.",
        "Correm sem shell, com o ambiente limpo, um `HOME` e um `KUBECONFIG` vazios numa pasta temporária (os teus contextos do kubectl nunca são lidos) e um tempo limite. Um kustomization que aponte para a rede ou use o Helm, ou uma porta de compose sem a porta do anfitrião, é recusado antes de correr.",
      ],
      tips: [
        "Precisas do kubectl para as unidades de Kustomize e do delonix 0.2.0 para o curso do Delonix; sem eles, o desafio diz o que instalar em vez de falhar.",
        "O relatório da avaliação mostra a saída do comando que falhou: é a mesma mensagem que verias no terminal.",
      ],
      limits: [
        "Só na app desktop; no browser os cartões ficam «Coming soon».",
        "As unidades 1 a 11 do Kubernetes são offline; as unidades 12 a 18 correm os manifestos no cluster de prática do curso (ver «O cluster de prática do Kubernetes»).",
        "O `delonix manifest validate` não é usado na avaliação: lê o estado do motor (e mexe nos cgroups do anfitrião); as referências entre documentos são verificadas pelo curso, a partir dos teus ficheiros.",
      ],
      covers: ["lt-pick", "submit_step"],
    },
    {
      title: "Preparar um curso (Seiva, Django, Docker, Podman): descarregar as dependências uma vez",
      where: ["Learning Track › um passo do curso Seiva, Django, Docker ou Podman › cartão «Prepare this course»"],
      what: "Um curso que usa bibliotecas de fora (o Seiva 0.2.0, o tokio e o axum; o Django 5.2) ou imagens base de contentores (Docker e Podman) avalia-se sempre sem rede. Antes da primeira avaliação, «Prepare course» descarrega essas bibliotecas uma vez para uma cache deste curso; depois, cada passo corre offline em poucos segundos.",
      howTo: [
        "Abre um passo do curso: enquanto o curso não está preparado, aparece o cartão «Prepare this course».",
        "Carrega em «Prepare course» e lê, no diálogo, os pacotes que vão ser descarregados (nome, versão e origem), os comandos exactos e a pasta onde correm.",
        "Aprova: o Seiva demora cerca de um minuto, o Django e as imagens dos cursos de contentores uns segundos; no fim o cartão desaparece e «Submit» já avalia.",
      ],
      flow: [
        "O backend constrói os comandos e a lista de pacotes (`course_prepare_status`). Num curso Rust: `cargo fetch` (a única ida à rede) e `cargo test --offline --no-run`, com um `CARGO_HOME` e um `target` só do curso — o `~/.cargo` não é tocado.",
        "Num curso Python: `python3 -m venv` cria um venv só do curso, `pip install --require-hashes --only-binary=:all:` instala do PyPI as versões exactas (a única ida à rede; um pacote sem hash ou não fixado faz o pip recusar; nenhum `setup.py` corre; a configuração e a cache do pip do utilizador ficam de fora) e `pip check` confirma o resultado sem rede. O Python do utilizador não ganha pacotes.",
        "Num curso de contentores (Docker, Podman): `podman pull` de cada imagem base pelo seu digest sha256 (a única ida à rede) e `podman tag` com o nome que os `FROM` usam, para o sandbox Podman rootless do dxtutor (`<cache>/.sandbox/podman`: armazenamento e configuração próprios). As imagens e os contentores do utilizador não são tocados, e o daemon do Docker nunca é usado.",
        "O diálogo de aprovação partilhado mostra os pacotes e os comandos. Uma recusa vai para o registo de auditoria e nada corre.",
        "Aprovado, `course_prepare` só corre se o comando aprovado for o plano actual; regista a operação na auditoria antes de correr e outra vez com o resultado.",
        "No fim fica um marcador com a impressão digital das dependências; cada avaliação corre contra essa cache (`--offline` no Rust, o Python do venv com `PIP_NO_INDEX` no Python, `--pull=never` nos contentores, que confirmam o digest de cada imagem antes de avaliar) e com o tempo limite do curso.",
        "Sem preparação (ou se o curso mudou as dependências), a avaliação recusa com `COURSE_NOT_PREPARED` e o cartão volta a aparecer.",
      ],
      tips: [
        "Na linha de comandos, `dxt plugin prepare courses/seiva` (ou `courses/django`, `courses/docker`, `courses/podman`) faz o mesmo para a mesma cache.",
        "A cache fica em `<dados do utilizador>/dxtutor/course-cache/<id do curso>` (o Seiva uns 650 MB, o Django uns 60 MB; as imagens dos cursos de contentores, uns 330 MB, no sandbox ao lado); apagá-la só obriga a preparar outra vez.",
        "Um curso de terceiros pode declarar as dependências que quiser: confere a lista do diálogo antes de aprovar.",
      ],
      limits: [
        "Só na app desktop, e só para cursos avaliados em Rust (cargo), Python (pip), Dockerfile (imagens; precisa do Podman rootless, só em Linux) ou — o Kubernetes — YAML (o cluster de prática).",
        "Precisa de rede na preparação (crates.io e GitHub; o PyPI; o Docker Hub; o GitHub e o Docker Hub no Kubernetes).",
      ],
      covers: ["lt-prepare"],
    },
    {
      title: "O cluster de prática do Kubernetes: arrancar, apagar, e avaliar ao vivo",
      where: ["Learning Track › Kubernetes › um passo das unidades 12 a 18 › cartões «Prepare this course» e «Practice cluster»"],
      what: "As sete últimas unidades do curso de Kubernetes aplicam os teus manifestos num Kubernetes a sério — um cluster de um nó (Kubernetes v1.36.4) feito com o kind sobre o Podman sem root, só deste curso — e verificam o que o Kubernetes fez: um rollout, Pods prontos, um Job completo, um Service com endpoints, um contentor morto por passar o limite de memória.",
      howTo: [
        "Num passo ao vivo, prepara o curso uma vez («Prepare course»): o diálogo mostra o kind, a imagem do nó e as três imagens que as unidades usam, cada uma fixada pelo digest (cerca de 1 GB).",
        "Carrega em «Submit»: na primeira vez o cluster é criado (cerca de um minuto); depois é reutilizado.",
        "O cartão «Practice cluster» diz se o cluster está a correr, a memória que usa e a que horas é apagado se ninguém o usar. «Start practice cluster» arranca-o antes de submeteres; «Delete cluster» apaga-o já.",
      ],
      flow: [
        "Cada avaliação cria um namespace novo (`dxt-<passo>-<aleatório>`), aplica os teus ficheiros com `kubectl apply`, espera pelo que o passo pede (`rollout status`, `wait --for=condition`, ou uma consulta repetida até um valor bater) e lê o resultado com `kubectl get -o json`; no fim apaga o namespace.",
        "Antes de tocar no cluster correm as verificações que não precisam dele; se falharem, a parte ao vivo nem começa.",
        "Os comandos vêm do curso, mas só correm os da lista permitida no backend (`apply`, `get`, `rollout status|undo|history`, `wait`, `logs`): nada de `exec`, `port-forward` nem escritas fora do namespace. O kubeconfig, o contexto e o namespace são sempre os do avaliador.",
        "Antes de cada `apply`, o backend recusa o que sairia do namespace ou do cluster: tipos fora da lista (Namespace, RBAC, CRDs…), `metadata.namespace`, `hostNetwork`, `hostPath`, `hostPort`, contentores privilegiados, e imagens que não sejam as preparadas (`:latest` e `imagePullPolicy: Always` incluídos).",
        "O Podman do cluster usa o armazenamento, a pasta de execução e a configuração deste curso, e o cluster corre numa rede interna: não descarrega nada durante a avaliação. O teu `~/.kube/config`, os teus contentores e as tuas imagens nunca são lidos nem mudados.",
        "«Start practice cluster» e «Delete cluster» mostram o comando exacto no diálogo partilhado; `learn_cluster_start`/`learn_cluster_delete` só correm esse, e registam na auditoria antes e com o resultado. Uma recusa também fica registada.",
        "Um cluster sem uso há 20 minutos é apagado, e um que uma execução anterior deixou também (só os `dxtutor-*` das caixas do dxtutor); as imagens preparadas ficam.",
      ],
      tips: [
        "Na linha de comandos: `dxt plugin prepare courses/kubernetes` e `dxt plugin test courses/kubernetes` (cria o cluster, mede os tempos e a memória e apaga-o no fim).",
        "O cluster ocupa uns 900 MB de memória enquanto corre; apaga-o quando acabares.",
      ],
      limits: [
        "Só na app desktop, com o Podman 4.9 ou mais recente sem root, cgroup v2 com os controladores cpu, memory e pids delegados, user namespaces e a sessão D-Bus do utilizador. Sem isso, o cartão diz o que falta e as unidades offline continuam a ser avaliadas.",
        "Só linux-x64 e linux-arm64 (as releases do kind).",
      ],
      covers: ["lt-cluster-start", "lt-cluster-delete", "learn_cluster_status"],
    },
  ],
};
