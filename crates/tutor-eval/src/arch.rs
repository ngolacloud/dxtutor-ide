//! Architecture Studio — modelo de System Design + **validação da arquitectura**.
//!
//! Dois tipos de desenho no mesmo modelo:
//!
//! - **Orientado a eventos** (serviços, lojas, brokers, consumidores, relays): as regras
//!   apanham erros estruturais ANTES de gerar código — um outbox sem relay que o publique,
//!   um evento publicado que ninguém consome, uma subscrição a um evento que ninguém emite,
//!   um broker pendurado. É o que o scaffold materializa.
//! - **Arquitectura de sistema** (cli, daemon, runtime, kernel…): diagramas internos com
//!   fronteiras aninhadas (`groups`), setas com protocolo e estilo, e até dois painéis
//!   comparativos (`views`). As regras verificam a estrutura (grupos, painéis) e as
//!   afirmações do desenho (`daemonless`, `strict` = cada elemento tem a sua fonte no código).
//!
//! Retrocompatível: todos os campos novos são opcionais e só se serializam quando têm
//! valor — um desenho antigo (só eventos) entra e sai byte-idêntico e valida como antes.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub mod mermaid;

/// Tipo de um componente no diagrama.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    // ── desenho orientado a eventos (os únicos que o scaffold materializa) ──
    Service,
    Store,
    Broker,
    Consumer,
    Relay,
    Gateway,
    // ── arquitectura de sistema ──
    /// Linha de comandos (ex.: `docker`, `kubectl`).
    Cli,
    /// Processo de longa ou curta duração (ex.: o API server, um contentor).
    Process,
    /// Serviço em segundo plano (ex.: `dockerd`, `kubelet`).
    Daemon,
    /// Runtime de execução (ex.: `containerd`, `runc`).
    Runtime,
    /// Socket (unix ou TCP) como ponto de encontro.
    Socket,
    /// Estado persistido em ficheiros/JSON (ex.: um manifesto, um store de estado).
    State,
    /// O kernel (a faixa de base do diagrama).
    Kernel,
    /// Sistema externo fora do nosso controlo.
    External,
    /// Cliente que faz pedidos (browser, utilizador).
    Client,
    /// Trabalhador (ex.: um pod, um worker de fila).
    Worker,
    /// Porta exposta / Service de rede.
    Port,
    /// Adaptador (ex.: um ingress, um shim).
    Adapter,
}

impl Kind {
    /// Os Kind do desenho orientado a eventos: as regras antigas e o scaffold só olham
    /// para estes.
    pub fn is_event(self) -> bool {
        matches!(
            self,
            Kind::Service
                | Kind::Store
                | Kind::Broker
                | Kind::Consumer
                | Kind::Relay
                | Kind::Gateway
        )
    }
}

/// Um componente (nó) do desenho.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Component {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    /// Marca uma `Store` como tabela de outbox (escrita transaccional + relay a publicar).
    #[serde(default)]
    pub outbox: bool,
    /// O grupo (fronteira) onde o componente vive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// Mini-bloco de código mostrado por baixo do nome (ex.: `docker run nginx`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Onde o elemento foi confirmado no código (ficheiro, crate, módulo).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl Component {
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: Kind) -> Self {
        Component {
            id: id.into(),
            name: name.into(),
            kind,
            outbox: false,
            group: None,
            code: None,
            source: None,
        }
    }
}

/// Como dois componentes do desenho de eventos se ligam (aresta).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Relation {
    Writes,    // service → store
    Reads,     // relay/service → store
    Publishes, // service/relay → broker (produz um evento)
    Consumes,  // consumer → broker (subscreve um evento)
    RoutesTo,  // broker → consumer (routing key)
}

/// Por onde passa uma seta do diagrama de sistema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    Grpc,
    Http,
    UnixSocket,
    ForkExec,
    Syscall,
    Fs,
    Ssh,
    Event,
}

/// O que uma seta significa: controlo (cor do painel), dados/pedidos (verde) ou opcional.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeStyle {
    Control,
    Data,
    Optional,
}

/// Uma ligação. No desenho de eventos tem `relation` (e opcionalmente `event`); no de
/// sistema tem `protocol`/`style`/`label`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Connection {
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<Relation>,
    #[serde(default)]
    pub event: String,
    /// Rótulo da seta (só quando o significado não é óbvio: «gRPC CRI», «fork»).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<Protocol>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<EdgeStyle>,
    /// Onde a ligação foi confirmada no código.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl Connection {
    /// Uma ligação do desenho de eventos.
    pub fn new(
        from: impl Into<String>,
        to: impl Into<String>,
        relation: Relation,
        event: impl Into<String>,
    ) -> Self {
        Connection {
            relation: Some(relation),
            event: event.into(),
            ..Connection::link(from, to)
        }
    }

    /// Uma seta do diagrama de sistema, sem relação de eventos.
    pub fn link(from: impl Into<String>, to: impl Into<String>) -> Self {
        Connection {
            from: from.into(),
            to: to.into(),
            relation: None,
            event: String::new(),
            label: None,
            protocol: None,
            style: None,
            source: None,
        }
    }

    fn is(&self, r: Relation) -> bool {
        self.relation == Some(r)
    }
}

/// Tipo de uma fronteira lógica.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroupKind {
    Host,
    Plane,
    Node,
    Module,
    Layer,
    Boundary,
}

/// Contorno da fronteira.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroupStyle {
    #[default]
    Dashed,
    Solid,
}

/// Uma fronteira lógica (Host, Control Plane, Node, Módulo, Camada), aninhável.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Group {
    pub id: String,
    pub label: String,
    pub kind: GroupKind,
    /// O grupo que contém este (`None` = grupo raiz).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default)]
    pub style: GroupStyle,
    /// Onde a fronteira foi confirmada no código.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Um painel do modo comparativo («A» vs «B»): título, cor e os grupos raiz que mostra.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct View {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub roots: Vec<String>,
    /// O painel afirma que não há daemon: avisa se desenhar um.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub daemonless: bool,
    /// Painel estrito: cada caixa e cada seta tem de dizer onde foi confirmada (`source`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub strict: bool,
}

/// O desenho completo.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Architecture {
    #[serde(default)]
    pub components: Vec<Component>,
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<Group>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub views: Vec<View>,
}

/// Gravidade de um achado de validação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Error,
    Warning,
}

/// Um achado de validação, ancorado num componente quando aplicável.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    pub rule: String,
    pub message: String,
    #[serde(default)]
    pub component: String,
}

impl Architecture {
    fn get(&self, id: &str) -> Option<&Component> {
        self.components.iter().find(|c| c.id == id)
    }

    fn group(&self, id: &str) -> Option<&Group> {
        self.groups.iter().find(|g| g.id == id)
    }

    /// A cadeia de grupos de `id` até à raiz (incluindo `id`). Pára num ciclo ou num pai
    /// desconhecido — essas falhas são achados próprios, aqui só não se pode entrar em laço.
    fn group_chain<'a>(&'a self, id: &'a str) -> Vec<&'a str> {
        let mut chain = Vec::new();
        let mut cur = Some(id);
        while let Some(g) = cur {
            if chain.contains(&g) || self.group(g).is_none() {
                break;
            }
            chain.push(g);
            cur = self.group(g).and_then(|x| x.parent.as_deref());
        }
        chain
    }

    /// O painel (view) que mostra o grupo `id`: o primeiro cujas raízes incluem o grupo ou
    /// um dos seus antepassados.
    fn view_of_group(&self, id: &str) -> Option<&View> {
        let chain = self.group_chain(id);
        self.views
            .iter()
            .find(|v| v.roots.iter().any(|r| chain.contains(&r.as_str())))
    }

    /// O painel onde um componente vive (pelo seu grupo). `None` sem grupo ou fora de painéis.
    fn view_of_component(&self, id: &str) -> Option<&View> {
        let g = self.get(id)?.group.as_deref()?;
        self.view_of_group(g)
    }

    /// Regras do diagrama de sistema: estrutura dos grupos e dos painéis, e as afirmações
    /// de cada painel (`daemonless`, `strict`). Sem grupos nem painéis, não acrescenta nada.
    fn validate_system(&self, out: &mut Vec<Finding>) {
        let err = |rule: &str, message: String, at: &str| Finding {
            severity: Severity::Error,
            rule: rule.into(),
            message,
            component: at.into(),
        };
        let warn = |rule: &str, message: String, at: &str| Finding {
            severity: Severity::Warning,
            rule: rule.into(),
            message,
            component: at.into(),
        };

        // Pai desconhecido.
        for g in &self.groups {
            if let Some(p) = &g.parent {
                if self.group(p).is_none() {
                    out.push(err(
                        "group-unknown-parent",
                        format!("group `{}` is inside unknown group `{p}`", g.label),
                        &g.id,
                    ));
                }
            }
        }

        // Ciclos: um grupo não se pode conter a si próprio (directa ou indirectamente).
        // Um achado por ciclo, ancorado no menor id do ciclo.
        let parent: HashMap<&str, &str> = self
            .groups
            .iter()
            .filter_map(|g| g.parent.as_deref().map(|p| (g.id.as_str(), p)))
            .collect();
        let mut reported: HashSet<&str> = HashSet::new();
        for g in &self.groups {
            let start = g.id.as_str();
            if reported.contains(start) {
                continue;
            }
            let mut seen = vec![start];
            let mut cur = parent.get(start).copied();
            while let Some(p) = cur {
                if p == start {
                    let mut members = seen.clone();
                    members.sort_unstable();
                    reported.extend(members.iter().copied());
                    out.push(err(
                        "group-cycle",
                        format!("groups contain themselves: {}", members.join(" → ")),
                        members[0],
                    ));
                    break;
                }
                if seen.contains(&p) {
                    break; // ciclo mais acima, que não passa por `start`
                }
                seen.push(p);
                cur = parent.get(p).copied();
            }
        }

        // Componente num grupo que não existe.
        for c in &self.components {
            if let Some(g) = &c.group {
                if self.group(g).is_none() {
                    out.push(err(
                        "component-in-unknown-group",
                        format!("component `{}` is in unknown group `{g}`", c.name),
                        &c.id,
                    ));
                }
            }
        }

        // Painel com uma raiz que não existe.
        for v in &self.views {
            for r in &v.roots {
                if self.group(r).is_none() {
                    out.push(err(
                        "view-unknown-group",
                        format!("panel `{}` shows unknown group `{r}`", v.title),
                        r,
                    ));
                }
            }
        }

        // Uma seta não liga painéis diferentes (salvo se for opcional).
        for cn in &self.connections {
            if cn.style == Some(EdgeStyle::Optional) {
                continue;
            }
            if let (Some(a), Some(b)) = (
                self.view_of_component(&cn.from),
                self.view_of_component(&cn.to),
            ) {
                if a.id != b.id {
                    out.push(err(
                        "edge-crosses-panel",
                        format!(
                            "connection `{}` → `{}` links panel `{}` to panel `{}`; mark it optional or remove it",
                            cn.from, cn.to, a.title, b.title
                        ),
                        &cn.from,
                    ));
                }
            }
        }

        // Afirmações de cada painel.
        for v in &self.views {
            let in_view =
                |c: &Component| self.view_of_component(&c.id).is_some_and(|x| x.id == v.id);
            if v.daemonless {
                for c in self
                    .components
                    .iter()
                    .filter(|c| c.kind == Kind::Daemon && in_view(c))
                {
                    out.push(warn(
                        "daemonless-claim",
                        format!(
                            "panel `{}` claims to be daemonless but draws daemon `{}`",
                            v.title, c.name
                        ),
                        &c.id,
                    ));
                }
            }
            if v.strict {
                let missing =
                    |src: &Option<String>| src.as_deref().is_none_or(|s| s.trim().is_empty());
                for g in self
                    .groups
                    .iter()
                    .filter(|g| self.view_of_group(&g.id).is_some_and(|x| x.id == v.id))
                {
                    if missing(&g.source) {
                        out.push(warn(
                            "unconfirmed-element",
                            format!("box `{}` in panel `{}` has no source: confirm it in the code or remove it", g.label, v.title),
                            &g.id,
                        ));
                    }
                }
                for c in self.components.iter().filter(|c| in_view(c)) {
                    if missing(&c.source) {
                        out.push(warn(
                            "unconfirmed-element",
                            format!("`{}` in panel `{}` has no source: confirm it in the code or remove it", c.name, v.title),
                            &c.id,
                        ));
                    }
                }
                for cn in &self.connections {
                    let ends_here = [&cn.from, &cn.to]
                        .iter()
                        .any(|id| self.view_of_component(id).is_some_and(|x| x.id == v.id));
                    if ends_here && missing(&cn.source) {
                        out.push(warn(
                            "unconfirmed-element",
                            format!("arrow `{}` → `{}` in panel `{}` has no source: confirm it in the code or remove it", cn.from, cn.to, v.title),
                            &cn.from,
                        ));
                    }
                }
            }
        }
    }

    /// Corre as regras de validação da arquitectura, mais graves primeiro.
    pub fn validate(&self) -> Vec<Finding> {
        let mut out = Vec::new();

        // Referências de arestas têm de existir.
        for c in &self.connections {
            if self.get(&c.from).is_none() {
                out.push(Finding {
                    severity: Severity::Error,
                    rule: "dangling-edge".into(),
                    message: format!("connection from unknown component `{}`", c.from),
                    component: c.from.clone(),
                });
            }
            if self.get(&c.to).is_none() {
                out.push(Finding {
                    severity: Severity::Error,
                    rule: "dangling-edge".into(),
                    message: format!("connection to unknown component `{}`", c.to),
                    component: c.to.clone(),
                });
            }
        }

        // Outbox sem relay: uma store de outbox tem de ser LIDA por um relay que publica.
        for store in self
            .components
            .iter()
            .filter(|c| c.kind == Kind::Store && c.outbox)
        {
            let relayed = self.connections.iter().any(|c| {
                c.to == store.id
                    && c.is(Relation::Reads)
                    && self
                        .get(&c.from)
                        .map(|r| r.kind == Kind::Relay)
                        .unwrap_or(false)
            });
            if !relayed {
                out.push(Finding {
                    severity: Severity::Error,
                    rule: "outbox-without-relay".into(),
                    message: format!(
                        "outbox store `{}` is not read by any relay — events will never publish",
                        store.name
                    ),
                    component: store.id.clone(),
                });
            }
        }

        // Eventos publicados vs consumidos (por nome de evento).
        let published: std::collections::HashSet<&str> = self
            .connections
            .iter()
            .filter(|c| c.is(Relation::Publishes) && !c.event.is_empty())
            .map(|c| c.event.as_str())
            .collect();
        let consumed: std::collections::HashSet<&str> = self
            .connections
            .iter()
            .filter(|c| c.is(Relation::Consumes) && !c.event.is_empty())
            .map(|c| c.event.as_str())
            .collect();

        for ev in &published {
            if !consumed.contains(ev) {
                out.push(Finding {
                    severity: Severity::Warning,
                    rule: "orphan-event".into(),
                    message: format!("event `{ev}` is published but no consumer subscribes to it"),
                    component: String::new(),
                });
            }
        }
        for ev in &consumed {
            if !published.contains(ev) {
                out.push(Finding {
                    severity: Severity::Error,
                    rule: "orphan-subscription".into(),
                    message: format!(
                        "event `{ev}` is consumed but nothing publishes it (orphan routing key)"
                    ),
                    component: String::new(),
                });
            }
        }

        // Broker pendurado: sem produtores ou sem consumidores.
        for broker in self.components.iter().filter(|c| c.kind == Kind::Broker) {
            let has_pub = self
                .connections
                .iter()
                .any(|c| c.to == broker.id && c.is(Relation::Publishes));
            let has_sub = self
                .connections
                .iter()
                .any(|c| c.from == broker.id || (c.to == broker.id && c.is(Relation::Consumes)));
            if !has_pub || !has_sub {
                out.push(Finding {
                    severity: Severity::Warning,
                    rule: "dangling-broker".into(),
                    message: format!(
                        "broker `{}` has {}",
                        broker.name,
                        if !has_pub {
                            "no producers"
                        } else {
                            "no consumers"
                        }
                    ),
                    component: broker.id.clone(),
                });
            }
        }

        self.validate_system(&mut out);

        out.sort_by_key(|f| match f.severity {
            Severity::Error => 0,
            Severity::Warning => 1,
        });
        out
    }

    /// `true` quando não há erros (avisos são aceitáveis).
    pub fn is_valid(&self) -> bool {
        !self
            .validate()
            .iter()
            .any(|f| f.severity == Severity::Error)
    }

    /// Esqueleto do projecto a partir do desenho: uma pasta por componente «vivo»
    /// (service/consumer/relay/gateway) com um stub, e um `ARCHITECTURE.md` com o fluxo de
    /// eventos. Devolve (caminho relativo → conteúdo). Vazio se a arquitectura tem erros.
    ///
    /// Só materializa o desenho de eventos: os Kind de sistema e as setas sem `relation`
    /// ficam de fora, e um desenho só de sistema não gera nada.
    pub fn scaffold(&self) -> Vec<(String, String)> {
        if !self.is_valid() {
            return Vec::new();
        }
        if !self.components.is_empty() && !self.components.iter().any(|c| c.kind.is_event()) {
            return Vec::new();
        }
        let slug = |s: &str| {
            s.chars()
                .map(|c| {
                    if c.is_alphanumeric() {
                        c.to_ascii_lowercase()
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
        };
        let mut out = Vec::new();

        for c in &self.components {
            let dir = match c.kind {
                Kind::Service | Kind::Gateway => "services",
                Kind::Consumer => "consumers",
                Kind::Relay => "relays",
                _ => continue, // stores/brokers são infra, não geram pasta de código
            };
            let name = slug(&c.id);
            let publishes: Vec<&str> = self
                .connections
                .iter()
                .filter(|cn| cn.from == c.id && cn.is(Relation::Publishes) && !cn.event.is_empty())
                .map(|cn| cn.event.as_str())
                .collect();
            let consumes: Vec<&str> = self
                .connections
                .iter()
                .filter(|cn| cn.from == c.id && cn.is(Relation::Consumes) && !cn.event.is_empty())
                .map(|cn| cn.event.as_str())
                .collect();
            let mut body = format!(
                "// {} ({:?}) — generated from the Architecture Studio design.\n",
                c.name, c.kind
            );
            if !publishes.is_empty() {
                body.push_str(&format!("// publishes: {}\n", publishes.join(", ")));
            }
            if !consumes.is_empty() {
                body.push_str(&format!("// consumes: {}\n", consumes.join(", ")));
            }
            body.push_str("\n// TODO: implement.\n");
            out.push((
                format!("{dir}/{name}/README.md"),
                format!("# {}\n\n`{:?}` component.\n", c.name, c.kind),
            ));
            out.push((format!("{dir}/{name}/main.rs"), body));
        }

        // ARCHITECTURE.md — o fluxo de eventos legível.
        let mut md = String::from(
            "# Architecture\n\nGenerated from the Architecture Studio design.\n\n## Components\n\n",
        );
        for c in self.components.iter().filter(|c| c.kind.is_event()) {
            md.push_str(&format!(
                "- **{}** (`{:?}`{})\n",
                c.name,
                c.kind,
                if c.outbox { ", outbox" } else { "" }
            ));
        }
        md.push_str("\n## Event flow\n\n");
        for (cn, relation) in self
            .connections
            .iter()
            .filter_map(|cn| cn.relation.map(|r| (cn, r)))
        {
            let ev = if cn.event.is_empty() {
                String::new()
            } else {
                format!(" `{}`", cn.event)
            };
            md.push_str(&format!(
                "- `{}` → `{}` ({:?}{})\n",
                cn.from, cn.to, relation, ev
            ));
        }
        out.push(("ARCHITECTURE.md".into(), md));

        // ── Artefactos cloud-native (F8): Dockerfile por componente vivo + compose +
        // Makefile + .env.example + manifestos Kubernetes. Tudo DERIVADO do desenho real:
        // cada live-component vira um serviço que constrói da sua pasta; cada store/broker
        // vira infra local (postgres / rabbitmq — stand-ins honestos, documentados), com a
        // ligação (DATABASE_URL / AMQP_URL) inferida das arestas writes/reads/publishes/consumes.
        let is_live = |k: Kind| {
            matches!(
                k,
                Kind::Service | Kind::Gateway | Kind::Consumer | Kind::Relay
            )
        };
        let dir_of = |k: Kind| match k {
            Kind::Service | Kind::Gateway => "services",
            Kind::Consumer => "consumers",
            Kind::Relay => "relays",
            _ => "",
        };
        // Slugs das infra-dependências (store/broker) de um componente, pelas arestas.
        let deps_of = |cid: &str, want: Kind, rels: &[Relation]| -> Vec<String> {
            self.connections
                .iter()
                .filter(|cn| cn.from == cid && cn.relation.is_some_and(|r| rels.contains(&r)))
                .filter_map(|cn| self.get(&cn.to))
                .filter(|tc| tc.kind == want)
                .map(|tc| slug(&tc.id))
                .collect()
        };
        let live: Vec<&Component> = self.components.iter().filter(|c| is_live(c.kind)).collect();

        // Dockerfile (multi-stage, não-root) por componente vivo — ponto de partida do scaffold.
        for c in &live {
            let name = slug(&c.id);
            let dir = dir_of(c.kind);
            let df = format!(
                "# {name} — generated from the Architecture Studio design (scaffold starting point).\n\
                 FROM rust:1.82-slim AS build\n\
                 WORKDIR /app\n\
                 COPY . .\n\
                 # The scaffold ships a stub; replace with your crate, then: cargo build --release\n\n\
                 FROM debian:bookworm-slim\n\
                 RUN useradd --system --uid 10001 app\n\
                 USER app\n\
                 ENV RUST_LOG=info\n\
                 CMD [\"sh\", \"-c\", \"echo '{name} (scaffold) — implement me'; sleep infinity\"]\n"
            );
            out.push((format!("{dir}/{name}/Dockerfile"), df));
        }

        // docker-compose.yml — serviços vivos + infra local, com depends_on por saúde.
        let mut compose = String::from(
            "# Generated from the Architecture Studio design. Managed infra uses local stand-ins.\n\
             name: dxtutor-app\n\nservices:\n",
        );
        for c in &live {
            let name = slug(&c.id);
            let dir = dir_of(c.kind);
            let stores = deps_of(&c.id, Kind::Store, &[Relation::Writes, Relation::Reads]);
            let brokers = deps_of(
                &c.id,
                Kind::Broker,
                &[Relation::Publishes, Relation::Consumes],
            );
            compose.push_str(&format!("  {name}:\n    build: ./{dir}/{name}\n"));
            if !stores.is_empty() || !brokers.is_empty() {
                compose.push_str("    environment:\n");
                if let Some(s) = stores.first() {
                    compose.push_str(&format!(
                        "      - DATABASE_URL=postgres://app:app@{s}:5432/app\n"
                    ));
                }
                if let Some(b) = brokers.first() {
                    compose.push_str(&format!("      - AMQP_URL=amqp://guest:guest@{b}:5672\n"));
                }
            }
            let mut deps = stores.clone();
            deps.extend(brokers.clone());
            if !deps.is_empty() {
                compose.push_str("    depends_on:\n");
                for d in &deps {
                    compose.push_str(&format!("      {d}:\n        condition: service_healthy\n"));
                }
            }
            compose.push_str("    restart: unless-stopped\n");
        }
        for c in &self.components {
            let name = slug(&c.id);
            match c.kind {
                Kind::Store => compose.push_str(&format!(
                    "  {name}:\n    image: postgres:16-alpine\n    environment:\n      - POSTGRES_USER=app\n      - POSTGRES_PASSWORD=app\n      - POSTGRES_DB=app\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U app\"]\n      interval: 5s\n      timeout: 3s\n      retries: 12\n    restart: unless-stopped\n"
                )),
                Kind::Broker => compose.push_str(&format!(
                    "  {name}:\n    image: rabbitmq:3.13-management-alpine\n    healthcheck:\n      test: [\"CMD-SHELL\", \"rabbitmq-diagnostics -q ping\"]\n      interval: 10s\n      timeout: 5s\n      retries: 12\n    restart: unless-stopped\n"
                )),
                _ => {}
            }
        }
        out.push(("docker-compose.yml".into(), compose));

        // Makefile — RUN/Stop/logs/test sobre o compose.
        out.push((
            "Makefile".into(),
            ".PHONY: run stop logs test\n\nrun:\n\tdocker compose up --build -d\n\tdocker compose ps\n\nstop:\n\tdocker compose down\n\nlogs:\n\tdocker compose logs -f\n\ntest:\n\tcargo test\n".into(),
        ));
        out.push((
            ".env.example".into(),
            "# Copy to .env — local development values only.\nPOSTGRES_PASSWORD=app\n".into(),
        ));

        // Kubernetes: um Deployment+Service por componente vivo + um 00-infra.yaml para stores/brokers.
        for c in &live {
            let name = slug(&c.id);
            let has_store =
                !deps_of(&c.id, Kind::Store, &[Relation::Writes, Relation::Reads]).is_empty();
            let has_broker = !deps_of(
                &c.id,
                Kind::Broker,
                &[Relation::Publishes, Relation::Consumes],
            )
            .is_empty();
            let mut env = String::new();
            if has_store {
                let s = &deps_of(&c.id, Kind::Store, &[Relation::Writes, Relation::Reads])[0];
                env.push_str(&format!("            - {{ name: DATABASE_URL, value: \"postgres://app:app@{s}:5432/app\" }}\n"));
            }
            if has_broker {
                let b = &deps_of(
                    &c.id,
                    Kind::Broker,
                    &[Relation::Publishes, Relation::Consumes],
                )[0];
                env.push_str(&format!(
                    "            - {{ name: AMQP_URL, value: \"amqp://guest:guest@{b}:5672\" }}\n"
                ));
            }
            let env_block = if env.is_empty() {
                String::new()
            } else {
                format!("          env:\n{env}")
            };
            out.push((
                format!("deploy/k8s/{name}.yaml"),
                format!(
                    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  replicas: 1\n  selector:\n    matchLabels: {{ app: {name} }}\n  template:\n    metadata:\n      labels: {{ app: {name} }}\n    spec:\n      containers:\n        - name: {name}\n          image: registry.example.com/{name}:0.1.0\n{env_block}          resources:\n            requests: {{ cpu: 50m, memory: 64Mi }}\n            limits: {{ cpu: 500m, memory: 256Mi }}\n          securityContext: {{ runAsNonRoot: true, allowPrivilegeEscalation: false }}\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: {name}\nspec:\n  selector: {{ app: {name} }}\n  ports: [{{ port: 80, targetPort: 8080 }}]\n"
                ),
            ));
        }
        let mut infra = String::from("# Local infra stand-ins (store/broker) for the design.\n");
        for c in &self.components {
            let name = slug(&c.id);
            let (image, port) = match c.kind {
                Kind::Store => ("postgres:16-alpine", 5432),
                Kind::Broker => ("rabbitmq:3.13-management-alpine", 5672),
                _ => continue,
            };
            infra.push_str(&format!(
                "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  replicas: 1\n  selector:\n    matchLabels: {{ app: {name} }}\n  template:\n    metadata:\n      labels: {{ app: {name} }}\n    spec:\n      containers:\n        - name: {name}\n          image: {image}\n          ports: [{{ containerPort: {port} }}]\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: {name}\nspec:\n  selector: {{ app: {name} }}\n  ports: [{{ port: {port}, targetPort: {port} }}]\n"
            ));
        }
        out.push(("deploy/k8s/00-infra.yaml".into(), infra));

        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn comp(id: &str, kind: Kind, outbox: bool) -> Component {
        Component {
            outbox,
            ..Component::new(id, id, kind)
        }
    }
    fn conn(from: &str, to: &str, relation: Relation, event: &str) -> Connection {
        Connection::new(from, to, relation, event)
    }

    /// The order-flow from the reference image: service → outbox → relay → broker → consumer.
    pub(crate) fn ok_arch() -> Architecture {
        Architecture {
            components: vec![
                comp("svc", Kind::Service, false),
                comp("db", Kind::Store, true),
                comp("relay", Kind::Relay, false),
                comp("mq", Kind::Broker, false),
                comp("worker", Kind::Consumer, false),
            ],
            connections: vec![
                conn("svc", "db", Relation::Writes, ""),
                conn("relay", "db", Relation::Reads, ""),
                conn("relay", "mq", Relation::Publishes, "order.placed"),
                conn("worker", "mq", Relation::Consumes, "order.placed"),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn valid_outbox_flow_passes() {
        let a = ok_arch();
        assert!(a.is_valid(), "{:?}", a.validate());
    }

    #[test]
    fn outbox_without_relay_is_an_error() {
        let mut a = ok_arch();
        a.connections.retain(|c| !c.is(Relation::Reads)); // drop the relay reading the outbox
        let f = a.validate();
        assert!(
            f.iter()
                .any(|x| x.rule == "outbox-without-relay" && x.severity == Severity::Error),
            "{f:?}"
        );
        assert!(!a.is_valid());
    }

    #[test]
    fn orphan_subscription_and_event_are_flagged() {
        let mut a = ok_arch();
        // Consumer now subscribes to an event nobody publishes.
        for c in a.connections.iter_mut() {
            if c.is(Relation::Consumes) {
                c.event = "order.cancelled".into();
            }
        }
        let f = a.validate();
        assert!(f.iter().any(|x| x.rule == "orphan-subscription"), "{f:?}"); // nothing publishes order.cancelled
        assert!(f.iter().any(|x| x.rule == "orphan-event"), "{f:?}"); // order.placed now has no consumer
    }

    #[test]
    fn scaffold_emits_folders_and_architecture_md() {
        let files = ok_arch().scaffold();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert!(paths.contains(&"services/svc/main.rs"), "{paths:?}");
        assert!(paths.contains(&"relays/relay/main.rs"), "{paths:?}");
        assert!(paths.contains(&"consumers/worker/main.rs"), "{paths:?}");
        assert!(paths.contains(&"ARCHITECTURE.md"), "{paths:?}");
        // No code folder for infra (store/broker).
        assert!(
            !paths
                .iter()
                .any(|p| p.contains("/db/") || p.contains("/mq/")),
            "{paths:?}"
        );
        // The relay's stub names the event it publishes.
        let relay = files
            .iter()
            .find(|(p, _)| p == "relays/relay/main.rs")
            .unwrap();
        assert!(relay.1.contains("order.placed"), "{}", relay.1);
    }

    #[test]
    fn scaffold_emits_cloud_native_artifacts() {
        let files = ok_arch().scaffold();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        // A Dockerfile per live component (service/relay/consumer/gateway).
        assert!(paths.contains(&"services/svc/Dockerfile"), "{paths:?}");
        assert!(paths.contains(&"relays/relay/Dockerfile"), "{paths:?}");
        assert!(paths.contains(&"consumers/worker/Dockerfile"), "{paths:?}");
        // Root artefacts.
        assert!(paths.contains(&"docker-compose.yml"), "{paths:?}");
        assert!(paths.contains(&"Makefile"), "{paths:?}");
        assert!(paths.contains(&".env.example"), "{paths:?}");
        // Kubernetes: one manifest per live component plus the infra bundle.
        assert!(paths.contains(&"deploy/k8s/svc.yaml"), "{paths:?}");
        assert!(paths.contains(&"deploy/k8s/00-infra.yaml"), "{paths:?}");
        // Compose declares the store+broker as local infra and wires the live services.
        let compose = &files
            .iter()
            .find(|(p, _)| p == "docker-compose.yml")
            .unwrap()
            .1;
        assert!(
            compose.contains("postgres") && compose.contains("db:"),
            "{compose}"
        );
        assert!(
            compose.contains("rabbitmq") && compose.contains("mq:"),
            "{compose}"
        );
        assert!(compose.contains("build: ./services/svc"), "{compose}");
        // worker consumes the broker and relay publishes to it → AMQP_URL wired.
        assert!(compose.contains("AMQP_URL"), "{compose}");
        // Dockerfiles are multi-stage and run as non-root (review heuristics).
        let df = &files
            .iter()
            .find(|(p, _)| p == "services/svc/Dockerfile")
            .unwrap()
            .1;
        assert!(df.contains(" AS build") && df.contains("USER "), "{df}");
        // Infra (store/broker) still gets no code folder.
        assert!(
            !paths
                .iter()
                .any(|p| p.contains("/db/") || p.contains("/mq/")),
            "{paths:?}"
        );
    }

    #[test]
    fn scaffold_refuses_an_invalid_design() {
        let mut a = ok_arch();
        a.connections.retain(|c| !c.is(Relation::Reads)); // outbox-without-relay = error
        assert!(a.scaffold().is_empty());
    }

    #[test]
    fn dangling_edge_is_an_error() {
        let a = Architecture {
            components: vec![comp("a", Kind::Service, false)],
            connections: vec![conn("a", "ghost", Relation::Writes, "")],
            ..Default::default()
        };
        assert!(a.validate().iter().any(|x| x.rule == "dangling-edge"));
    }

    // ── retrocompatibilidade: um desenho antigo (só eventos) ──────────────────────────

    /// O JSON que o Studio antigo envia (formato de antes dos grupos/painéis).
    const OLD_JSON: &str = r#"{"components":[{"id":"svc","name":"Orders","kind":"service","outbox":false},{"id":"db","name":"Outbox","kind":"store","outbox":true},{"id":"relay","name":"Relay","kind":"relay","outbox":false},{"id":"mq","name":"Bus","kind":"broker","outbox":false},{"id":"worker","name":"Billing","kind":"consumer","outbox":false}],"connections":[{"from":"svc","to":"db","relation":"writes","event":""},{"from":"relay","to":"db","relation":"reads","event":""},{"from":"relay","to":"mq","relation":"publishes","event":"order.placed"},{"from":"worker","to":"mq","relation":"consumes","event":"order.placed"}]}"#;

    #[test]
    fn old_design_round_trips_byte_identical() {
        let a: Architecture = serde_json::from_str(OLD_JSON).unwrap();
        assert_eq!(serde_json::to_string(&a).unwrap(), OLD_JSON);
    }

    #[test]
    fn old_design_validates_and_scaffolds_as_before() {
        let a: Architecture = serde_json::from_str(OLD_JSON).unwrap();
        assert!(a.validate().is_empty(), "{:?}", a.validate());
        let files = a.scaffold();
        let md = &files
            .iter()
            .find(|(p, _)| p == "ARCHITECTURE.md")
            .unwrap()
            .1;
        // O fluxo de eventos sai como antes (a relação sem `Some(...)`).
        assert!(
            md.contains("- `relay` → `mq` (Publishes `order.placed`)"),
            "{md}"
        );
        assert!(md.contains("- **Outbox** (`Store`, outbox)"), "{md}");
    }

    #[test]
    fn old_rules_still_fire_on_old_json() {
        // Sem o relay a ler o outbox: o mesmo erro de sempre.
        let json = OLD_JSON.replace(
            r#"{"from":"relay","to":"db","relation":"reads","event":""},"#,
            "",
        );
        let a: Architecture = serde_json::from_str(&json).unwrap();
        assert_eq!(rules(&a), vec!["outbox-without-relay"]);
    }

    // ── diagrama de sistema ───────────────────────────────────────────────────────────

    fn group(id: &str, kind: GroupKind, parent: Option<&str>) -> Group {
        Group {
            id: id.into(),
            label: id.into(),
            kind,
            parent: parent.map(Into::into),
            style: GroupStyle::Dashed,
            source: None,
        }
    }
    fn in_group(id: &str, kind: Kind, g: &str) -> Component {
        Component {
            group: Some(g.into()),
            ..Component::new(id, id, kind)
        }
    }
    fn view(id: &str, roots: &[&str]) -> View {
        View {
            id: id.into(),
            title: id.into(),
            color: String::new(),
            roots: roots.iter().map(|r| (*r).into()).collect(),
            daemonless: false,
            strict: false,
        }
    }
    fn styled(from: &str, to: &str, style: EdgeStyle) -> Connection {
        Connection {
            style: Some(style),
            ..Connection::link(from, to)
        }
    }
    fn rules(a: &Architecture) -> Vec<String> {
        a.validate().into_iter().map(|f| f.rule).collect()
    }

    /// A imagem de referência «Docker vs Kubernetes», modelada com os Kind novos.
    pub(crate) fn docker_vs_k8s() -> Architecture {
        let mut c = vec![
            in_group("docker-cli", Kind::Cli, "host"),
            in_group("dockerd", Kind::Daemon, "host"),
            in_group("containerd", Kind::Runtime, "host"),
            in_group("runc", Kind::Runtime, "host"),
            in_group("container", Kind::Process, "host"),
            in_group("linux", Kind::Kernel, "host"),
            Component::new("deployment", "Deployment", Kind::State),
            in_group("api", Kind::Process, "control-plane"),
            in_group("etcd", Kind::State, "control-plane"),
            in_group("ctrl", Kind::Process, "control-plane"),
            in_group("sched", Kind::Process, "control-plane"),
            in_group("kubelet-1", Kind::Daemon, "node-1"),
            in_group("cri-1", Kind::Runtime, "node-1"),
            in_group("pod-a", Kind::Worker, "node-1"),
            in_group("pod-b", Kind::Worker, "node-1"),
            in_group("kubelet-2", Kind::Daemon, "node-2"),
            in_group("cri-2", Kind::Runtime, "node-2"),
            in_group("pod-c", Kind::Worker, "node-2"),
            in_group("client", Kind::Client, "k8s"),
            in_group("ingress", Kind::Adapter, "k8s"),
            in_group("service", Kind::Port, "k8s"),
        ];
        c[0].code = Some("docker run checkout:v2".into());
        c[6].code = Some("replicas: 3\nimage: checkout:v2".into());
        c[6].group = Some("k8s".into());
        let ctl = |a: &str, b: &str| styled(a, b, EdgeStyle::Control);
        let data = |a: &str, b: &str| styled(a, b, EdgeStyle::Data);
        let mut apply = ctl("deployment", "api");
        apply.label = Some("kubectl apply".into());
        let mut cri = ctl("kubelet-1", "cri-1");
        cri.protocol = Some(Protocol::Grpc);
        cri.label = Some("gRPC CRI".into());
        Architecture {
            components: c,
            connections: vec![
                ctl("docker-cli", "dockerd"),
                ctl("dockerd", "containerd"),
                ctl("containerd", "runc"),
                ctl("runc", "container"),
                apply,
                ctl("api", "etcd"),
                ctl("api", "ctrl"),
                ctl("api", "sched"),
                ctl("api", "kubelet-1"),
                ctl("api", "kubelet-2"),
                cri,
                ctl("cri-1", "pod-a"),
                ctl("cri-1", "pod-b"),
                ctl("kubelet-2", "cri-2"),
                ctl("cri-2", "pod-c"),
                data("client", "ingress"),
                data("ingress", "service"),
                data("service", "pod-a"),
                data("service", "pod-c"),
            ],
            groups: vec![
                group("host", GroupKind::Host, None),
                group("k8s", GroupKind::Boundary, None),
                group("control-plane", GroupKind::Plane, Some("k8s")),
                group("node-1", GroupKind::Node, Some("k8s")),
                group("node-2", GroupKind::Node, Some("k8s")),
            ],
            views: vec![view("docker", &["host"]), view("kubernetes", &["k8s"])],
        }
    }

    #[test]
    fn reference_diagram_is_valid_and_round_trips() {
        let a = docker_vs_k8s();
        assert!(a.validate().is_empty(), "{:?}", a.validate());
        let json = serde_json::to_string(&a).unwrap();
        let back: Architecture = serde_json::from_str(&json).unwrap();
        assert_eq!(serde_json::to_string(&back).unwrap(), json);
        assert!(
            json.contains(r#""protocol":"grpc""#) && json.contains(r#""style":"control""#),
            "{json}"
        );
    }

    #[test]
    fn new_kinds_never_trigger_event_rules() {
        // Um daemon «pendurado», um runtime sem leitores, um state sem relay: nenhuma regra
        // de eventos se aplica (só olham para os Kind de eventos).
        let a = Architecture {
            components: vec![
                Component::new("d", "d", Kind::Daemon),
                Component::new("s", "s", Kind::State),
                Component::new("r", "r", Kind::Runtime),
            ],
            connections: vec![Connection::link("d", "s")],
            ..Default::default()
        };
        assert!(a.validate().is_empty(), "{:?}", a.validate());
    }

    #[test]
    fn dangling_edge_applies_to_system_links_too() {
        let a = Architecture {
            components: vec![Component::new("d", "d", Kind::Daemon)],
            connections: vec![Connection::link("d", "ghost")],
            ..Default::default()
        };
        assert_eq!(rules(&a), vec!["dangling-edge"]);
    }

    #[test]
    fn group_cycle_is_one_error_per_cycle() {
        let a = Architecture {
            groups: vec![
                group("a", GroupKind::Module, Some("b")),
                group("b", GroupKind::Module, Some("c")),
                group("c", GroupKind::Module, Some("a")),
                group("self", GroupKind::Layer, Some("self")),
                group("inner", GroupKind::Layer, Some("a")), // aponta para o ciclo, não está nele
            ],
            ..Default::default()
        };
        let f: Vec<Finding> = a
            .validate()
            .into_iter()
            .filter(|f| f.rule == "group-cycle")
            .collect();
        assert_eq!(f.len(), 2, "{f:?}");
        assert!(
            f.iter()
                .any(|x| x.component == "a" && x.message.contains("a → b → c")),
            "{f:?}"
        );
        assert!(f.iter().any(|x| x.component == "self"), "{f:?}");
        assert!(f.iter().all(|x| x.severity == Severity::Error));
    }

    #[test]
    fn unknown_parent_group_and_view_root_are_errors() {
        let a = Architecture {
            components: vec![in_group("x", Kind::Process, "nowhere")],
            groups: vec![group("g", GroupKind::Node, Some("missing"))],
            views: vec![view("v", &["g", "ghost"])],
            ..Default::default()
        };
        let r = rules(&a);
        assert!(r.contains(&"group-unknown-parent".into()), "{r:?}");
        assert!(r.contains(&"component-in-unknown-group".into()), "{r:?}");
        assert!(r.contains(&"view-unknown-group".into()), "{r:?}");
        assert!(!a.is_valid());
    }

    #[test]
    fn edge_crosses_panel_unless_optional() {
        let mut a = docker_vs_k8s();
        a.connections
            .push(styled("dockerd", "kubelet-1", EdgeStyle::Control));
        let f: Vec<Finding> = a
            .validate()
            .into_iter()
            .filter(|f| f.rule == "edge-crosses-panel")
            .collect();
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].severity, Severity::Error);
        assert!(
            f[0].message
                .contains("panel `docker` to panel `kubernetes`"),
            "{}",
            f[0].message
        );

        a.connections.last_mut().unwrap().style = Some(EdgeStyle::Optional);
        assert!(a.validate().is_empty(), "{:?}", a.validate());
    }

    #[test]
    fn edges_without_panels_are_not_cross_panel() {
        // Sem grupo (ou fora de qualquer painel) não há painel para comparar.
        let a = Architecture {
            components: vec![
                Component::new("a", "a", Kind::Cli),
                in_group("b", Kind::Daemon, "g"),
            ],
            connections: vec![Connection::link("a", "b")],
            groups: vec![group("g", GroupKind::Host, None)],
            views: vec![view("v", &["g"])],
        };
        assert!(a.validate().is_empty(), "{:?}", a.validate());
    }

    #[test]
    fn daemonless_claim_warns_on_a_daemon_in_that_panel_only() {
        let mut a = docker_vs_k8s();
        a.views[1].daemonless = true; // kubernetes desenha kubelets (daemons)
        let f: Vec<Finding> = a
            .validate()
            .into_iter()
            .filter(|f| f.rule == "daemonless-claim")
            .collect();
        let at: Vec<&str> = f.iter().map(|x| x.component.as_str()).collect();
        assert_eq!(at, vec!["kubelet-1", "kubelet-2"]);
        assert!(f.iter().all(|x| x.severity == Severity::Warning));
        assert!(a.is_valid(), "um aviso não invalida");

        let mut b = docker_vs_k8s();
        b.views[0].daemonless = true; // o painel docker desenha o dockerd
        assert_eq!(
            b.validate()
                .iter()
                .filter(|f| f.rule == "daemonless-claim")
                .count(),
            1
        );
    }

    #[test]
    fn strict_panel_wants_a_source_for_every_box_and_arrow() {
        let mut a = docker_vs_k8s();
        a.views[0].strict = true; // painel docker: 1 grupo, 6 componentes, 4 setas
        let f: Vec<Finding> = a
            .validate()
            .into_iter()
            .filter(|f| f.rule == "unconfirmed-element")
            .collect();
        assert_eq!(f.len(), 1 + 6 + 4, "{f:?}");
        assert!(f.iter().all(|x| x.severity == Severity::Warning));

        // Com as fontes preenchidas, o painel fica limpo; o outro painel não é estrito.
        a.groups[0].source = Some("moby/daemon".into());
        for c in a
            .components
            .iter_mut()
            .filter(|c| c.group.as_deref() == Some("host"))
        {
            c.source = Some("moby/cmd".into());
        }
        for cn in a.connections.iter_mut().take(4) {
            cn.source = Some("moby/client".into());
        }
        assert!(a.validate().is_empty(), "{:?}", a.validate());
    }

    #[test]
    fn scaffold_ignores_system_kinds() {
        // Só sistema: nada a gerar.
        assert!(docker_vs_k8s().scaffold().is_empty());
        // Misto: igual ao desenho só de eventos.
        let mut mixed = ok_arch();
        mixed
            .components
            .push(Component::new("cli", "cli", Kind::Cli));
        mixed.connections.push(Connection::link("cli", "svc"));
        assert_eq!(mixed.scaffold(), ok_arch().scaffold());
    }

    #[test]
    fn new_enums_use_kebab_case() {
        let k: Vec<Kind> = serde_json::from_str(r#"["cli","process","daemon","runtime","socket","state","kernel","external","client","worker","port","adapter"]"#).unwrap();
        assert!(k.iter().all(|k| !k.is_event()));
        let p: Vec<Protocol> = serde_json::from_str(
            r#"["grpc","http","unix-socket","fork-exec","syscall","fs","ssh","event"]"#,
        )
        .unwrap();
        assert_eq!(p.len(), 8);
        let g: Vec<GroupKind> =
            serde_json::from_str(r#"["host","plane","node","module","layer","boundary"]"#).unwrap();
        assert_eq!(g.len(), 6);
        let st: Vec<EdgeStyle> = serde_json::from_str(r#"["control","data","optional"]"#).unwrap();
        assert_eq!(st.len(), 3);
        // Grupo sem `style` = tracejado.
        let g: Group = serde_json::from_str(r#"{"id":"h","label":"Host","kind":"host"}"#).unwrap();
        assert_eq!(g.style, GroupStyle::Dashed);
    }
}
