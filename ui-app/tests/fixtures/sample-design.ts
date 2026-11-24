/* Fixture de testes: o desenho do Studio do projecto-exemplo (Gateway, Web, Orders API, filas,
   base de dados, cache, worker e bucket). Era o `ST_SEED` que a app carregava em qualquer pasta;
   a app deixou de inventar um desenho (ADR-0006, R6a) — nasce vazio e guarda-se no projecto
   (`.dxtutor/studio.json`). Aqui é só dado de teste: os goldens do Board, da Infra e do Co-Dev
   foram escritos sobre este desenho. */

interface DesignWindow { SD: unknown }

/** O desenho do projecto-exemplo (cópia nova a cada chamada). */
export const sampleDesign = () => (JSON.parse(JSON.stringify({nodes:[{id:'gw',tech:'aws-alb',n:'Gateway',x:20,y:155,st:'plan'},{id:'web',tech:'react-vite',n:'Web',x:205,y:30,st:'plan'},{id:'api',tech:'rust-axum',n:'Orders API',x:205,y:155,st:'plan'},{id:'q',tech:'aws-sqs',n:'Order Events',x:205,y:290,st:'plan'},{id:'pg',tech:'aws-rds',n:'Orders DB',x:390,y:30,st:'plan'},{id:'cache',tech:'aws-elasticache',n:'Session Cache',x:390,y:155,st:'plan'},{id:'worker',tech:'go-http',n:'Billing Worker',x:390,y:290,st:'plan'},{id:'s3',tech:'aws-s3',n:'Invoices Bucket',x:575,y:290,st:'plan'}],
  edges:[['gw','web'],['gw','api'],['web','api'],['api','pg'],['api','cache'],['api','q'],['worker','q'],['worker','pg'],['worker','s3']]})));

/** Põe o desenho do projecto-exemplo no Studio (como se a pasta tivesse um `.dxtutor/studio.json`). */
export function applySampleDesign(w: DesignWindow): void {
  w.SD = sampleDesign();
}
