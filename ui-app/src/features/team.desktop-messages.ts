/* Textos que nasceram em português sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO,
   os valores ptAO iguais aos textos de antes. */
import type { Messages } from "../app/i18n";

export const TEAM_DESKTOP_MESSAGES = {
  en: {
    outOfScope: "outside the scope of the assistant {name}. It may write to: {paths}. This path belongs to: {owner}.", nothing: "nothing",
    noPermission: "the assistant {name} is not allowed to run \"{cmd}\".",
    teamJsonInvalid: ".dxtutor/team.json is not valid JSON — keeping the scopes derived from the folder",
    canWrite: "Can write: {who}", noSpecialist: "No specialised assistant — only the orchestrator, with your approval.",
  },
  ptAO: {
    outOfScope: "fora do escopo do assistente {name}. Pode escrever em: {paths}. Este caminho pertence a: {owner}.", nothing: "nada",
    noPermission: "o assistente {name} não tem permissão para correr \"{cmd}\".",
    teamJsonInvalid: ".dxtutor/team.json não é JSON válido — fico com os escopos derivados da pasta",
    canWrite: "Pode escrever: {who}", noSpecialist: "Nenhum assistente especializado — só o orquestrador, com a tua aprovação.",
  },
} satisfies Messages<string>;
