/* Textos do Commit Graph (r23 F3, UI-SCM-08). Texto NOVO (sem par no motor de tradução): o i18n.catalogs.test
   verifica-lhe a estrutura. Os do antigo `graph.desktop-messages.ts` vieram para aqui com os mesmos valores. */
import type { Messages } from "../../../app/i18n";

export const GRAPH_SCREEN_MESSAGES = {
  en: {
    branches: "Branches", remotes: "Remotes", tags: "Tags", stashes: "Stashes", worktrees: "Worktrees", contributors: "Contributors",
    none: "None", loading: "Reading the repository…", refsError: "Could not read the refs: {e}",
    noRepo: "No git repository open. Open a folder that is a repository in the desktop app to see its graph.",
    finish: "Finish {b}", count: "{c} commits · {b} branches", mergeOf: "merge of {n} parents", gone: "upstream gone",
    ahead: "{n} to push", behind: "{n} to pull", readingFiles: "Reading the files…", noFiles: "No files changed.",
    noFileList: "Commit from before the prototype — no file list.", notInBranch: "The file does not exist in this branch",
    current: "current", commitsBy: "{n} commits",
    searchPh: "Search: author: type: file: issue: branch: message:", matchCount: "{n} of {total}",
    modeHighlight: "Highlight", modeFilter: "Filter", modeHighlightTip: "Every commit shows; the others are dimmed. Click to show only the matches.",
    modeFilterTip: "Only the matches show. Click to show every commit.",
    "life-issue": "Issue", "life-tests": "Tests", "life-ci": "CI", "life-pr": "Pull request", "life-env": "Environments", lifeReading: "reading…",
    "lifeNone-issue": "no issue key in the message", "lifeNone-tests": "not run on this commit", "lifeNone-ci": "no CI run", "lifeNone-pr": "in no pull request", "lifeNone-env": "—",
    lifeGhMissing: "GitHub CLI not installed", lifeNotConnected: "not connected", lifeError: "unavailable: {e}", lifeTests: "{p} passed · {f} failed · {i} ignored", lifeCi: "{n} run(s) · {name}",
    fetch: "Fetch", pull: "Pull", push: "Push", fetchTip: "git fetch --all --prune (asks first)", pullTip: "git pull --rebase --autostash (asks first)", pushTip: "git push (asks first; never --force)",
    conflictTip: "Merging {b} into the current branch would conflict in: {files}", conflictBanner: "{n} branch(es) would conflict when merged into {head}: {list}",
    wip: "Uncommitted changes ({n} files)", wipStaged: "{n} staged", activity: "Activity", activityTip: "{n} commits · {from} → {to}",
  },
  ptAO: {
    branches: "Ramos", remotes: "Remotos", tags: "Tags", stashes: "Stashes", worktrees: "Worktrees", contributors: "Contribuidores",
    none: "Nenhum", loading: "A ler o repositório…", refsError: "Não consegui ler as refs: {e}",
    noRepo: "Não há repositório git aberto. Abre na app desktop uma pasta que seja um repositório para veres o grafo.",
    finish: "Finalizar {b}", count: "{c} commits · {b} ramos", mergeOf: "merge de {n} pais", gone: "upstream apagado",
    ahead: "{n} por enviar", behind: "{n} por receber", readingFiles: "A ler os ficheiros…", noFiles: "Nenhum ficheiro mudou.",
    noFileList: "Commit anterior ao protótipo — sem lista de ficheiros.", notInBranch: "O ficheiro não existe neste ramo",
    current: "actual", commitsBy: "{n} commits",
    searchPh: "Pesquisar: author: type: file: issue: branch: message:", matchCount: "{n} de {total}",
    modeHighlight: "Realçar", modeFilter: "Filtrar", modeHighlightTip: "Aparecem todos os commits; os outros ficam esbatidos. Clica para mostrar só os que batem.",
    modeFilterTip: "Só aparecem os que batem. Clica para mostrar todos os commits.",
    "life-issue": "Issue", "life-tests": "Testes", "life-ci": "CI", "life-pr": "Pull request", "life-env": "Ambientes", lifeReading: "a ler…",
    "lifeNone-issue": "sem chave de issue na mensagem", "lifeNone-tests": "não correram neste commit", "lifeNone-ci": "sem corridas de CI", "lifeNone-pr": "em nenhum pull request", "lifeNone-env": "—",
    lifeGhMissing: "GitHub CLI não instalado", lifeNotConnected: "não ligado", lifeError: "indisponível: {e}", lifeTests: "{p} passaram · {f} falharam · {i} ignorados", lifeCi: "{n} corrida(s) · {name}",
    fetch: "Buscar", pull: "Receber", push: "Enviar", fetchTip: "git fetch --all --prune (pergunta antes)", pullTip: "git pull --rebase --autostash (pergunta antes)", pushTip: "git push (pergunta antes; nunca --force)",
    conflictTip: "Juntar {b} ao ramo actual daria conflito em: {files}", conflictBanner: "{n} ramo(s) dariam conflito ao juntar a {head}: {list}",
    wip: "Alterações por commitar ({n} ficheiros)", wipStaged: "{n} no stage", activity: "Actividade", activityTip: "{n} commits · {from} → {to}",
  },
} satisfies Messages<string>;
export type GraphScreenKey = keyof typeof GRAPH_SCREEN_MESSAGES.en;
