/* ═════════ dxtutor IDE — bus de eventos tipado (ADR-0004, U3) ═════════
   Os proprietários de estado (`app/store/`) emitem aqui cada mudança; as features
   subscrevem o que lhes interessa em vez de se chamarem umas às outras por globais
   (`refresh()`, `updateAgentUI()`, `badges()`…). Síncrono e por ordem de subscrição; um
   handler que lança não impede os seguintes (o erro vai para a consola). Sem DOM. */

/** O mapa dos eventos da app: nome → payload. */
export interface AppEvents {
  /** Modo de autonomia do Co-Dev (`manual`/`assist`/`auto`). */
  "agent:mode": { mode: string; prev: string };
  /** Limiar de confiança do modo Assistido. */
  "agent:threshold": { value: number; prev: number };
  /** Provedor activo da conversa. */
  "agent:provider": { provider: string; prev: string };
  /** Incluir o ficheiro activo como contexto. */
  "agent:context": { enabled: boolean };
  /** Assistente da conversa (Co-Dev, Tutor, …). */
  "agent:persona": { persona: string; prev: string };
  /** Painel da barra lateral. */
  "layout:pane": { pane: string; prev: string };
  "layout:theme": { theme: string; prev: string };
  "layout:locale": { locale: string; prev: string };
  /** Separador activo do editor (`null` = nenhum). */
  "editor:tab": { id: string | null; prev: string | null };
  /** Um separador do editor fechou (`path`: a chave do `FS` de um separador de ficheiro, senão `null`):
   *  o servidor de linguagem recebe o `didClose` (features/lsp). */
  "editor:tab-closed": { id: string; path: string | null };
  /** O editor acabou de desenhar a vista de um ficheiro (a chave do `FS`): o `innerHTML` foi
   *  refeito, por isso quem a decora (o aviso de servidor em falta, `features/lsp`) repõe-se. */
  "editor:file-view": { path: string };
  /** O workspace mudou (ficheiros, estado git, painel): emitido no fim do `refresh()`. */
  "workspace:changed": { fromEditor: boolean; force: boolean };
  /** Execução do agente começou/acabou (o botão enviar↔parar, a fila do compositor). */
  "agent:run": { active: boolean; label: string };
  /** A configuração de um provedor mudou (modelo, ligado/desligado). */
  "agent:providers": { provider: string };
}

export type AppEvent = keyof AppEvents;
type Handler<E extends AppEvent> = (payload: AppEvents[E]) => void;

export interface Bus {
  on<E extends AppEvent>(event: E, handler: Handler<E>): () => void;
  once<E extends AppEvent>(event: E, handler: Handler<E>): () => void;
  emit<E extends AppEvent>(event: E, payload: AppEvents[E]): void;
  /** Quantos subscritores tem um evento (diagnóstico e testes). */
  count(event: AppEvent): number;
}

export function createBus(onError: (event: string, err: unknown) => void = (e, err) => console.error(`[bus] ${e}:`, err)): Bus {
  const handlers = new Map<AppEvent, Set<Handler<AppEvent>>>();
  const bus: Bus = {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      set.add(handler as Handler<AppEvent>);
      return () => void set!.delete(handler as Handler<AppEvent>);
    },
    once(event, handler) {
      const off = bus.on(event, (p) => {
        off();
        handler(p);
      });
      return off;
    },
    emit(event, payload) {
      // cópia: um handler que se desliga (ou liga outro) não altera esta emissão
      for (const h of [...(handlers.get(event) ?? [])]) {
        try {
          (h as Handler<typeof event>)(payload);
        } catch (err) {
          onError(event, err);
        }
      }
    },
    count: (event) => handlers.get(event)?.size ?? 0,
  };
  return bus;
}

/** O bus da app (um por página). */
export const bus: Bus = createBus();
