/* ═══════════ Co-Dev — domínio: o tipo de uma sessão nova do agente (conjunto 9) ═══════════
   Só as sessões de arquitectura levam a ferramenta `arch_propose` (a definição tem ~3 KB e ia em
   todos os pedidos de todas as conversas). Uma sessão é de arquitectura quando o Studio de
   arquitectura está aberto ou o primeiro pedido fala de arquitectura/diagramas. Fica gravada com
   a sessão: retomá-la mantém as ferramentas com que começou. Puro. */

/* «arquitectura»/«arquitetura»/«architecture», «diagrama»/«diagram», «Studio» e «C4» */
const ARCH_WORDS = /\b(arqui?tec?tur|architect|diagram|studio\b|c4\b)/i;

/** O primeiro pedido de uma conversa é sobre desenhar/rever uma arquitectura? */
export function isArchitectureRequest(text: string): boolean {
  return ARCH_WORDS.test(text);
}

/** Uma sessão nova é de arquitectura (o Studio aberto ou o pedido fala disso)? */
export function architectureSession(studioOpen: boolean, firstRequest: string): boolean {
  return studioOpen || isArchitectureRequest(firstRequest);
}
