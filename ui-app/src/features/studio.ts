// @ts-nocheck
/* ═════════ dxtutor IDE — feature: Studio (catálogo cloud + motor de desenho) ═════════
   Inversão de direcção (padrão Debug/SCM/Ext): o motor Studio, antes espalhado por
   `app.ts` em duas camadas (a morta «desenhar a arquitectura» e a viva «cloud
   technology catalogue»), muda-se INTEIRO para cá. A feature é densa e cruza o
   monólito @ts-nocheck, por isso assume `@ts-nocheck` como `scm.ts`/`debug.ts`.

   Fronteira: a feature DETÉM o catálogo (CLOUD/TECH/KIND/mkT/isApp/sl/appDir),
   o estado do desenho (SD/SSEL/SLINK/SCAT/ST_SEED/NT/NW/NH), as funções do motor
   (saveSD/openStudio/sdAdd/sdDel/validateDesign/drawStudio) e o corpo da vista
   (renderStudioView). Os CONSUMIDORES ficam no monólito e lêem por global:
   os geradores (`composeYaml`/`dockerfile`/`appFiles`/`k8sYaml`/`cloudMap`/
   `genBacklogIssues` em app.ts, `k8sInfra`/`appEnv` em v5.ts) lêem TECH/KIND/
   isApp/sl/appDir; `genBacklog`/`resetAll`/boot lêem SD/ST_SEED/validateDesign/saveSD.

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html), por isso publica estado/funções no `window` no eval — os
   nomes livres do monólito resolvem no escopo GLOBAL em runtime. Nada é lido
   ansiosamente no eval (LS/openTab/genBacklog/dxRun só são tocados DENTRO das
   funções, chamadas depois do arranque). Os primitivos mutáveis SD/SSEL/SLINK/SCAT
   são window-PUROS (sem `let` local): o resíduo e os onclick inline ESCREVEM-nos
   (`SD=clone(ST_SEED)` em resetAll/boot, `SSEL=…`/`SLINK=…`/`SCAT='…'` nos handlers).

   VIEW.studio: `VIEW` nasce em app.ts (eager), que corre DEPOIS desta feature, por
   isso aqui publica-se `window.renderStudioView` e é `v6.ts` (que corre depois de
   app.ts e já decorava a vista com o drift) que estabelece `VIEW.studio` a delegar
   em renderStudioView. `drawStudio` é window-pura e v6 continua a embrulhá-la. */

import { $, esc } from "../core";

/* helpers locais (gémeos puros dos homónimos do monólito; isolados na feature) */
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rid = () => Math.random().toString(16).slice(2, 9);

/* ───── tipos de nó legados (camada «desenhar a arquitectura»): já só os lê código
   morto do backlog no monólito (tplNode/genBacklog$dup0); publicado para não deixar
   referências livres soltas ───── */
const NT={ui:{l:'Interface',ic:'layout-side',col:'#6ea8ff'},svc:{l:'Serviço',ic:'cube',col:'#dea584'},db:{l:'Base de dados',ic:'volume',col:'#5cc9a7'},queue:{l:'Fila',ic:'sync',col:'#e0b64a'},cache:{l:'Cache',ic:'history',col:'#5fcad6'},ext:{l:'Externo',ic:'cloud',col:'#c678dd'}};

/* ───── desenho inicial (o valor final: era um seed legado em app.ts imediatamente
   substituído por Object.assign(ST_SEED,…) da camada do catálogo; aqui fundido) ───── */
const ST_SEED={nodes:[{id:'gw',tech:'aws-alb',n:'Gateway',x:20,y:155,st:'plan'},{id:'web',tech:'react-vite',n:'Web',x:205,y:30,st:'plan'},{id:'api',tech:'rust-axum',n:'Orders API',x:205,y:155,st:'plan'},{id:'q',tech:'aws-sqs',n:'Order Events',x:205,y:290,st:'plan'},{id:'pg',tech:'aws-rds',n:'Orders DB',x:390,y:30,st:'plan'},{id:'cache',tech:'aws-elasticache',n:'Session Cache',x:390,y:155,st:'plan'},{id:'worker',tech:'go-http',n:'Billing Worker',x:390,y:290,st:'plan'},{id:'s3',tech:'aws-s3',n:'Invoices Bucket',x:575,y:290,st:'plan'}],
  edges:[['gw','web'],['gw','api'],['web','api'],['api','pg'],['api','cache'],['api','q'],['worker','q'],['worker','pg'],['worker','s3']]};

/* estado do desenho (window-pure: residue+onclicks escrevem) + geometria dos nós */
window.SD=JSON.parse(JSON.stringify(ST_SEED));window.SSEL=null;window.SLINK=null;window.SCAT='aws';let SCLICK={id:null,t:0};const NW=152,NH=58;
const saveSD=()=>LS.set('studio3',SD);
function openStudio(){openTab({id:'studio',title:'Studio',kind:'studio'});}

/* ───── catálogo de tecnologias cloud ───── */
const CLOUD={app:{l:'APP',col:'#dea584',t:'Application runtimes'},oss:{l:'OSS',col:'#5cc9a7',t:'Open source'},aws:{l:'AWS',col:'#ff9900',t:'Amazon Web Services'},azure:{l:'AZURE',col:'#3a96dd',t:'Microsoft Azure'},gcp:{l:'GCP',col:'#ea4335',t:'Google Cloud'}};
const PG='postgres:16-alpine',RD='redis:7-alpine',TF='traefik:v3.1',KC='quay.io/keycloak/keycloak:25.0',RMQ='rabbitmq:3.13-management-alpine',GCE='gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators';
const mkT=(n,cloud,kind,img,port,local)=>({n,cloud,kind,img,port,local});
const TECH={
  'rust-axum':{n:'Rust · Axum',cloud:'app',kind:'app',port:8080,rt:'rust'},'go-http':{n:'Go · net/http',cloud:'app',kind:'app',port:8080,rt:'go'},'node-express':{n:'Node.js · Express',cloud:'app',kind:'app',port:3000,rt:'node'},'py-fastapi':{n:'Python · FastAPI',cloud:'app',kind:'app',port:8000,rt:'python'},'react-vite':{n:'React · Vite',cloud:'app',kind:'web',port:8080,rt:'web'},
  postgres:mkT('PostgreSQL','oss','sql',PG,5432),redis:mkT('Redis','oss','cache',RD,6379),rabbitmq:mkT('RabbitMQ','oss','amqp',RMQ,5672),kafka:mkT('Apache Kafka','oss','kafka','apache/kafka:3.8.0',9092),nats:mkT('NATS','oss','nats','nats:2.10-alpine',4222),minio:mkT('MinIO','oss','s3','minio/minio',9000),traefik:mkT('Traefik','oss','gateway',TF,80),keycloak:mkT('Keycloak','oss','oidc',KC,8080),prometheus:mkT('Prometheus','oss','obs','prom/prometheus:v2.54.1',9090),grafana:mkT('Grafana','oss','obs','grafana/grafana:11.2.0',3000),otel:mkT('OpenTelemetry Collector','oss','otel','otel/opentelemetry-collector:0.108.0',4317),
  'aws-alb':mkT('Application Load Balancer','aws','gateway',TF,80,'Traefik'),'aws-s3':mkT('Amazon S3','aws','s3','minio/minio',9000,'MinIO'),'aws-rds':mkT('Amazon RDS · PostgreSQL','aws','sql',PG,5432,'PostgreSQL'),'aws-dynamodb':mkT('Amazon DynamoDB','aws','dynamo','amazon/dynamodb-local',8000,'DynamoDB Local'),'aws-sqs':mkT('Amazon SQS','aws','sqs','softwaremill/elasticmq-native',9324,'ElasticMQ'),'aws-elasticache':mkT('Amazon ElastiCache · Redis','aws','cache',RD,6379,'Redis'),'aws-cognito':mkT('Amazon Cognito','aws','oidc',KC,8080,'Keycloak (stand-in)'),
  'az-frontdoor':mkT('Azure Front Door','azure','gateway',TF,80,'Traefik'),'az-blob':mkT('Azure Blob Storage','azure','blob','mcr.microsoft.com/azure-storage/azurite',10000,'Azurite'),'az-sql':mkT('Azure SQL Database','azure','mssql','mcr.microsoft.com/mssql/server:2022-latest',1433,'SQL Server 2022'),'az-servicebus':mkT('Azure Service Bus','azure','amqp',RMQ,5672,'RabbitMQ (stand-in)'),'az-redis':mkT('Azure Cache for Redis','azure','cache',RD,6379,'Redis'),'az-entra':mkT('Microsoft Entra ID','azure','oidc',KC,8080,'Keycloak (stand-in)'),
  'gcp-lb':mkT('Cloud Load Balancing','gcp','gateway',TF,80,'Traefik'),'gcp-gcs':mkT('Cloud Storage','gcp','gcs','fsouza/fake-gcs-server',4443,'fake-gcs-server'),'gcp-sql':mkT('Cloud SQL · PostgreSQL','gcp','sql',PG,5432,'PostgreSQL'),'gcp-pubsub':mkT('Pub/Sub','gcp','pubsub',GCE,8085,'Pub/Sub emulator'),'gcp-memorystore':mkT('Memorystore · Redis','gcp','cache',RD,6379,'Redis'),'gcp-firestore':mkT('Firestore','gcp','firestore',GCE,8080,'Firestore emulator')};
const KIND={
  sql:{env:['POSTGRES_USER: app','POSTGRES_PASSWORD: app','POSTGRES_DB: app'],hc:'pg_isready -U app',vol:'/var/lib/postgresql/data',wire:s=>[`DATABASE_URL: postgres://app:app@${s}:5432/app`]},
  mssql:{env:['ACCEPT_EULA: "Y"','MSSQL_SA_PASSWORD: ${MSSQL_SA_PASSWORD:-Change_me_123}'],wire:s=>[`DATABASE_URL: sqlserver://sa:\${MSSQL_SA_PASSWORD:-Change_me_123}@${s}:1433`]},
  cache:{hc:'redis-cli ping',wire:s=>[`REDIS_URL: redis://${s}:6379`]},amqp:{hc:'rabbitmq-diagnostics -q ping',wire:s=>[`AMQP_URL: amqp://guest:guest@${s}:5672`]},
  kafka:{wire:s=>[`KAFKA_BROKERS: ${s}:9092`]},nats:{wire:s=>[`NATS_URL: nats://${s}:4222`]},
  s3:{cmd:'server /data --console-address ":9001"',env:['MINIO_ROOT_USER: minio','MINIO_ROOT_PASSWORD: minio12345'],vol:'/data',wire:s=>[`S3_ENDPOINT: http://${s}:9000`,'AWS_ACCESS_KEY_ID: minio','AWS_SECRET_ACCESS_KEY: minio12345','AWS_REGION: us-east-1']},
  dynamo:{wire:s=>[`DYNAMODB_ENDPOINT: http://${s}:8000`,'AWS_REGION: us-east-1']},sqs:{wire:s=>[`SQS_ENDPOINT: http://${s}:9324`,'AWS_REGION: us-east-1']},
  blob:{cmd:'azurite-blob --blobHost 0.0.0.0',wire:s=>[`BLOB_ENDPOINT: http://${s}:10000/devstoreaccount1`]},gcs:{cmd:'-scheme http -port 4443',wire:s=>[`STORAGE_EMULATOR_HOST: http://${s}:4443`]},
  pubsub:{cmd:'gcloud beta emulators pubsub start --host-port=0.0.0.0:8085',wire:s=>[`PUBSUB_EMULATOR_HOST: ${s}:8085`]},firestore:{cmd:'gcloud emulators firestore start --host-port=0.0.0.0:8080',wire:s=>[`FIRESTORE_EMULATOR_HOST: ${s}:8080`]},
  oidc:{cmd:'start-dev',env:['KEYCLOAK_ADMIN: admin','KEYCLOAK_ADMIN_PASSWORD: admin'],wire:s=>[`OIDC_ISSUER: http://${s}:8080/realms/master`]},otel:{wire:s=>[`OTEL_EXPORTER_OTLP_ENDPOINT: http://${s}:4317`]},obs:{},
  gateway:{cmd:'--providers.docker=true --providers.docker.exposedbydefault=false --entrypoints.web.address=:80'}};
const isApp=n=>['app','web'].includes(TECH[n.tech].kind),sl=n=>slug(n.n),appDir=n=>(TECH[n.tech].kind==='web'?'web/':'apps/')+sl(n);
function validateDesign(){const f=[],deg=id=>SD.edges.filter(e=>e[0]===id||e[1]===id).length,names={};
  SD.nodes.forEach(n=>{const T=TECH[n.tech];if(names[sl(n)])f.push(['e',`Two components are named “${n.n}”. Names become service names and must be unique.`]);names[sl(n)]=1;if(!deg(n.id))f.push(['w',`“${n.n}” is not connected to anything.`]);
    if(!isApp(n)&&T.kind!=='gateway'&&T.kind!=='obs'&&deg(n.id)&&!SD.edges.some(e=>e[1]===n.id&&isApp(SD.nodes.find(x=>x.id===e[0]))))f.push(['w',`No application uses “${n.n}”. Draw the arrow from the app to the resource.`]);
    if(T.kind==='web'&&!SD.edges.some(e=>e[1]===n.id&&TECH[SD.nodes.find(x=>x.id===e[0]).tech].kind==='gateway'))f.push(['w',`“${n.n}” is not behind a gateway, so it will be published directly.`]);});
  if(SD.nodes.filter(n=>TECH[n.tech].kind==='gateway').length>1)f.push(['w','More than one gateway: only the first one is published on port 8080.']);if(!SD.nodes.some(isApp))f.push(['e','The design has no application to build.']);return f;}

/* ───── corpo da vista Studio (era VIEW.studio; v6.ts estabelece VIEW.studio=>isto) ───── */
function renderStudioView(t,host){host.innerHTML=`<div class="studio"><div class="st-bar"><b style="font-size:14px">Studio</b><button class="mini" id="st-link" onclick="SLINK=SLINK===null?'':null;drawStudio()">⤳ Connect</button><button class="mini" onclick="SD=JSON.parse(JSON.stringify(ST_SEED));SSEL=null;saveSD();drawStudio()">Reset design</button><span class="sp"></span><button class="mini pri" onclick="genBacklog()">Generate backlog &amp; delegate →</button><button class="mini run" onclick="dxRun()">▶ RUN</button></div>
  <div class="st-main"><div class="st-cat" id="st-cat"></div><div class="st-canvas"><svg id="st-svg" viewBox="0 0 760 440" preserveAspectRatio="xMinYMin meet"></svg></div><div class="st-insp" id="st-insp"></div></div></div>`;
  const s=$('#st-svg');s.onmousedown=e=>{const g=e.target.closest('[data-n]');if(!g){SSEL=null;if(SLINK!==null)SLINK='';drawStudio();return;}const id=g.dataset.n,n=SD.nodes.find(x=>x.id===id),r=s.getBoundingClientRect(),k=760/r.width,ox=(e.clientX-r.left)*k-n.x,oy=(e.clientY-r.top)*k-n.y;let moved=false;
    if(SLINK!==null){if(SLINK==='')SLINK=id;else if(SLINK!==id){if(!SD.edges.some(x=>x[0]===SLINK&&x[1]===id))SD.edges.push([SLINK,id]);SLINK=null;saveSD();}drawStudio();return;}
    const now=Date.now();if(SCLICK.id===id&&now-SCLICK.t<380){sdDel(id);SCLICK.id=null;return;}SCLICK={id,t:now};SSEL=id;
    const mv=ev=>{moved=true;n.x=Math.max(4,Math.min(760-NW-4,(ev.clientX-r.left)*k-ox));n.y=Math.max(4,Math.min(440-NH-4,(ev.clientY-r.top)*k-oy));drawStudio();},up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);if(moved)saveSD();};
    addEventListener('mousemove',mv);addEventListener('mouseup',up);drawStudio();e.preventDefault();};drawStudio();}
window.drawStudio = function(){const s=$('#st-svg');if(!s)return;const by=id=>SD.nodes.find(n=>n.id===id);
  $('#st-cat').innerHTML=`<div class="st-tabs">${Object.entries(CLOUD).map(([k,c])=>`<button class="${SCAT===k?'on':''}" style="--c:${c.col}" title="${c.t}" onclick="SCAT='${k}';drawStudio()">${c.l}</button>`).join('')}</div><div class="st-ct">${CLOUD[SCAT].t}</div>${Object.entries(TECH).filter(([,T])=>T.cloud===SCAT).map(([k,T])=>`<button class="st-tech notr" onclick="sdAdd('${k}')" title="${T.local?'Runs locally as '+T.local:T.img||'Built from a generated Dockerfile'}"><span class="pdot" style="background:${CLOUD[T.cloud].col}"></span>${esc(T.n)}<i>＋</i></button>`).join('')}`;
  const edge=([a,b])=>{const A=by(a),B=by(b);if(!A||!B)return'';const ax=A.x+NW/2,ay=A.y+NH/2,bx=B.x+NW/2,by2=B.y+NH/2,dx=bx-ax,dy=by2-ay,k=Math.min(Math.abs(dx)?(NW/2+6)/Math.abs(dx):9,Math.abs(dy)?(NH/2+6)/Math.abs(dy):9),pl=A.st!=='ok'||B.st!=='ok';
    return `<line x1="${ax+dx*k}" y1="${ay+dy*k}" x2="${bx-dx*k}" y2="${by2-dy*k}" stroke="${pl?'var(--accent)':'var(--fg-muted)'}" stroke-width="1.6" ${pl?'stroke-dasharray="5 4"':''} marker-end="url(#ar${pl?'p':''})"/>`;};
  s.innerHTML=`<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--fg-muted)"/></marker><marker id="arp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--guide)"/></pattern></defs><rect width="760" height="440" fill="url(#grid)"/>${SD.edges.map(edge).join('')}`+
   SD.nodes.map(n=>{const T=TECH[n.tech],C=CLOUD[T.cloud],pl=n.st==='plan',wip=n.st==='wip',on=SSEL===n.id||SLINK===n.id,cut=(x,m)=>x.length>m?x.slice(0,m-1)+'…':x;
     return `<g data-n="${n.id}" transform="translate(${n.x} ${n.y})" style="cursor:${SLINK!==null?'crosshair':'grab'}"><rect width="${NW}" height="${NH}" rx="10" fill="var(--bg-elevated)" stroke="${on?'var(--accent)':pl?C.col:'var(--border-strong)'}" stroke-width="${on?2:1.3}" ${pl?'stroke-dasharray="6 4"':''}/><rect width="5" height="${NH-16}" y="8" rx="2.5" fill="${C.col}"/><text x="14" y="17" fill="${C.col}" font-size="8.5" font-weight="700" font-family="var(--font-mono)" letter-spacing=".6">${C.l}</text><text x="${NW-10}" y="17" text-anchor="end" fill="${pl?'var(--accent-hover)':wip?'var(--yellow)':'var(--green)'}" font-size="8.5" font-family="var(--font-mono)">${pl?'planned':wip?'in progress':'built'}</text><text x="14" y="34" fill="var(--fg)" font-size="12.5" font-weight="600" font-family="var(--font-ui)">${esc(cut(n.n,19))}</text><text x="14" y="49" fill="var(--fg-muted)" font-size="10" font-family="var(--font-ui)">${esc(cut(T.n,24))}</text></g>`;}).join('');
  const lb=$('#st-link');if(lb)lb.classList.toggle('pri',SLINK!==null);const n=by(SSEL),ins=$('#st-insp'),fd=validateDesign(),T=n&&TECH[n.tech];
  ins.innerHTML=SLINK!==null?`<h3>Connect</h3><p>${SLINK===''?'Click the component that depends on another.':'Now click what it depends on.'}</p>`:n?`<h3>Component</h3><label>Name</label><input class="inp" style="margin:0 0 8px;width:100%" value="${esc(n.n)}" onchange="SD.nodes.find(x=>x.id==='${n.id}').n=this.value;saveSD();drawStudio()"><label>Technology</label><select onchange="SD.nodes.find(x=>x.id==='${n.id}').tech=this.value;saveSD();drawStudio()">${Object.entries(CLOUD).map(([c,C])=>`<optgroup label="${C.t}">${Object.entries(TECH).filter(([,x])=>x.cloud===c).map(([k,x])=>`<option value="${k}"${n.tech===k?' selected':''}>${esc(x.n)}</option>`).join('')}</optgroup>`).join('')}</select>
    <div class="st-kv notr"><span>${isApp(n)?'build':'image'}</span><code>${esc(isApp(n)?'./'+appDir(n):T.img)}</code></div><div class="st-kv"><span>port</span><code>${T.port}</code></div>${T.local?`<div class="st-kv"><span>local</span><code class="notr">${esc(T.local)}</code></div>`:''}
    <label>Status</label><select onchange="SD.nodes.find(x=>x.id==='${n.id}').st=this.value;saveSD();drawStudio()"><option value="plan"${n.st==='plan'?' selected':''}>Planned</option><option value="wip"${n.st==='wip'?' selected':''}>In progress</option><option value="ok"${n.st==='ok'?' selected':''}>Built</option></select>
    <label>Connections</label>${SD.edges.map((e,i)=>e[0]===n.id||e[1]===n.id?`<div class="st-e notr">${esc(by(e[0]).n)} → ${esc(by(e[1]).n)}<button onclick="SD.edges.splice(${i},1);saveSD();drawStudio()">×</button></div>`:'').join('')||'<p>No connections.</p>'}<button class="mini" style="margin-top:10px" onclick="sdDel('${n.id}')">Delete component</button>`
    :`<h3>Design</h3><p>Each component is a technology. Pick one from the catalogue, drag it, and use <b>Connect</b> to draw dependencies (app → resource). Double-click deletes.</p><p>The assistants read this design to generate the project: source skeletons, Dockerfiles, <code>docker-compose.yml</code>, Kubernetes manifests and the wiring between services.</p><h3 style="margin-top:14px">Validation</h3>${fd.length?fd.map(x=>`<div class="st-f ${x[0]}"><span>${x[0]==='e'?'✖':'⚠'}</span><div>${esc(x[1])}</div></div>`).join(''):'<div class="st-f ok"><span>✓</span><div>The design is consistent.</div></div>'}<div class="st-kv" style="margin-top:12px"><span>components</span><code>${SD.nodes.length}</code></div><div class="st-kv"><span>planned</span><code>${SD.nodes.filter(x=>x.st==='plan').length}</code></div>`;}
function sdAdd(tech){const id='n'+rid(),k=SD.nodes.length,T=TECH[tech];SD.nodes.push({id,tech,n:T.n.split(' · ')[0].replace(/^(Amazon|Azure|Cloud|Microsoft|Apache) /,'')+' '+(k+1),x:575-(k%3)*14,y:30+(k%3)*128,st:'plan'});SSEL=id;saveSD();drawStudio();}
function sdDel(id){SD.nodes=SD.nodes.filter(n=>n.id!==id);SD.edges=SD.edges.filter(e=>e[0]!==id&&e[1]!==id);if(SSEL===id)SSEL=null;saveSD();drawStudio();}

/* ── publicar no window: o resíduo do monólito, as camadas v5/v6 e os onclick inline
   resolvem estes nomes livres como globais; drawStudio/SD/SSEL/SLINK/SCAT já estão
   window-backed acima (fonte única). ── */
Object.assign(window, { NT, ST_SEED, NW, NH, CLOUD, TECH, KIND, mkT, isApp, sl, appDir, saveSD, openStudio, sdAdd, sdDel, validateDesign, renderStudioView });
