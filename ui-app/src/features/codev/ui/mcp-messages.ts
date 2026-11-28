/* Textos das linhas dos servidores MCP no separador «Co-Dev run» (MCP sobre HTTP com OAuth e descrições fixadas —
   texto novo, sem par no motor de tradução): en + ptAO. */
import type { Messages } from "../../../app/i18n";

export const CODEV_MCP_MESSAGES = {
  en: {
    authSignedIn: "signed in ✓",
    authNeedsSignIn: "needs sign-in",
    authSignedOut: "not signed in",
    authNone: "no sign-in",
    authHeader: "own Authorization header",
    signIn: "Sign in",
    signInTitle: "Opens the browser at the server's sign-in page; the tokens stay in the OS keychain",
    signOut: "Sign out",
    pending: "{n} tool(s) with a new definition, not offered to the model:",
    newTool: "new",
    review: "Review changes",
    reviewTitle: "Shows the old and the new definition; approved, the tool is offered from the next conversation",
    untrusted: "the project's — trust .dxtutor/mcp.json first",
  },
  ptAO: {
    authSignedIn: "com sessão ✓",
    authNeedsSignIn: "precisa de entrar",
    authSignedOut: "sem sessão",
    authNone: "sem entrada",
    authHeader: "cabeçalho Authorization próprio",
    signIn: "Entrar",
    signInTitle: "Abre o browser na página de entrada do servidor; os tokens ficam no keychain do sistema",
    signOut: "Sair",
    pending: "{n} ferramenta(s) com uma definição nova, não oferecida(s) ao modelo:",
    newTool: "nova",
    review: "Rever alterações",
    reviewTitle: "Mostra a definição antiga e a nova; aprovada, a ferramenta é oferecida a partir da próxima conversa",
    untrusted: "do projecto — confia primeiro no .dxtutor/mcp.json",
  },
} satisfies Messages<string>;
