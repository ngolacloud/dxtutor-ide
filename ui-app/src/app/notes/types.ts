/* ═════════ notas para a documentação oficial — tipos ═════════
   Cada feature descreve as SUAS acções em dados tipados (`features/<f>/notes.ts`): o que faz, o
   fluxo, como usar e as dicas. O registo (`registry.ts`) junta-as e o gerador (`render.ts`)
   escreve `docs/notes/NOTAS.md` — a base da documentação oficial do dxtutor-ide. O teste
   `tests/notes.docs.test.ts` falha se uma acção nova não tiver nota ou se o documento estiver
   desactualizado; `npm run docs:notes` regenera-o. Dados puros: sem DOM, sem `window`. */

/** Uma acção que o utilizador faz (um botão, um atalho, um comando da paleta). */
export interface ActionNote {
  /** título curto, como aparece na interface */
  title: string;
  /** onde se encontra: barra do editor, atalho, paleta, menu, botão do painel… */
  where: string[];
  /** o que faz, em uma ou duas frases */
  what: string;
  /** o fluxo: o que acontece por dentro, passo a passo */
  flow: string[];
  /** como usar: os passos do utilizador */
  howTo: string[];
  /** dicas e boas práticas */
  tips?: string[];
  /** limites conhecidos e o que a acção NÃO faz */
  limits?: string[];
  /** os identificadores técnicos que esta nota cobre (`data-action`, `tabs:<fn>`, comando da
   *  paleta). O teste usa-os para provar que nenhuma acção da feature ficou sem nota. */
  covers: string[];
}

export interface FeatureNotes {
  /** identificador estável (o nome da pasta da feature) */
  id: string;
  title: string;
  /** para que serve a feature */
  summary: string;
  /** onde vive no código (para quem mantém) */
  code: string[];
  /** a data da última revisão das notas (AAAA-MM-DD) */
  updated: string;
  actions: ActionNote[];
}
