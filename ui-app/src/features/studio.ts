/* ═════════ dxtutor IDE — feature: Studio (catálogo cloud + motor de desenho) ═════════
   Inversão de direcção (padrão Debug/SCM/Ext): o motor Studio, antes espalhado por
   `app.ts` em duas camadas (a morta «desenhar a arquitectura» e a viva «cloud
   technology catalogue»), muda-se INTEIRO para cá. A feature é densa e cruza o
   monólito @ts-nocheck, por isso assume `@ts-nocheck` como `scm.ts`/`debug.ts`.

   Fronteira: a feature DETÉM o catálogo (CLOUD/TECH/KIND/mkT/isApp/sl/appDir),
   o estado do desenho (SD/SSEL/SLINK/SCAT/NT/NW/NH; o desenho do projecto — loadSD), as funções do motor
   (saveSD/openStudio/sdAdd/sdDel/validateDesign/drawStudio) e o corpo da vista
   (renderStudioView). Os CONSUMIDORES ficam no monólito e lêem por global:
   os geradores (`composeYaml`/`dockerfile`/`appFiles`/`k8sYaml`/`cloudMap`/
   `genBacklogIssues` em app.ts, `k8sInfra`/`appEnv` em v5.ts) lêem TECH/KIND/
   isApp/sl/appDir; `genBacklog`/boot lêem SD/loadSD/validateDesign/saveSD.

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html), por isso publica estado/funções no `window` no eval — os
   nomes livres do monólito resolvem no escopo GLOBAL em runtime. Nada é lido
   ansiosamente no eval (LS/openTab/genBacklog/dxRun só são tocados DENTRO das
   funções, chamadas depois do arranque). Os primitivos mutáveis SD/SSEL/SLINK/SCAT
   são window-PUROS (sem `let` local): o resíduo e os onclick inline ESCREVEM-nos
   (`SD=loadSD()` no boot e ao abrir uma pasta, `SSEL=…`/`SLINK=…`/`SCAT='…'` nos handlers).

   VIEW.studio e o drift (ADR-0004, U4g6): a feature regista `VIEW.studio` (o registo
   vem de app/store/registry.ts desde a U4g1) — o corpo `renderStudioView` + o selector
   «Compare with…» — e o `drawStudio` publicado é a base + a sobreposição de drift
   («design vs realidade»: etiquetas por nó e resumo no inspector). Eram as decorações
   do v6.ts; as chamadas internas já resolviam `drawStudio` pelo global, por isso o
   efeito é o mesmo. O relatório (`driftReport`), os estilos (`DSTY`) e os rótulos dos
   ambientes (`ENVL`) vêm de features/infra.ts por import; o ambiente comparado é o
   global `DRIFT` (nasce na infra; o onchange inline do selector escreve-o). */

import { $, esc } from "../core";
import { VIEW } from "../app/store/registry";
import { registerActions, globalCalls } from "../app/actions";
import { driftReport, DSTY, ENVL } from "./infra";
import { translator } from "../app/i18n";
import { STUDIO_MESSAGES } from "./studio.messages";
import { services } from "../app/services";
import { STUDIO_DESKTOP_MESSAGES } from "./studio.desktop-messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(STUDIO_MESSAGES);
const txd = translator(STUDIO_DESKTOP_MESSAGES);

/* o ambiente com que o Studio compara o desenho (o drift): deste módulo desde a U7p2 do ADR-0004 (era window.DRIFT,
   que a infra criava); o arranque escolhe-o pelo setDrift */
let DRIFT: string | null = null;
export const setDrift = (v: string | null): void => { DRIFT = v; };

/* helpers locais (gémeos puros dos homónimos do monólito; isolados na feature) */
const slug = (s: any) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rid = () => Math.random().toString(16).slice(2, 9);


/* ───── o desenho é do projecto (ADR-0006, R6a) ─────
   Sai o desenho semeado (`ST_SEED`: Gateway, Orders API, Billing Worker… de um projecto de
   demonstração), que aparecia em qualquer pasta. O desenho nasce vazio e guarda-se no PROJECTO, em
   `.dxtutor/studio.json` (versionável, ao lado do `team.json`), quando há uma pasta aberta; sem
   pasta (browser), no localStorage — numa chave nova (`studio4`), porque a `studio3` guardava o
   desenho semeado. */
const emptyDesign = (): { nodes: any[]; edges: string[][] } => ({ nodes: [], edges: [] });
const P_STUDIO = () => ROOT + '.dxtutor/studio.json';
const hasFolder = (): boolean => !!(window as unknown as { DXR?: { root?: string | null } }).DXR?.root;
const validDesign = (d: any): boolean => !!d && Array.isArray(d.nodes) && Array.isArray(d.edges) && d.nodes.every((n: any) => n && TECH[n.tech]);
/** O desenho guardado: o `.dxtutor/studio.json` da pasta aberta, ou o do localStorage; vazio se não há (ou não é válido). */
function loadSD(): { nodes: any[]; edges: string[][] } {
  if (hasFolder()) {
    const f = FS[P_STUDIO()];
    if (!f) return emptyDesign();
    try { const d = JSON.parse(f.content); if (validDesign(d)) return d; } catch { /* inválido */ }
    log('studio', txd('invalidDesign'));
    return emptyDesign();
  }
  const d = LS.get('studio4', null);
  return validDesign(d) ? d : emptyDesign();
}

/* estado do desenho (window-pure: residue+onclicks escrevem) + geometria dos nós */
window.SD=emptyDesign();/* o separador do catálogo e o modo «Connect»: com dono aqui (U7j — eram window.SCAT/SLINK) */
export let SCAT='aws';
export let SLINK:string|null=null;
/* o nó seleccionado: só este módulo o lê (U7o — era window.SSEL) */
let SSEL:string|null=null;
let SCLICK:{id:string|null,t:number}={id:null,t:0};const NW=152,NH=58;
const saveSD=()=>{ if (hasFolder()) writeFile(P_STUDIO(), JSON.stringify(SD, null, 2) + '\n'); else LS.set('studio4', SD); };
/* outra pasta aberta: o desenho é o dela */
document.addEventListener('dx:workspace', () => { SD = loadSD(); SSEL = null; SLINK = null; services.tabs!.rerender('studio'); });
export function openStudio(){openTab({id:'studio',title:'Studio',kind:'studio'});}

/* ───── catálogo de tecnologias cloud ───── */
export const CLOUD:Record<string,any>={app:{l:'APP',col:'#dea584',t:'Application runtimes'},oss:{l:'OSS',col:'#5cc9a7',t:'Open source'},aws:{l:'AWS',col:'#ff9900',t:'Amazon Web Services'},azure:{l:'AZURE',col:'#3a96dd',t:'Microsoft Azure'},gcp:{l:'GCP',col:'#ea4335',t:'Google Cloud'}};
const PG='postgres:16-alpine',RD='redis:7-alpine',TF='traefik:v3.1',KC='quay.io/keycloak/keycloak:25.0',RMQ='rabbitmq:3.13-management-alpine',GCE='gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators';
const mkT=(n:string,cloud:string,kind:string,img:string,port:number,local?:string)=>({n,cloud,kind,img,port,local});
const TECH:Record<string,any>={
  'rust-axum':{n:'Rust · Axum',cloud:'app',kind:'app',port:8080,rt:'rust'},'go-http':{n:'Go · net/http',cloud:'app',kind:'app',port:8080,rt:'go'},'node-express':{n:'Node.js · Express',cloud:'app',kind:'app',port:3000,rt:'node'},'py-fastapi':{n:'Python · FastAPI',cloud:'app',kind:'app',port:8000,rt:'python'},'react-vite':{n:'React · Vite',cloud:'app',kind:'web',port:8080,rt:'web'},
  postgres:mkT('PostgreSQL','oss','sql',PG,5432),redis:mkT('Redis','oss','cache',RD,6379),rabbitmq:mkT('RabbitMQ','oss','amqp',RMQ,5672),kafka:mkT('Apache Kafka','oss','kafka','apache/kafka:3.8.0',9092),nats:mkT('NATS','oss','nats','nats:2.10-alpine',4222),minio:mkT('MinIO','oss','s3','minio/minio',9000),traefik:mkT('Traefik','oss','gateway',TF,80),keycloak:mkT('Keycloak','oss','oidc',KC,8080),prometheus:mkT('Prometheus','oss','obs','prom/prometheus:v2.54.1',9090),grafana:mkT('Grafana','oss','obs','grafana/grafana:11.2.0',3000),otel:mkT('OpenTelemetry Collector','oss','otel','otel/opentelemetry-collector:0.108.0',4317),
  'aws-alb':mkT('Application Load Balancer','aws','gateway',TF,80,'Traefik'),'aws-s3':mkT('Amazon S3','aws','s3','minio/minio',9000,'MinIO'),'aws-rds':mkT('Amazon RDS · PostgreSQL','aws','sql',PG,5432,'PostgreSQL'),'aws-dynamodb':mkT('Amazon DynamoDB','aws','dynamo','amazon/dynamodb-local',8000,'DynamoDB Local'),'aws-sqs':mkT('Amazon SQS','aws','sqs','softwaremill/elasticmq-native',9324,'ElasticMQ'),'aws-elasticache':mkT('Amazon ElastiCache · Redis','aws','cache',RD,6379,'Redis'),'aws-cognito':mkT('Amazon Cognito','aws','oidc',KC,8080,'Keycloak (stand-in)'),
  'az-frontdoor':mkT('Azure Front Door','azure','gateway',TF,80,'Traefik'),'az-blob':mkT('Azure Blob Storage','azure','blob','mcr.microsoft.com/azure-storage/azurite',10000,'Azurite'),'az-sql':mkT('Azure SQL Database','azure','mssql','mcr.microsoft.com/mssql/server:2022-latest',1433,'SQL Server 2022'),'az-servicebus':mkT('Azure Service Bus','azure','amqp',RMQ,5672,'RabbitMQ (stand-in)'),'az-redis':mkT('Azure Cache for Redis','azure','cache',RD,6379,'Redis'),'az-entra':mkT('Microsoft Entra ID','azure','oidc',KC,8080,'Keycloak (stand-in)'),
  'gcp-lb':mkT('Cloud Load Balancing','gcp','gateway',TF,80,'Traefik'),'gcp-gcs':mkT('Cloud Storage','gcp','gcs','fsouza/fake-gcs-server',4443,'fake-gcs-server'),'gcp-sql':mkT('Cloud SQL · PostgreSQL','gcp','sql',PG,5432,'PostgreSQL'),'gcp-pubsub':mkT('Pub/Sub','gcp','pubsub',GCE,8085,'Pub/Sub emulator'),'gcp-memorystore':mkT('Memorystore · Redis','gcp','cache',RD,6379,'Redis'),'gcp-firestore':mkT('Firestore','gcp','firestore',GCE,8080,'Firestore emulator')};
/* tipado como o global que era (Record<string, any>): os geradores indexam-no pelo kind do catálogo (U7p1) */
const KIND: Record<string, any>={
  sql:{env:['POSTGRES_USER: app','POSTGRES_PASSWORD: app','POSTGRES_DB: app'],hc:'pg_isready -U app',vol:'/var/lib/postgresql/data',wire:(s:string)=>[`DATABASE_URL: postgres://app:app@${s}:5432/app`]},
  mssql:{env:['ACCEPT_EULA: "Y"','MSSQL_SA_PASSWORD: ${MSSQL_SA_PASSWORD:-Change_me_123}'],wire:(s:string)=>[`DATABASE_URL: sqlserver://sa:\${MSSQL_SA_PASSWORD:-Change_me_123}@${s}:1433`]},
  cache:{hc:'redis-cli ping',wire:(s:string)=>[`REDIS_URL: redis://${s}:6379`]},amqp:{hc:'rabbitmq-diagnostics -q ping',wire:(s:string)=>[`AMQP_URL: amqp://guest:guest@${s}:5672`]},
  kafka:{wire:(s:string)=>[`KAFKA_BROKERS: ${s}:9092`]},nats:{wire:(s:string)=>[`NATS_URL: nats://${s}:4222`]},
  s3:{cmd:'server /data --console-address ":9001"',env:['MINIO_ROOT_USER: minio','MINIO_ROOT_PASSWORD: minio12345'],vol:'/data',wire:(s:string)=>[`S3_ENDPOINT: http://${s}:9000`,'AWS_ACCESS_KEY_ID: minio','AWS_SECRET_ACCESS_KEY: minio12345','AWS_REGION: us-east-1']},
  dynamo:{wire:(s:string)=>[`DYNAMODB_ENDPOINT: http://${s}:8000`,'AWS_REGION: us-east-1']},sqs:{wire:(s:string)=>[`SQS_ENDPOINT: http://${s}:9324`,'AWS_REGION: us-east-1']},
  blob:{cmd:'azurite-blob --blobHost 0.0.0.0',wire:(s:string)=>[`BLOB_ENDPOINT: http://${s}:10000/devstoreaccount1`]},gcs:{cmd:'-scheme http -port 4443',wire:(s:string)=>[`STORAGE_EMULATOR_HOST: http://${s}:4443`]},
  pubsub:{cmd:'gcloud beta emulators pubsub start --host-port=0.0.0.0:8085',wire:(s:string)=>[`PUBSUB_EMULATOR_HOST: ${s}:8085`]},firestore:{cmd:'gcloud emulators firestore start --host-port=0.0.0.0:8080',wire:(s:string)=>[`FIRESTORE_EMULATOR_HOST: ${s}:8080`]},
  oidc:{cmd:'start-dev',env:['KEYCLOAK_ADMIN: admin','KEYCLOAK_ADMIN_PASSWORD: admin'],wire:(s:string)=>[`OIDC_ISSUER: http://${s}:8080/realms/master`]},otel:{wire:(s:string)=>[`OTEL_EXPORTER_OTLP_ENDPOINT: http://${s}:4317`]},obs:{},
  gateway:{cmd:'--providers.docker=true --providers.docker.exposedbydefault=false --entrypoints.web.address=:80'}};
const isApp=(n:any)=>['app','web'].includes(TECH[n.tech].kind),sl=(n:any)=>slug(n.n),appDir=(n:any)=>(TECH[n.tech].kind==='web'?'web/':'apps/')+sl(n);
export function validateDesign(){const f:any[]=[],deg=(id:string)=>SD.edges.filter(e=>e[0]===id||e[1]===id).length,names:Record<string,number>={};
  SD.nodes.forEach(n=>{const T=TECH[n.tech];if(names[sl(n)])f.push(['e',`Two components are named “${n.n}”. Names become service names and must be unique.`]);names[sl(n)]=1;if(!deg(n.id))f.push(['w',`“${n.n}” is not connected to anything.`]);
    if(!isApp(n)&&T.kind!=='gateway'&&T.kind!=='obs'&&deg(n.id)&&!SD.edges.some(e=>e[1]===n.id&&isApp(SD.nodes.find(x=>x.id===e[0]))))f.push(['w',`No application uses “${n.n}”. Draw the arrow from the app to the resource.`]);
    if(T.kind==='web'&&!SD.edges.some(e=>e[1]===n.id&&TECH[SD.nodes.find(x=>x.id===e[0])!.tech].kind==='gateway'))f.push(['w',`“${n.n}” is not behind a gateway, so it will be published directly.`]);});
  if(SD.nodes.filter(n=>TECH[n.tech].kind==='gateway').length>1)f.push(['w','More than one gateway: only the first one is published on port 8080.']);if(!SD.nodes.some(isApp))f.push(['e','The design has no application to build.']);return f;}

/* ───── corpo da vista Studio (o VIEW.studio registado no fim compõe-no com o selector de drift) ───── */
function renderStudioView(_t:any,host:HTMLElement){host.innerHTML=`<div class="studio"><div class="st-bar"><b style="font-size:14px">Studio</b><button class="mini" id="st-link" data-action="studio:link">${txt("connect")}</button><button class="mini" id="st-clear" title="Remove every component from this design" data-action="studio:clear">Clear design</button><span class="sp"></span><button class="mini pri" data-action="studio:genBacklog">Generate backlog &amp; delegate →</button><button class="mini run" data-action="studio:dxRun">▶ RUN</button></div>
  <div class="st-main"><div class="st-cat" id="st-cat"></div><div class="st-canvas"><svg id="st-svg" viewBox="0 0 760 440" preserveAspectRatio="xMinYMin meet"></svg></div><div class="st-insp" id="st-insp"></div></div></div>`;
  const s=$('#st-svg')!;s.onmousedown=e=>{const g=(e.target as Element).closest('[data-n]') as HTMLElement|null;if(!g){SSEL=null;if(SLINK!==null)SLINK='';drawStudio();return;}const id=g.dataset.n!,n=SD.nodes.find(x=>x.id===id)!,r=s.getBoundingClientRect(),k=760/r.width,ox=(e.clientX-r.left)*k-n.x,oy=(e.clientY-r.top)*k-n.y;let moved=false;
    if(SLINK!==null){if(SLINK==='')SLINK=id;else if(SLINK!==id){if(!SD.edges.some(x=>x[0]===SLINK&&x[1]===id))SD.edges.push([SLINK,id]);SLINK=null;saveSD();}drawStudio();return;}
    const now=Date.now();if(SCLICK.id===id&&now-SCLICK.t<380){sdDel(id);SCLICK.id=null;return;}SCLICK={id,t:now};SSEL=id;
    const mv=(ev:MouseEvent)=>{moved=true;n.x=Math.max(4,Math.min(760-NW-4,(ev.clientX-r.left)*k-ox));n.y=Math.max(4,Math.min(440-NH-4,(ev.clientY-r.top)*k-oy));drawStudio();},up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);if(moved)saveSD();};
    addEventListener('mousemove',mv);addEventListener('mouseup',up);drawStudio();e.preventDefault();};drawStudio();}
function drawStudioBase(){const s=$('#st-svg');if(!s)return;const by=(id:string|null)=>SD.nodes.find(n=>n.id===id);
  $('#st-cat')!.innerHTML=`<div class="st-tabs">${Object.entries(CLOUD).map(([k,c])=>`<button class="${SCAT===k?'on':''}" style="--c:${c.col}" title="${c.t}" data-action="studio:cat" data-on="${esc(k)}">${c.l}</button>`).join('')}</div><div class="st-ct">${CLOUD[SCAT].t}</div>${Object.entries(TECH).filter(([,T])=>T.cloud===SCAT).map(([k,T])=>`<button class="st-tech notr" data-action="studio:add" data-on="${esc(k)}" title="${T.local?'Runs locally as '+T.local:T.img||'Built from a generated Dockerfile'}"><span class="pdot" style="background:${CLOUD[T.cloud].col}"></span>${esc(T.n)}<i>＋</i></button>`).join('')}`;
  const edge=([a,b]:string[])=>{const A=by(a),B=by(b);if(!A||!B)return'';const ax=A.x+NW/2,ay=A.y+NH/2,bx=B.x+NW/2,by2=B.y+NH/2,dx=bx-ax,dy=by2-ay,k=Math.min(Math.abs(dx)?(NW/2+6)/Math.abs(dx):9,Math.abs(dy)?(NH/2+6)/Math.abs(dy):9),pl=A.st!=='ok'||B.st!=='ok';
    return `<line x1="${ax+dx*k}" y1="${ay+dy*k}" x2="${bx-dx*k}" y2="${by2-dy*k}" stroke="${pl?'var(--accent)':'var(--fg-muted)'}" stroke-width="1.6" ${pl?'stroke-dasharray="5 4"':''} marker-end="url(#ar${pl?'p':''})"/>`;};
  s.innerHTML=`<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--fg-muted)"/></marker><marker id="arp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--guide)"/></pattern></defs><rect width="760" height="440" fill="url(#grid)"/>${SD.nodes.length?'':'<text x="380" y="214" text-anchor="middle" fill="var(--fg-muted)" font-size="13">Empty design — add components from the catalog on the left.</text>'}${SD.edges.map(edge).join('')}`+
   SD.nodes.map(n=>{const T=TECH[n.tech],C=CLOUD[T.cloud],pl=n.st==='plan',wip=n.st==='wip',on=SSEL===n.id||SLINK===n.id,cut=(x:string,m:number)=>x.length>m?x.slice(0,m-1)+'…':x;
     return `<g data-n="${n.id}" transform="translate(${n.x} ${n.y})" style="cursor:${SLINK!==null?'crosshair':'grab'}"><rect width="${NW}" height="${NH}" rx="10" fill="var(--bg-elevated)" stroke="${on?'var(--accent)':pl?C.col:'var(--border-strong)'}" stroke-width="${on?2:1.3}" ${pl?'stroke-dasharray="6 4"':''}/><rect width="5" height="${NH-16}" y="8" rx="2.5" fill="${C.col}"/><text x="14" y="17" fill="${C.col}" font-size="8.5" font-weight="700" font-family="var(--font-mono)" letter-spacing=".6">${C.l}</text><text x="${NW-10}" y="17" text-anchor="end" fill="${pl?'var(--accent-hover)':wip?'var(--yellow)':'var(--green)'}" font-size="8.5" font-family="var(--font-mono)">${pl?'planned':wip?'in progress':'built'}</text><text x="14" y="34" fill="var(--fg)" font-size="12.5" font-weight="600" font-family="var(--font-ui)">${esc(cut(n.n,19))}</text><text x="14" y="49" fill="var(--fg-muted)" font-size="10" font-family="var(--font-ui)">${esc(cut(T.n,24))}</text></g>`;}).join('');
  const lb=$('#st-link');if(lb)lb.classList.toggle('pri',SLINK!==null);const n=by(SSEL),ins=$('#st-insp'),fd=validateDesign(),T=n&&TECH[n.tech];
  ins!.innerHTML=SLINK!==null?`<h3>${txt("connect2")}</h3><p>${SLINK===''?'Click the component that depends on another.':'Now click what it depends on.'}</p>`:n?`<h3>${txt("component")}</h3><label>${txt("name")}</label><input class="inp" style="margin:0 0 8px;width:100%" value="${esc(n.n)}" data-action="studio:name" data-on="${esc(n.id)}"><label>${txt("technology")}</label><select data-action="studio:tech" data-on="${esc(n.id)}">${Object.entries(CLOUD).map(([c,C])=>`<optgroup label="${C.t}">${Object.entries(TECH).filter(([,x])=>x.cloud===c).map(([k,x])=>`<option value="${k}"${n.tech===k?' selected':''}>${esc(x.n)}</option>`).join('')}</optgroup>`).join('')}</select>
    <div class="st-kv notr"><span>${isApp(n)?'build':'image'}</span><code>${esc(isApp(n)?'./'+appDir(n):T.img)}</code></div><div class="st-kv"><span>port</span><code>${T.port}</code></div>${T.local?`<div class="st-kv"><span>local</span><code class="notr">${esc(T.local)}</code></div>`:''}
    <label>${txt("status")}</label><select data-action="studio:status" data-on="${esc(n.id)}"><option value="plan"${n.st==='plan'?' selected':''}>${txt("planned")}</option><option value="wip"${n.st==='wip'?' selected':''}>${txt("inProgress")}</option><option value="ok"${n.st==='ok'?' selected':''}>${txt("built")}</option></select>
    <label>${txt("connections")}</label>${SD.edges.map((e,i)=>e[0]===n.id||e[1]===n.id?`<div class="st-e notr">${esc(by(e[0])!.n)} → ${esc(by(e[1])!.n)}<button data-action="studio:unlink" data-on="${i}">×</button></div>`:'').join('')||`<p>${txt("noConnections")}</p>`}<button class="mini" style="margin-top:10px" data-action="studio:del" data-on="${esc(n.id)}">${txt("deleteComponent")}</button>`
    :`<h3>${txt("design")}</h3><p>${txt("eachComponentIsA")} <b>${txt("connect2")}</b> ${txt("toDrawDependenciesApp")}</p><p>${txt("theAssistantsReadThis")} <code>docker-compose.yml</code>${txt("kubernetesManifestsAndThe")}</p><h3 style="margin-top:14px">${txt("validation")}</h3>${fd.length?fd.map(x=>`<div class="st-f ${x[0]}"><span>${x[0]==='e'?'✖':'⚠'}</span><div>${esc(x[1])}</div></div>`).join(''):`<div class="st-f ok"><span>✓</span><div>${txt("theDesignIsConsistent")}</div></div>`}<div class="st-kv" style="margin-top:12px"><span>components</span><code>${SD.nodes.length}</code></div><div class="st-kv"><span>planned</span><code>${SD.nodes.filter(x=>x.st==='plan').length}</code></div>`;}
function sdAdd(tech:string){const id='n'+rid(),k=SD.nodes.length,T=TECH[tech];SD.nodes.push({id,tech,n:T.n.split(' · ')[0].replace(/^(Amazon|Azure|Cloud|Microsoft|Apache) /,'')+' '+(k+1),x:575-(k%3)*14,y:30+(k%3)*128,st:'plan'});SSEL=id;saveSD();drawStudio();}
function sdDel(id:string){SD.nodes=SD.nodes.filter(n=>n.id!==id);SD.edges=SD.edges.filter(e=>e[0]!==id&&e[1]!==id);if(SSEL===id)SSEL=null;saveSD();drawStudio();}

/* ───── design vs realidade / drift (ADR-0004, U4g6 — era a decoração do v6.ts) ─────
   Com um ambiente escolhido em «Compare with…», cada nó ganha a etiqueta do seu estado
   (in sync / drift / behind / missing / failing) e o inspector, sem selecção, abre com o
   resumo «Design vs <ambiente>». */
function paintDrift(): void {
  const env = DRIFT;
  if (!env) return;
  const s = $('#st-svg');
  if (!s) return;
  const r = driftReport(env);
  s.querySelectorAll<SVGGElement>('g[data-n]').forEach(g=>{const x=r.out[g.dataset.n!];if(!x)return;const[c,l]=DSTY[x.st];g.querySelector('rect')!.setAttribute('stroke',c);g.querySelector('rect')!.setAttribute('stroke-dasharray',x.st==='sync'?'':'4 3');const te=g.querySelector('text[text-anchor="end"]');if(te)te.remove();g.insertAdjacentHTML('beforeend',`<rect x="${NW-76}" y="6" width="70" height="14" rx="7" fill="${c}" opacity=".18"/><text x="${NW-41}" y="16.5" text-anchor="middle" fill="${c}" font-size="8.5" font-weight="700" font-family="var(--font-mono)">${l}</text>`);});
  const ins=$('#st-insp');if(ins&&!SSEL&&SLINK===null){const cnt=(k:string)=>Object.values(r.out).filter(x=>x.st===k).length;ins.insertAdjacentHTML('afterbegin',`<h3>Design vs ${ENVL[env]}</h3>${!r.s?`<p>${ENVL[env]} has nothing deployed yet.</p>`:`<p>${cnt('sync')} in sync · ${cnt('drift')+cnt('behind')} drifting · ${cnt('missing')+cnt('bad')} missing or failing</p>${SD.nodes.filter(n=>r.out[n.id].st!=='sync').map(n=>`<div class="st-f ${['bad','missing'].includes(r.out[n.id].st)?'e':'w'}"><span>●</span><div><b class="notr">${esc(n.n)}</b> — <span class="notr">${esc(r.out[n.id].why)}</span></div></div>`).join('')}${r.extra.map(x=>`<div class="st-f w"><span>●</span><div><b class="notr">${esc(x)}</b> — running, but not in the design</div></div>`).join('')}`}<hr style="border:0;border-top:1px solid var(--seam);margin:12px 0">`);}
}
/* o drawStudio já não vai ao window (ADR-0004, U7e): só este módulo o chamava */
function drawStudio(): void { drawStudioBase(); paintDrift(); }

/* acções do Studio (ADR-0004, U5b): eram handlers inline, que resolviam o SD/SSEL/SLINK/SCAT/DRIFT e as
   funções no window ao clicar; as acções fazem o mesmo, no acto. */
const node = (id: string) => SD.nodes.find((x) => x.id === id)!;
const save = (): void => { saveSD(); drawStudio(); };
registerActions({
  ...globalCalls('studio', ['genBacklog', 'dxRun']),
  'studio:link': { click: () => { SLINK = SLINK === null ? '' : null; drawStudio(); } },
  'studio:clear': { click: () => { SD = emptyDesign(); SSEL = null; SLINK = null; save(); } },
  'studio:cat': { click: (c) => { SCAT = c.on; drawStudio(); } },
  'studio:add': { click: (c) => sdAdd(c.on) },
  'studio:name': { change: (c) => { node(c.on).n = c.value; save(); } },
  'studio:tech': { change: (c) => { node(c.on).tech = c.value; save(); } },
  'studio:status': { change: (c) => { node(c.on).st = c.value; save(); } },
  'studio:unlink': { click: (c) => { SD.edges.splice(Number(c.on), 1); save(); } },
  'studio:del': { click: (c) => void sdDel(c.on) },
  'studio:drift': { change: (c) => { DRIFT = c.value || null; drawStudio(); } },
});
VIEW.studio=(t,host)=>{renderStudioView(t,host);const b=host.querySelector('.st-bar .sp');if(b)b.insertAdjacentHTML('beforebegin',`<select class="mini" title="Compare the design with what is running" data-action="studio:drift"><option value="">Compare with…</option>${Object.entries(ENVL).map(([k,l])=>`<option value="${k}"${DRIFT===k?' selected':''}>${l}</option>`).join('')}</select>`);};

/* ── publicar no window: o resíduo do monólito, as camadas v5/v6 e os onclick inline
   resolvem estes nomes livres como globais; drawStudio/SD/SSEL/SLINK/SCAT já estão
   window-backed acima (fonte única). ── */
/* a ponte do Co-Dev e as tarefas (avaliam antes) abrem o Studio pelo registo (ADR-0004, U7h) */
services.studio = { openStudio, TECH, KIND, isApp, sl };

/* lidos por import (ADR-0004, U7e): o arranque, os geradores, a ponte do board e o auto-teste desktop */
export { loadSD, saveSD, appDir, sdAdd, TECH, KIND, isApp, sl };
