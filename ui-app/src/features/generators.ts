// @ts-nocheck
/* ═════════ dxtutor IDE — feature: geradores de projecto (design → stack executável) ═════════
   Inversão de direcção (padrão Debug/SCM/Ext/Board): os 5 geradores que transformam o
   desenho do Studio num projecto corrível — composeYaml/dockerfile/appFiles/k8sYaml/
   cloudMap — mudam-se inteiros de `app.ts` para cá. Como cruzam o monólito @ts-nocheck
   (lêem TECH/KIND/sl/isApp/appDir/has/ROOT/esc por global), a feature assume `@ts-nocheck`
   como scm.ts/board.ts (são funções puras → tipam-se depois).

   Fronteira: esta feature DETÉM as defs; o único consumidor (`features/board.ts`,
   genBacklogIssues) lê-as por global. São funções PURAS e late-bound — nada lido
   ansiosamente no eval → publicam-se no `window` no fim (Object.assign), sem hidratação.
   Esta feature avalia ANTES de `app.ts` (ordem do index.html), mas os geradores só correm
   em runtime (genBacklog, muito depois do arranque) → TECH/KIND/sl/isApp/appDir (studio.ts)
   e has/ROOT/esc (app.ts) já estão no window quando chamados.

   `slug` é léxico em app.ts (NÃO publicado) e studio.ts/board.ts têm a sua cópia local;
   composeYaml também precisa dele → cópia local idêntica. `appFiles`→`dockerfile` é uma
   chamada interna (resolve léxica dentro do módulo). GOTCHA C: as 5 defs saíram também do
   `Object.assign(window,…)` de app.ts. */

import { esc } from "../core";

const slug=s=>String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function composeYaml(D,bad){const by=id=>D.nodes.find(n=>n.id===id),deps=n=>D.edges.filter(e=>e[0]===n.id).map(e=>by(e[1])).filter(Boolean),gw=D.nodes.find(n=>TECH[n.tech].kind==='gateway'),L=['# Generated from the Studio design. Managed cloud services run as local stand-ins.','name: '+slug(D.name||'dxtutor-app'),'','services:'],vols=[];
  D.nodes.forEach(n=>{const T=TECH[n.tech],K=KIND[T.kind]||{},s=sl(n),ds=deps(n).filter(d=>TECH[d.tech].kind!=='gateway');L.push(`  ${s}:`);
    if(isApp(n)){L.push(`    build: ./${appDir(n)}`);const env=[`PORT: "${T.port}"`];ds.forEach(d=>{const DK=KIND[TECH[d.tech].kind];if(DK&&DK.wire)env.push(...DK.wire(sl(d)));else if(isApp(d))env.push(`${sl(d).toUpperCase().replace(/-/g,'_')}_URL: http://${sl(d)}:${TECH[d.tech].port}`);});
      L.push('    environment:',...[...new Set(env)].map(e=>'      '+e));const routed=gw&&D.edges.some(e=>e[0]===gw.id&&e[1]===n.id);
      if(routed){const web=T.kind==='web';L.push('    labels:','      - traefik.enable=true',`      - traefik.http.routers.${s}.rule=PathPrefix(\`${web?'/':'/'+s}\`)`,`      - traefik.http.services.${s}.loadbalancer.server.port=${T.port}`);if(!web)L.push(`      - traefik.http.middlewares.${s}-strip.stripprefix.prefixes=/${s}`,`      - traefik.http.routers.${s}.middlewares=${s}-strip`);}
      else L.push('    ports:',`      - "${T.port+D.nodes.filter(isApp).indexOf(n)*10}:${T.port}"`);}
    else{L.push(`    image: ${T.img}`);if(K.cmd)L.push(`    command: ${K.cmd}`);if(K.env)L.push('    environment:',...K.env.map(e=>'      '+e));
      if(T.kind==='gateway')L.push('    ports:','      - "8080:80"','    volumes:','      - /var/run/docker.sock:/var/run/docker.sock:ro');
      if(K.vol){vols.push(s+'-data');L.push('    volumes:',`      - ${s}-data:${K.vol}`);}
      if(K.hc)L.push('    healthcheck:',`      test: ["CMD-SHELL", "${K.hc}"]`,'      interval: 5s','      timeout: 3s','      retries: 12');}
    if(ds.length){L.push('    depends_on:');ds.forEach(d=>{const h=!bad&&(KIND[TECH[d.tech].kind]||{}).hc;L.push(h?`      ${sl(d)}:\n        condition: service_healthy`:bad?`      - ${sl(d)}`:`      ${sl(d)}:\n        condition: service_started`);});}
    L.push('    restart: unless-stopped','');});
  if(vols.length)L.push('volumes:',...vols.map(v=>`  ${v}:`),'');return L.join('\n');}
function dockerfile(n,bad){const T=TECH[n.tech],s=sl(n).replace(/-/g,'_');return({
  rust:`# ${n.n} — ${T.n}\nFROM rust:1.82-slim AS build\nWORKDIR /app\nCOPY Cargo.toml ./\nCOPY src ./src\nRUN cargo build --release\n\nFROM debian:bookworm-slim\n${bad?'':'RUN useradd --system --uid 10001 app\n'}COPY --from=build /app/target/release/${s} /usr/local/bin/app\n${bad?'':'USER app\n'}ENV PORT=${T.port}\nEXPOSE ${T.port}\nCMD ["app"]\n`,
  go:`# ${n.n} — ${T.n}\nFROM golang:1.23-alpine AS build\nWORKDIR /app\nCOPY go.mod ./\nCOPY src ./src\nRUN CGO_ENABLED=0 go build -o /out/app ./src\n\nFROM gcr.io/distroless/static-debian12:nonroot\nCOPY --from=build /out/app /app\nUSER nonroot\nENV PORT=${T.port}\nEXPOSE ${T.port}\nENTRYPOINT ["/app"]\n`,
  node:`# ${n.n} — ${T.n}\nFROM node:22-alpine AS build\nWORKDIR /app\nCOPY package.json ./\nRUN npm install --omit=dev\nCOPY src ./src\n\nFROM node:22-alpine\nWORKDIR /app\nCOPY --from=build /app ./\nUSER node\nENV PORT=${T.port}\nEXPOSE ${T.port}\nCMD ["node", "src/server.js"]\n`,
  python:`# ${n.n} — ${T.n}\nFROM python:3.12-slim AS build\nWORKDIR /app\nCOPY requirements.txt ./\nRUN pip install --no-cache-dir --prefix=/install -r requirements.txt\n\nFROM python:3.12-slim\nRUN useradd --system --uid 10001 app\nWORKDIR /app\nCOPY --from=build /install /usr/local\nCOPY src ./src\nUSER app\nENV PORT=${T.port}\nEXPOSE ${T.port}\nCMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port $PORT"]\n`,
  web:`# ${n.n} — ${T.n}\nFROM node:22-alpine AS build\nWORKDIR /app\nCOPY package.json ./\nRUN npm install\nCOPY . .\nRUN npm run build\n\nFROM nginxinc/nginx-unprivileged:1.27-alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE ${T.port}\n`})[T.rt];}
function appFiles(n,D,bad){const T=TECH[n.tech],d=ROOT+appDir(n)+'/',s=sl(n),rs=s.replace(/-/g,'_'),deps=D.edges.filter(e=>e[0]===n.id).map(e=>D.nodes.find(x=>x.id===e[1])),envs=[...new Set(deps.flatMap(x=>{const K=KIND[TECH[x.tech].kind];return K&&K.wire?K.wire(sl(x)).map(w=>w.split(':')[0]):[];}))],df={p:d+'Dockerfile',content:dockerfile(n,bad),fix:bad?dockerfile(n,false):null,fixNote:'add a non-root <code>USER</code> to the runtime image',tests:[{n:`docker::${rs}_is_multi_stage`,fn:()=>has(d+'Dockerfile',/ AS build/)},{n:`docker::${rs}_runs_as_non_root`,fn:()=>has(d+'Dockerfile',/^USER |nginx-unprivileged/m)}]};
  if(T.rt==='rust')return[{p:d+'Cargo.toml',content:`[package]\nname = "${rs}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["full"] }\n`},{p:d+'src/main.rs',content:`// ${n.n} — generated from the Studio design.\nuse axum::{routing::get, Router};\n\n#[tokio::main]\nasync fn main() {\n    let port = std::env::var("PORT").unwrap_or_else(|_| "${T.port}".into());\n${envs.map(e=>`    let _${e.toLowerCase()} = std::env::var("${e}").expect("${e} is required");\n`).join('')}    let app = Router::new().route("/healthz", get(|| async { "ok" }));\n    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.unwrap();\n    axum::serve(listener, app).await.unwrap();\n}\n`},df];
  if(T.rt==='go')return[{p:d+'go.mod',content:`module ${s}\n\ngo 1.23\n`},{p:d+'src/main.go',content:`// ${n.n} — generated from the Studio design.\npackage main\n\nimport (\n\t"log"\n\t"net/http"\n\t"os"\n)\n\nfunc main() {\n${envs.map(e=>`\tif os.Getenv("${e}") == "" {\n\t\tlog.Fatal("${e} is required")\n\t}\n`).join('')}\thttp.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })\n\tlog.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), nil))\n}\n`},df];
  if(T.rt==='node')return[{p:d+'package.json',content:`{\n  "name": "${s}",\n  "version": "0.1.0",\n  "dependencies": { "express": "^4.19.2" }\n}\n`},{p:d+'src/server.js',content:`// ${n.n} — generated from the Studio design.\nconst express = require("express");\n${envs.map(e=>`if (!process.env.${e}) throw new Error("${e} is required");\n`).join('')}const app = express();\napp.get("/healthz", (_req, res) => res.send("ok"));\napp.listen(process.env.PORT || ${T.port});\n`},df];
  if(T.rt==='python')return[{p:d+'requirements.txt',content:'fastapi==0.115.0\nuvicorn==0.30.6\n'},{p:d+'src/main.py',content:`# ${n.n} — generated from the Studio design.\nimport os\nfrom fastapi import FastAPI\n\n${envs.map(e=>`${e} = os.environ["${e}"]\n`).join('')}app = FastAPI()\n\n\n@app.get("/healthz")\ndef healthz() -> str:\n    return "ok"\n`},df];
  const api=deps.find(x=>TECH[x.tech].kind==='app');return[{p:d+'package.json',content:`{\n  "name": "${s}",\n  "private": true,\n  "scripts": { "dev": "vite", "build": "vite build" },\n  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },\n  "devDependencies": { "vite": "^5.4.8", "@vitejs/plugin-react": "^4.3.2" }\n}\n`},{p:d+'index.html',content:`<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><title>${esc(n.n)}</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"><\/script></body>\n</html>\n`},
    {p:d+'src/main.jsx',content:`// ${n.n} — generated from the Studio design.\nimport { createRoot } from "react-dom/client";\n\nconst API = "${api?'/'+sl(api):''}";\n\nfunction App() {\n  return (\n    <main style={{ borderTop: "2px solid ${bad?'#33aaff':'var(--accent)'}" }}>\n      <h1>${esc(n.n)}</h1>\n      <p>API: {API || "none"}</p>\n    </main>\n  );\n}\n\ncreateRoot(document.getElementById("root")).render(<App />);\n`},{p:d+'Dockerfile',content:dockerfile(n,false)}];}
function k8sYaml(n){const s=sl(n),T=TECH[n.tech];return `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${s}\nspec:\n  replicas: 2\n  selector:\n    matchLabels: { app: ${s} }\n  template:\n    metadata:\n      labels: { app: ${s} }\n    spec:\n      containers:\n        - name: ${s}\n          image: registry.example.com/${s}:0.1.0\n          ports: [{ containerPort: ${T.port} }]\n          envFrom: [{ secretRef: { name: ${s}-env } }]\n          readinessProbe:\n            httpGet: { path: ${T.kind==='web'?'/':'/healthz'}, port: ${T.port} }\n          securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${s}\nspec:\n  selector: { app: ${s} }\n  ports: [{ port: 80, targetPort: ${T.port} }]\n`;}
function cloudMap(D){return `# Cloud mapping\n\nWhat each component is in the cloud and what stands in for it on your machine.\n\n| Component | Technology | Runs locally as | Image |\n|---|---|---|---|\n${D.nodes.map(n=>{const T=TECH[n.tech];return `| ${n.n} | ${T.n} | ${isApp(n)?'built from '+appDir(n)+'/Dockerfile':T.local||T.n} | ${isApp(n)?'—':T.img} |`;}).join('\n')}\n\nIn production, point the same environment variables at the managed services and remove the stand-ins from the compose file.\n`;}

Object.assign(window, { composeYaml, dockerfile, appFiles, k8sYaml, cloudMap });
