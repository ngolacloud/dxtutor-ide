/* ═════════ feature `lsp` — as linguagens dos VSIX instalados, no backend (LSP P4) ═════════
   O backend decide que servidor arranca para um ficheiro; para os ficheiros que o registo não conhece
   precisa das linguagens que os VSIX instalados contribuem (`lsp_contributions`, a lista inteira — sem
   elas, uma desinstalada desaparece). Aqui: mandá-las só quando mudaram desde a última vez que o backend
   as aceitou (o cliente pergunta antes de decidir a linguagem de cada ficheiro). Sem DOM e sem `window`. */

import type { ContributedLanguage } from "../domain/registry";

export interface ContributionsDeps {
  /** As linguagens dos VSIX instalados e ligados, agora (o registo de linguagens). */
  languages(): ContributedLanguage[];
  /** Manda-as ao backend. */
  send(languages: ContributedLanguage[]): Promise<void>;
}

export interface ContributionsSync {
  /** Manda as linguagens, se mudaram desde o último envio aceite; um envio que falha repete-se na próxima. */
  sync(): Promise<void>;
}

export function makeContributionsSync(d: ContributionsDeps): ContributionsSync {
  let sent: string | null = null;
  return {
    async sync() {
      const langs = d.languages();
      const key = JSON.stringify(langs);
      if (key === sent) return;
      await d.send(langs);
      sent = key;
    },
  };
}
