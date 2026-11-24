//! Mermaid ⇄ modelo de arquitectura.
//!
//! **Exportar** (`to_mermaid`): `graph TB` normal, que o GitHub desenha — um `subgraph` por
//! painel e por grupo, um nó por componente (a forma diz o tipo), uma seta por ligação
//! (`-.->` controlo, `-->` dados, `-.-` opcional). No fim, linhas `%% dxt:` (comentários
//! Mermaid) guardam o que a sintaxe não tem — tipo, código, fonte, protocolo, relação,
//! painéis — para que modelo → Mermaid → modelo não perca nada.
//!
//! **Importar** (`from_mermaid`): `graph`/`flowchart` (TB/TD/LR/BT/RL) com `subgraph` …
//! `end`, nós `id[…]` e as formas habituais, setas `-->`/`---`/`-.->`/`-.-`/`==>`/`===`
//! com rótulos `-- "txt" -->`, `-. txt .->`, `== txt ==>` ou `-->|txt|`, cadeias
//! `a --> b --> c`, listas `a & b --> c` e `;` como separador. Com as linhas `%% dxt:`
//! repõe o modelo exacto; sem elas (um diagrama escrito à mão) adivinha o tipo pela forma
//! e devolve avisos. `classDef`/`class`/`style`/`linkStyle`/`click` são ignorados com aviso.

use super::{
    Architecture, Component, Connection, EdgeStyle, Group, GroupKind, GroupStyle, Kind, Protocol,
    Relation, View,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

/// Primeira linha de um ficheiro exportado (informativa: a importação não depende dela).
pub const HEADER: &str = "%% dxtutor-arch v1";
/// Marca provisória (nunca sai do parser) dos nós escritos directamente num painel.
const BODY_MARK: &str = "\u{1}body:";
/// Prefixo dos `subgraph` que são painéis (o modo comparativo).
const VIEW_PREFIX: &str = "view__";
/// Uma fonte Mermaid maior do que isto não é um diagrama de arquitectura.
const MAX_SOURCE: usize = 1 << 20;

/// O resultado de importar Mermaid: o modelo e o que não foi possível trazer tal e qual.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MermaidImport {
    pub arch: Architecture,
    pub warnings: Vec<String>,
}

// ───────────────────────────── metadados `%% dxt:` ─────────────────────────────

#[derive(Debug, Default, Serialize, Deserialize)]
struct NodeMeta {
    i: usize,
    id: String,
    kind: Option<Kind>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    outbox: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GroupMeta {
    i: usize,
    id: String,
    kind: GroupKind,
    #[serde(default)]
    style: GroupStyle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    /// O grupo é o CORPO do painel com este id Mermaid: não tem `subgraph` próprio (o
    /// conteúdo vai directamente no do painel), para o título não aparecer duas vezes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ViewMeta {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    color: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    daemonless: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    strict: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct EdgeMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    relation: Option<Relation>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    protocol: Option<Protocol>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    style: Option<EdgeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

// ───────────────────────────── exportar ─────────────────────────────

const RESERVED: &[&str] = &[
    "end",
    "subgraph",
    "graph",
    "flowchart",
    "style",
    "class",
    "classdef",
    "click",
    "linkstyle",
    "direction",
    "default",
];

/// Ids Mermaid seguros (`[A-Za-z0-9_]`, únicos no espaço comum de nós e subgraphs).
struct Ids {
    used: HashSet<String>,
    comp: HashMap<String, String>,
    group: HashMap<String, String>,
    view: HashMap<String, String>,
}

impl Ids {
    fn new(a: &Architecture) -> Self {
        let mut ids = Ids {
            used: HashSet::new(),
            comp: HashMap::new(),
            group: HashMap::new(),
            view: HashMap::new(),
        };
        for v in &a.views {
            let m = ids.fresh(&format!("{VIEW_PREFIX}{}", sanitize(&v.id)));
            ids.view.insert(v.id.clone(), m);
        }
        for g in &a.groups {
            let mut base = sanitize(&g.id);
            if base.starts_with(VIEW_PREFIX) {
                base = format!("g_{base}");
            }
            let m = ids.fresh(&base);
            ids.group.entry(g.id.clone()).or_insert(m);
        }
        for c in &a.components {
            let m = ids.fresh(&sanitize(&c.id));
            ids.comp.entry(c.id.clone()).or_insert(m);
        }
        ids
    }

    fn fresh(&mut self, base: &str) -> String {
        let mut id = base.to_string();
        let mut n = 2;
        while self.used.contains(&id.to_ascii_lowercase()) {
            id = format!("{base}_{n}");
            n += 1;
        }
        self.used.insert(id.to_ascii_lowercase());
        id
    }

    /// O id Mermaid de uma ponta de seta: o do componente, ou um id seguro derivado (uma
    /// ligação pendurada exporta-se à mesma — a validação é que a acusa).
    fn end(&self, id: &str) -> String {
        self.comp.get(id).cloned().unwrap_or_else(|| sanitize(id))
    }
}

fn sanitize(id: &str) -> String {
    let mut s: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() || s.starts_with(|c: char| c.is_ascii_digit()) {
        s = format!("n_{s}");
    }
    if RESERVED.contains(&s.to_ascii_lowercase().as_str()) {
        s.push('_');
    }
    s
}

/// Texto dentro de `"…"` num rótulo Mermaid.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '#' => out.push_str("#35;"),
            '"' => out.push_str("#quot;"),
            '|' => out.push_str("#124;"),
            '\n' => out.push_str("<br>"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

fn shape_of(k: Kind) -> (&'static str, &'static str) {
    match k {
        Kind::Store | Kind::State => ("[(", ")]"),
        Kind::Client => ("((", "))"),
        Kind::External => (">", "]"),
        Kind::Kernel => ("[/", "\\]"),
        Kind::Broker => ("{{", "}}"),
        _ => ("[", "]"),
    }
}

/// O desenho em Mermaid `graph TB`, com os metadados que tornam a ida e volta exacta.
pub fn to_mermaid(a: &Architecture) -> String {
    let ids = Ids::new(a);
    let mut out = format!("{HEADER}\ngraph TB\n");
    let mut done_groups: HashSet<&str> = HashSet::new();
    let mut done_nodes: HashSet<&str> = HashSet::new();
    let group_ids: HashSet<&str> = a.groups.iter().map(|g| g.id.as_str()).collect();

    for v in &a.views {
        let _ = writeln!(
            out,
            "  subgraph {}[\"{}\"]",
            ids.view[&v.id],
            encode(&v.title)
        );
        if let Some(body) = panel_body(a, v) {
            // o corpo do painel: o conteúdo vai directamente no subgraph do painel
            done_groups.insert(body);
            for c in a
                .components
                .iter()
                .filter(|c| c.group.as_deref() == Some(body))
            {
                if done_nodes.insert(c.id.as_str()) {
                    emit_node(&ids, c, 2, &mut out);
                }
            }
            for child in a
                .groups
                .iter()
                .filter(|g| g.parent.as_deref() == Some(body))
            {
                emit_group(
                    a,
                    &ids,
                    &child.id,
                    2,
                    &mut out,
                    &mut done_groups,
                    &mut done_nodes,
                );
            }
        } else {
            for r in &v.roots {
                if group_ids.contains(r.as_str()) {
                    emit_group(a, &ids, r, 2, &mut out, &mut done_groups, &mut done_nodes);
                }
            }
        }
        out.push_str("  end\n");
    }
    // Grupos fora de painéis: primeiro as raízes (sem pai, ou pai desconhecido), depois o
    // que sobrar (grupos num ciclo) — nada fica de fora e nada entra em laço.
    for g in &a.groups {
        let root = g.parent.as_deref().is_none_or(|p| !group_ids.contains(p));
        if root {
            emit_group(
                a,
                &ids,
                &g.id,
                1,
                &mut out,
                &mut done_groups,
                &mut done_nodes,
            );
        }
    }
    for g in &a.groups {
        emit_group(
            a,
            &ids,
            &g.id,
            1,
            &mut out,
            &mut done_groups,
            &mut done_nodes,
        );
    }
    for c in &a.components {
        if !done_nodes.contains(c.id.as_str()) {
            emit_node(&ids, c, 1, &mut out);
        }
    }

    let mut pair_n: HashMap<(String, String), usize> = HashMap::new();
    let mut edge_meta = String::new();
    for cn in &a.connections {
        let (f, t) = (ids.end(&cn.from), ids.end(&cn.to));
        let arrow = match cn.style {
            Some(EdgeStyle::Control) => "-.->",
            Some(EdgeStyle::Optional) => "-.-",
            // uma dependência é uma linha cheia, como os dados; o estilo exacto vai no `%% dxt:`
            Some(EdgeStyle::Data) | Some(EdgeStyle::Depends) | None => "-->",
        };
        let text = cn
            .label
            .clone()
            .or_else(|| (!cn.event.is_empty()).then(|| cn.event.clone()));
        match text {
            Some(t2) => {
                let _ = writeln!(out, "  {f} {arrow}|\"{}\"| {t}", encode(&t2));
            }
            None => {
                let _ = writeln!(out, "  {f} {arrow} {t}");
            }
        }
        let n = pair_n.entry((f.clone(), t.clone())).or_insert(0);
        let meta = EdgeMeta {
            relation: cn.relation,
            event: cn.event.clone(),
            label: cn.label.clone(),
            protocol: cn.protocol,
            style: cn.style,
            source: cn.source.clone(),
        };
        let _ = writeln!(edge_meta, "%% dxt:edge {f} {t} {n} {}", json(&meta));
        *n += 1;
    }

    for v in &a.views {
        let meta = ViewMeta {
            id: v.id.clone(),
            title: v.title.clone(),
            color: v.color.clone(),
            daemonless: v.daemonless,
            strict: v.strict,
        };
        let _ = writeln!(out, "%% dxt:view {} {}", ids.view[&v.id], json(&meta));
    }
    let bodies: HashMap<&str, &str> = a
        .views
        .iter()
        .filter_map(|v| panel_body(a, v).map(|b| (b, ids.view[&v.id].as_str())))
        .collect();
    for (i, g) in a.groups.iter().enumerate() {
        let meta = GroupMeta {
            i,
            id: g.id.clone(),
            kind: g.kind,
            style: g.style,
            source: g.source.clone(),
            body: bodies.get(g.id.as_str()).map(|m| m.to_string()),
        };
        let _ = writeln!(out, "%% dxt:group {} {}", ids.group[&g.id], json(&meta));
    }
    for (i, c) in a.components.iter().enumerate() {
        let meta = NodeMeta {
            i,
            id: c.id.clone(),
            kind: Some(c.kind),
            outbox: c.outbox,
            code: c.code.clone(),
            source: c.source.clone(),
        };
        let _ = writeln!(out, "%% dxt:node {} {}", ids.comp[&c.id], json(&meta));
    }
    out.push_str(&edge_meta);
    out
}

/// O grupo-corpo de um painel (a mesma regra da UI): a única raiz do painel, com o mesmo
/// nome que o título. A moldura do painel já o mostra.
fn panel_body<'a>(a: &'a Architecture, v: &View) -> Option<&'a str> {
    let [root] = v.roots.as_slice() else {
        return None;
    };
    let g = a.groups.iter().find(|g| &g.id == root)?;
    (g.label.trim().to_lowercase() == v.title.trim().to_lowercase()).then_some(g.id.as_str())
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "{}".into())
}

fn emit_node(ids: &Ids, c: &Component, depth: usize, out: &mut String) {
    let (o, cl) = shape_of(c.kind);
    let _ = writeln!(
        out,
        "{}{}{o}\"{}\"{cl}",
        "  ".repeat(depth),
        ids.comp[&c.id],
        encode(&c.name)
    );
}

fn emit_group<'a>(
    a: &'a Architecture,
    ids: &Ids,
    id: &'a str,
    depth: usize,
    out: &mut String,
    done_groups: &mut HashSet<&'a str>,
    done_nodes: &mut HashSet<&'a str>,
) {
    let Some(g) = a.groups.iter().find(|g| g.id == id) else {
        return;
    };
    if !done_groups.insert(g.id.as_str()) {
        return;
    }
    let pad = "  ".repeat(depth);
    let _ = writeln!(
        out,
        "{pad}subgraph {}[\"{}\"]",
        ids.group[&g.id],
        encode(&g.label)
    );
    for c in a
        .components
        .iter()
        .filter(|c| c.group.as_deref() == Some(id))
    {
        if done_nodes.insert(c.id.as_str()) {
            emit_node(ids, c, depth + 1, out);
        }
    }
    for child in a.groups.iter().filter(|x| x.parent.as_deref() == Some(id)) {
        emit_group(a, ids, &child.id, depth + 1, out, done_groups, done_nodes);
    }
    let _ = writeln!(out, "{pad}end");
}

// ───────────────────────────── importar ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Rect,
    Round,
    Stadium,
    Subroutine,
    Cylinder,
    Circle,
    Asymmetric,
    Rhombus,
    Hexagon,
    Parallelogram,
    Trapezoid,
}

fn kind_from_shape(s: Shape) -> Kind {
    match s {
        Shape::Cylinder => Kind::State,
        Shape::Circle => Kind::Client,
        Shape::Asymmetric => Kind::External,
        Shape::Trapezoid => Kind::Kernel,
        _ => Kind::Process,
    }
}

fn group_kind_from_label(label: &str) -> GroupKind {
    let l = label.to_lowercase();
    let has = |w: &str| l.split(|c: char| !c.is_alphanumeric()).any(|t| t == w);
    if has("host") {
        GroupKind::Host
    } else if has("plane") || has("plano") {
        GroupKind::Plane
    } else if has("node") || has("nó") || has("nodes") || has("nós") {
        GroupKind::Node
    } else if has("layer") || has("camada") {
        GroupKind::Layer
    } else if has("module") || has("módulo") || has("modulo") || has("crate") {
        GroupKind::Module
    } else {
        GroupKind::Boundary
    }
}

/// Descodifica o texto de um rótulo Mermaid: `<br>` → mudança de linha, entidades `#…;`.
fn decode(text: &str) -> String {
    let mut s = text.trim().to_string();
    for br in ["<br/>", "<br />", "<BR>", "<br>"] {
        s = s.replace(br, "\n");
    }
    for (e, c) in [
        ("#quot;", "\""),
        ("#124;", "|"),
        ("#lt;", "<"),
        ("#gt;", ">"),
        ("#amp;", "&"),
        ("#59;", ";"),
        ("#35;", "#"),
    ] {
        s = s.replace(e, c);
    }
    s
}

/// Tira as aspas de fora de um rótulo (`"txt"` → `txt`).
fn unquote(text: &str) -> &str {
    let t = text.trim();
    t.strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .unwrap_or(t)
}

/// Divide uma linha em instruções por `;`, fora de aspas e de parênteses, e sem partir
/// uma entidade `#…;`.
fn statements(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let (mut cur, mut quote, mut depth) = (String::new(), false, 0i32);
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '"' => quote = !quote,
            '[' | '(' | '{' if !quote => depth += 1,
            ']' | ')' | '}' if !quote => depth -= 1,
            ';' if !quote && depth <= 0 => {
                let mut k = i;
                while k > 0 && chars[k - 1].is_ascii_alphanumeric() {
                    k -= 1;
                }
                let entity = k > 0 && chars[k - 1] == '#' && k < i;
                if !entity {
                    out.push(std::mem::take(&mut cur));
                    continue;
                }
            }
            _ => {}
        }
        cur.push(c);
    }
    out.push(cur);
    out
}

struct Cursor<'a> {
    c: &'a [char],
    i: usize,
}

impl Cursor<'_> {
    fn peek(&self, k: usize) -> Option<char> {
        self.c.get(self.i + k).copied()
    }
    fn at(&self, s: &str) -> bool {
        s.chars()
            .enumerate()
            .all(|(k, ch)| self.peek(k) == Some(ch))
    }
    fn ws(&mut self) {
        while self.peek(0).is_some_and(char::is_whitespace) {
            self.i += 1;
        }
    }
    fn done(&self) -> bool {
        self.i >= self.c.len()
    }
    /// Lê até à primeira ocorrência de `s` e salta-a; devolve o texto antes. `None` se não há.
    fn until(&mut self, s: &str) -> Option<String> {
        let mut j = self.i;
        while j < self.c.len() {
            let hit = s
                .chars()
                .enumerate()
                .all(|(k, ch)| self.c.get(j + k) == Some(&ch));
            if hit {
                let text: String = self.c[self.i..j].iter().collect();
                self.i = j + s.chars().count();
                return Some(text);
            }
            j += 1;
        }
        None
    }

    fn id(&mut self) -> Option<String> {
        let start = self.i;
        while let Some(ch) = self.peek(0) {
            let next_ok = self
                .peek(1)
                .is_some_and(|n| n.is_alphanumeric() || n == '_');
            if ch.is_alphanumeric() || ch == '_' || ((ch == '-' || ch == '.') && next_ok) {
                self.i += 1;
            } else {
                break;
            }
        }
        (self.i > start).then(|| self.c[start..self.i].iter().collect())
    }

    /// A forma e o rótulo logo a seguir ao id (`["…"]`, `[("…")]`, …), se houver.
    fn shape(&mut self) -> Option<(Shape, String)> {
        const OPENERS: &[(&str, &[&str], Shape)] = &[
            ("(((", &[")))"], Shape::Circle),
            ("[[", &["]]"], Shape::Subroutine),
            ("[(", &[")]"], Shape::Cylinder),
            ("[/", &["\\]"], Shape::Trapezoid),
            ("[/", &["/]"], Shape::Parallelogram),
            ("[\\", &["/]"], Shape::Trapezoid),
            ("[\\", &["\\]"], Shape::Parallelogram),
            ("((", &["))"], Shape::Circle),
            ("([", &["])"], Shape::Stadium),
            ("{{", &["}}"], Shape::Hexagon),
            ("(", &[")"], Shape::Round),
            ("{", &["}"], Shape::Rhombus),
            ("[", &["]"], Shape::Rect),
            (">", &["]"], Shape::Asymmetric),
        ];
        let save = self.i;
        for (open, closers, shape) in OPENERS {
            if !self.at(open) {
                continue;
            }
            self.i = save + open.chars().count();
            let quoted = self.peek(0) == Some('"');
            let text = if quoted {
                self.i += 1;
                let t = self.until("\"")?;
                self.ws();
                t
            } else {
                String::new()
            };
            for close in *closers {
                let back = self.i;
                if quoted {
                    if self.at(close) {
                        self.i += close.chars().count();
                        return Some((*shape, decode(&text)));
                    }
                } else if let Some(t) = self.until(close) {
                    return Some((*shape, decode(&t)));
                }
                self.i = back;
            }
            self.i = save;
        }
        None
    }

    /// Uma seta. Devolve o estilo (`None` = ligação invisível `~~~`) e o rótulo.
    fn edge(&mut self) -> Option<(Option<EdgeStyle>, Option<String>, bool)> {
        let bidir = self.peek(0) == Some('<');
        if bidir {
            self.i += 1;
        }
        let head = |cur: &mut Cursor| {
            if matches!(cur.peek(0), Some('>' | 'o' | 'x')) {
                cur.i += 1;
                true
            } else {
                false
            }
        };
        let mut label: Option<String> = None;
        let style = match (self.peek(0), self.peek(1)) {
            (Some('-'), Some('.')) => {
                self.i += 1;
                while self.peek(0) == Some('.') {
                    self.i += 1;
                }
                if self.peek(0) == Some('-') {
                    self.i += 1;
                    if head(self) {
                        EdgeStyle::Control
                    } else {
                        EdgeStyle::Optional
                    }
                } else if self.peek(0).is_some_and(char::is_whitespace) {
                    // `-. texto .->`
                    let t = self.until(".-")?;
                    label = Some(decode(unquote(&t)));
                    while self.peek(0) == Some('-') {
                        self.i += 1;
                    }
                    if head(self) {
                        EdgeStyle::Control
                    } else {
                        EdgeStyle::Optional
                    }
                } else {
                    return None;
                }
            }
            (Some(d @ ('-' | '=')), Some(d2)) if d2 == d => {
                let start = self.i;
                while self.peek(0) == Some(d) {
                    self.i += 1;
                }
                let run = self.i - start;
                if head(self) {
                    EdgeStyle::Data
                } else if run == 2 && self.peek(0).is_some_and(char::is_whitespace) {
                    // `-- texto -->` / `== texto ==>`
                    let pair: String = [d, d].iter().collect();
                    let t = self.until(&pair)?;
                    label = Some(decode(unquote(&t)));
                    while self.peek(0) == Some(d) {
                        self.i += 1;
                    }
                    if head(self) {
                        EdgeStyle::Data
                    } else {
                        EdgeStyle::Optional
                    }
                } else if run >= 3 {
                    EdgeStyle::Optional
                } else {
                    return None;
                }
            }
            (Some('~'), Some('~')) => {
                while self.peek(0) == Some('~') {
                    self.i += 1;
                }
                return Some((None, None, bidir));
            }
            _ => return None,
        };
        // `-->|texto|`
        let save = self.i;
        self.ws();
        if self.peek(0) == Some('|') {
            self.i += 1;
            let t = self.until("|")?;
            label = Some(decode(unquote(&t)));
        } else {
            self.i = save;
        }
        Some((Some(style), label.filter(|l| !l.is_empty()), bidir))
    }
}

#[derive(Default)]
struct Builder {
    comps: Vec<Component>,
    defined: Vec<bool>,
    comp_at: HashMap<String, usize>,
    groups: Vec<Group>,
    group_at: HashMap<String, usize>,
    views: Vec<View>,
    view_at: HashMap<String, usize>,
    conns: Vec<Connection>,
    warnings: Vec<String>,
    warned: HashSet<String>,
}

enum Frame {
    Group(String),
    View(String),
}

impl Builder {
    fn warn_once(&mut self, key: &str, msg: String) {
        if self.warned.insert(key.to_string()) {
            self.warnings.push(msg);
        }
    }

    fn node(&mut self, mid: String, def: Option<(Shape, String)>, group: Option<&str>) {
        match self.comp_at.get(&mid) {
            None => {
                let (name, kind) = match &def {
                    Some((s, l)) => (
                        if l.is_empty() { mid.clone() } else { l.clone() },
                        kind_from_shape(*s),
                    ),
                    None => (mid.clone(), Kind::Process),
                };
                let mut c = Component::new(mid.clone(), name, kind);
                c.group = group.map(Into::into);
                self.comp_at.insert(mid, self.comps.len());
                self.comps.push(c);
                self.defined.push(def.is_some());
            }
            Some(&i) => {
                if let Some((s, l)) = def {
                    if !self.defined[i] {
                        self.defined[i] = true;
                        if !l.is_empty() {
                            self.comps[i].name = l;
                        }
                        self.comps[i].kind = kind_from_shape(s);
                        if self.comps[i].group.is_none() {
                            self.comps[i].group = group.map(Into::into);
                        }
                    }
                }
            }
        }
    }
}

/// Lê `id["rótulo"]` (ou só `id`), seguido de `& id2[…]`….
/// Um nó referido numa instrução: o id e, se veio com forma, a forma e o rótulo.
type NodeRef = (String, Option<(Shape, String)>);

fn node_list(cur: &mut Cursor) -> Option<Vec<NodeRef>> {
    let mut out = Vec::new();
    loop {
        cur.ws();
        let id = cur.id()?;
        let def = cur.shape();
        out.push((id, def));
        let save = cur.i;
        cur.ws();
        if cur.peek(0) == Some('&') {
            cur.i += 1;
        } else {
            cur.i = save;
            return Some(out);
        }
    }
}

fn subgraph_header(rest: &str) -> (String, String) {
    let rest = rest.trim();
    let chars: Vec<char> = rest.chars().collect();
    let mut cur = Cursor { c: &chars, i: 0 };
    if rest.starts_with('"') {
        let label = decode(unquote(rest));
        return (sanitize(&label), label);
    }
    if let Some(id) = cur.id() {
        cur.ws(); // `subgraph CP [Control Plane]` também é válido
        if let Some((_, label)) = cur.shape() {
            return (id, label);
        }
        if cur.done() {
            return (id.clone(), id);
        }
    }
    let label = decode(rest);
    (sanitize(&label), label)
}

/// Importa um `graph`/`flowchart` Mermaid. Erro só quando não é um flowchart.
pub fn from_mermaid(src: &str) -> Result<MermaidImport, String> {
    if src.len() > MAX_SOURCE {
        return Err(format!(
            "the Mermaid source has {} bytes; the limit is {MAX_SOURCE}",
            src.len()
        ));
    }
    let mut b = Builder::default();
    let mut node_meta: HashMap<String, NodeMeta> = HashMap::new();
    let mut group_meta: HashMap<String, GroupMeta> = HashMap::new();
    let mut view_meta: HashMap<String, ViewMeta> = HashMap::new();
    let mut edge_meta: HashMap<(String, String, usize), EdgeMeta> = HashMap::new();
    let mut bad_meta = 0usize;
    let mut body: Vec<String> = Vec::new();

    for line in src.lines() {
        let t = line.trim();
        if let Some(m) = t.strip_prefix("%% dxt:") {
            let mut parts = m.splitn(2, ' ');
            let kind = parts.next().unwrap_or("");
            let rest = parts.next().unwrap_or("");
            let ok = match kind {
                "node" | "group" | "view" => rest
                    .split_once(' ')
                    .map(|(mid, js)| {
                        let mid = mid.to_string();
                        match kind {
                            "node" => serde_json::from_str(js)
                                .map(|v| node_meta.insert(mid, v))
                                .is_ok(),
                            "group" => serde_json::from_str(js)
                                .map(|v| group_meta.insert(mid, v))
                                .is_ok(),
                            _ => serde_json::from_str(js)
                                .map(|v| view_meta.insert(mid, v))
                                .is_ok(),
                        }
                    })
                    .unwrap_or(false),
                "edge" => {
                    let p: Vec<&str> = rest.splitn(4, ' ').collect();
                    match (p.as_slice(), p.get(2).and_then(|n| n.parse::<usize>().ok())) {
                        ([f, t2, _, js], Some(n)) => serde_json::from_str::<EdgeMeta>(js)
                            .map(|v| edge_meta.insert((f.to_string(), t2.to_string(), n), v))
                            .is_ok(),
                        _ => false,
                    }
                }
                _ => false,
            };
            if !ok {
                bad_meta += 1;
            }
            continue;
        }
        if t.starts_with("%%") {
            continue;
        }
        body.extend(statements(line));
    }

    // Cabeçalho: a primeira instrução não vazia.
    let mut it = body.into_iter().filter(|s| !s.trim().is_empty());
    let head = it.next().unwrap_or_default();
    let mut words = head.split_whitespace();
    let first = words.next().unwrap_or("");
    if first != "graph" && first != "flowchart" {
        let what = if first.is_empty() {
            "an empty source"
        } else {
            first
        };
        return Err(format!(
            "not a flowchart ({what}): only `graph` and `flowchart` diagrams can be imported"
        ));
    }
    match words.next().map(str::to_ascii_uppercase).as_deref() {
        None | Some("TB") | Some("TD") => {}
        Some(d) => b.warnings.push(format!(
            "direction `{d}` imported top-to-bottom: the Studio lays diagrams out from top to bottom"
        )),
    }

    let mut stack: Vec<Frame> = Vec::new();
    let mut pair_n: HashMap<(String, String), usize> = HashMap::new();
    let mut edge_keys: Vec<Option<(String, String, usize)>> = Vec::new();

    for stmt in it {
        let s = stmt.trim();
        let word = s.split_whitespace().next().unwrap_or("");
        match word {
            "subgraph" => {
                let (mid, label) = subgraph_header(&s["subgraph".len()..]);
                let is_view = view_meta.contains_key(&mid) || mid.starts_with(VIEW_PREFIX);
                if is_view {
                    if !b.view_at.contains_key(&mid) {
                        b.view_at.insert(mid.clone(), b.views.len());
                        b.views.push(View {
                            id: mid.strip_prefix(VIEW_PREFIX).unwrap_or(&mid).to_string(),
                            title: label,
                            color: String::new(),
                            roots: Vec::new(),
                            daemonless: false,
                            strict: false,
                        });
                    }
                    if !stack.is_empty() {
                        b.warn_once(
                            "nested-view",
                            "a panel inside another subgraph was read as a top-level panel".into(),
                        );
                    }
                    stack.push(Frame::View(mid));
                    continue;
                }
                let parent = match stack.last() {
                    Some(Frame::Group(g)) => Some(g.clone()),
                    Some(Frame::View(v)) => {
                        let vi = b.view_at[v];
                        b.views[vi].roots.push(mid.clone());
                        None
                    }
                    None => None,
                };
                if b.group_at.contains_key(&mid) {
                    b.warn_once(
                        &format!("dup-{mid}"),
                        format!("subgraph `{mid}` appears twice; its contents were merged"),
                    );
                } else {
                    b.group_at.insert(mid.clone(), b.groups.len());
                    b.groups.push(Group {
                        id: mid.clone(),
                        kind: group_kind_from_label(&label),
                        label,
                        parent,
                        style: GroupStyle::Dashed,
                        source: None,
                    });
                }
                stack.push(Frame::Group(mid));
            }
            "end" => {
                if stack.pop().is_none() {
                    b.warn_once(
                        "stray-end",
                        "an `end` without a `subgraph` was ignored".into(),
                    );
                }
            }
            "direction" => {}
            "classDef" | "class" | "style" | "linkStyle" | "click" => {
                b.warn_once(
                    word,
                    format!("`{word}` lines were ignored: the Studio draws its own styles"),
                );
            }
            _ => {
                let group = match stack.last() {
                    Some(Frame::Group(g)) => Some(g.clone()),
                    // directamente no painel: pertence ao corpo do painel (resolvido no fim)
                    Some(Frame::View(v)) => Some(format!("{BODY_MARK}{v}")),
                    None => None,
                };
                let chars: Vec<char> = s.chars().collect();
                let mut cur = Cursor { c: &chars, i: 0 };
                let Some(mut left) = node_list(&mut cur) else {
                    b.warn_once(&format!("line-{s}"), format!("could not read `{s}`"));
                    continue;
                };
                for (id, def) in left.clone() {
                    b.node(id, def, group.as_deref());
                }
                loop {
                    cur.ws();
                    if cur.done() {
                        break;
                    }
                    let Some((style, label, bidir)) = cur.edge() else {
                        b.warn_once(
                            &format!("line-{s}"),
                            format!("could not read the rest of `{s}`"),
                        );
                        break;
                    };
                    if bidir {
                        b.warn_once(
                            "bidir",
                            "two-way arrows (`<-->`) were imported one way".into(),
                        );
                    }
                    let Some(right) = node_list(&mut cur) else {
                        b.warn_once(
                            &format!("line-{s}"),
                            format!("an arrow in `{s}` has no target"),
                        );
                        break;
                    };
                    for (id, def) in right.clone() {
                        b.node(id, def, group.as_deref());
                    }
                    match style {
                        None => {
                            b.warn_once("invisible", "invisible links (`~~~`) were dropped".into())
                        }
                        Some(st) => {
                            for (f, _) in &left {
                                for (t2, _) in &right {
                                    let n = pair_n.entry((f.clone(), t2.clone())).or_insert(0);
                                    edge_keys.push(Some((f.clone(), t2.clone(), *n)));
                                    *n += 1;
                                    let mut cn = Connection::link(f.clone(), t2.clone());
                                    cn.style = Some(st);
                                    cn.label = label.clone();
                                    b.conns.push(cn);
                                }
                            }
                        }
                    }
                    left = right;
                }
            }
        }
    }
    if !stack.is_empty() {
        b.warnings.push(format!(
            "{} subgraph(s) were not closed with `end`",
            stack.len()
        ));
    }

    // ── corpos dos painéis: o grupo que o export não escreve como subgraph ──
    let view_mids_in_order: Vec<String> = {
        let mut v: Vec<(String, usize)> = b.view_at.iter().map(|(k, i)| (k.clone(), *i)).collect();
        v.sort_by_key(|x| x.1);
        v.into_iter().map(|x| x.0).collect()
    };
    for (vi, vmid) in view_mids_in_order.iter().enumerate() {
        let mark = format!("{BODY_MARK}{vmid}");
        let meta_mid = group_meta
            .iter()
            .find(|(_, m)| m.body.as_deref() == Some(vmid.as_str()))
            .map(|(k, _)| k.clone());
        let direct = b
            .comps
            .iter()
            .any(|c| c.group.as_deref() == Some(mark.as_str()));
        if meta_mid.is_none() && !direct {
            continue;
        }
        let mid = meta_mid.unwrap_or_else(|| {
            let base = format!("{}_body", vmid.strip_prefix(VIEW_PREFIX).unwrap_or(vmid));
            let mut id = base.clone();
            let mut n = 2;
            while b.group_at.contains_key(&id) || b.comp_at.contains_key(&id) {
                id = format!("{base}_{n}");
                n += 1;
            }
            id
        });
        for c in b
            .comps
            .iter_mut()
            .filter(|c| c.group.as_deref() == Some(mark.as_str()))
        {
            c.group = Some(mid.clone());
        }
        let roots = std::mem::take(&mut b.views[vi].roots);
        for g in b.groups.iter_mut().filter(|g| roots.contains(&g.id)) {
            g.parent = Some(mid.clone());
        }
        b.views[vi].roots = vec![mid.clone()];
        b.group_at.insert(mid.clone(), b.groups.len());
        b.groups.push(Group {
            id: mid,
            label: b.views[vi].title.clone(),
            kind: GroupKind::Boundary,
            parent: None,
            style: GroupStyle::Dashed,
            source: None,
        });
    }

    // ── metadados: repõem o modelo exacto ──
    let mut used = 0usize;
    let mut comp_id: HashMap<String, String> = HashMap::new();
    let mut comp_order: Vec<Option<usize>> = vec![None; b.comps.len()];
    let mut guessed = 0usize;
    for (k, c) in b.comps.iter_mut().enumerate() {
        let mid = c.id.clone();
        match node_meta.remove(&mid) {
            Some(m) => {
                used += 1;
                comp_order[k] = Some(m.i);
                c.id = m.id;
                if let Some(kind) = m.kind {
                    c.kind = kind;
                }
                c.outbox = m.outbox;
                c.code = m.code;
                c.source = m.source;
            }
            None => guessed += 1,
        }
        comp_id.insert(mid, c.id.clone());
    }
    let mut group_id: HashMap<String, String> = HashMap::new();
    let mut group_order: Vec<Option<usize>> = vec![None; b.groups.len()];
    for (k, g) in b.groups.iter_mut().enumerate() {
        let mid = g.id.clone();
        if let Some(m) = group_meta.remove(&mid) {
            used += 1;
            group_order[k] = Some(m.i);
            g.id = m.id;
            g.kind = m.kind;
            g.style = m.style;
            g.source = m.source;
        }
        group_id.insert(mid, g.id.clone());
    }
    let view_mids: Vec<String> = {
        let mut v: Vec<(String, usize)> = b.view_at.iter().map(|(k, i)| (k.clone(), *i)).collect();
        v.sort_by_key(|x| x.1);
        v.into_iter().map(|x| x.0).collect()
    };
    for (vi, mid) in view_mids.iter().enumerate() {
        if let Some(m) = view_meta.remove(mid) {
            used += 1;
            let v = &mut b.views[vi];
            v.id = m.id;
            v.title = m.title;
            v.color = m.color;
            v.daemonless = m.daemonless;
            v.strict = m.strict;
        }
    }
    let remap_g = |id: &str| group_id.get(id).cloned().unwrap_or_else(|| id.to_string());
    for c in &mut b.comps {
        c.group = c.group.as_deref().map(remap_g);
    }
    for g in &mut b.groups {
        g.parent = g.parent.as_deref().map(remap_g);
    }
    for v in &mut b.views {
        v.roots = v.roots.iter().map(|r| remap_g(r)).collect();
    }
    for (cn, key) in b.conns.iter_mut().zip(edge_keys.iter()) {
        if let Some(m) = key.as_ref().and_then(|k| edge_meta.remove(k)) {
            used += 1;
            cn.relation = m.relation;
            cn.event = m.event;
            cn.label = m.label;
            cn.protocol = m.protocol;
            cn.style = m.style;
            cn.source = m.source;
        }
        cn.from = comp_id
            .get(&cn.from)
            .cloned()
            .unwrap_or_else(|| cn.from.clone());
        cn.to = comp_id
            .get(&cn.to)
            .cloned()
            .unwrap_or_else(|| cn.to.clone());
    }
    let left_over =
        node_meta.len() + group_meta.len() + view_meta.len() + edge_meta.len() + bad_meta;
    if left_over > 0 {
        b.warnings.push(format!(
            "{left_over} dxtutor metadata line(s) did not match the diagram (was it edited by hand?)"
        ));
    }
    if guessed > 0 && used == 0 {
        b.warnings.push(format!(
            "{guessed} component(s) without dxtutor metadata: their kinds were guessed from the node shapes"
        ));
    } else if guessed > 0 {
        b.warnings.push(format!(
            "{guessed} component(s) had no dxtutor metadata: their kinds were guessed from the node shapes"
        ));
    }

    // Ordem original (quando todos os elementos trazem o índice).
    let comps = reorder(b.comps, &comp_order);
    let groups = reorder(b.groups, &group_order);
    Ok(MermaidImport {
        arch: Architecture {
            components: comps,
            connections: b.conns,
            groups,
            views: b.views,
        },
        warnings: b.warnings,
    })
}

fn reorder<T>(items: Vec<T>, order: &[Option<usize>]) -> Vec<T> {
    if order.iter().any(Option::is_none) {
        return items;
    }
    let mut v: Vec<(usize, T)> = order.iter().map(|o| o.unwrap_or(0)).zip(items).collect();
    v.sort_by_key(|x| x.0);
    v.into_iter().map(|x| x.1).collect()
}

#[cfg(test)]
mod tests {
    use super::super::tests::{docker_vs_k8s, ok_arch};
    use super::*;

    fn js(a: &Architecture) -> String {
        serde_json::to_string_pretty(a).unwrap()
    }
    fn import(src: &str) -> MermaidImport {
        from_mermaid(src).unwrap_or_else(|e| panic!("{e}\n{src}"))
    }

    #[test]
    fn round_trip_system_design_is_exact() {
        let a = docker_vs_k8s();
        let m = to_mermaid(&a);
        let back = import(&m);
        assert!(back.warnings.is_empty(), "{:?}\n{m}", back.warnings);
        assert_eq!(js(&back.arch), js(&a), "{m}");
        // e é Mermaid de verdade: painéis, grupos aninhados, setas de controlo e dados
        assert!(m.starts_with("%% dxtutor-arch v1\ngraph TB\n"), "{m}");
        assert!(m.contains("subgraph view__docker[\"docker\"]"), "{m}");
        assert!(
            m.contains("subgraph control_plane[\"control-plane\"]"),
            "{m}"
        );
        assert!(m.contains("deployment -.->|\"kubectl apply\"| api"), "{m}");
        assert!(m.contains("client --> ingress"), "{m}");
        assert!(m.contains("deployment[(\"Deployment\")]"), "{m}");
    }

    #[test]
    fn round_trip_event_design_is_exact() {
        let a = ok_arch();
        let back = import(&to_mermaid(&a));
        assert_eq!(js(&back.arch), js(&a));
        assert!(back.arch.is_valid());
    }

    #[test]
    fn round_trip_keeps_awkward_ids_names_and_codes() {
        let mut a = Architecture::default();
        let mut c = Component::new("end", "A \"quoted\" | name #1\nsecond line", Kind::Cli);
        c.code = Some("echo 'a|b'; ls #x".into());
        a.components.push(c);
        a.components
            .push(Component::new("ação-1", "Ação", Kind::Daemon));
        a.components
            .push(Component::new("acao_1", "Outra", Kind::Daemon));
        a.components
            .push(Component::new("9lives", "Nove", Kind::Kernel));
        let mut cn = Connection::link("end", "ação-1");
        cn.label = Some("a | b; c".into());
        cn.protocol = Some(Protocol::UnixSocket);
        a.connections.push(cn);
        a.connections.push(Connection::link("end", "ação-1")); // a mesma ligação, outra vez
        let m = to_mermaid(&a);
        let back = import(&m);
        assert!(back.warnings.is_empty(), "{:?}\n{m}", back.warnings);
        assert_eq!(js(&back.arch), js(&a), "{m}");
        assert!(
            m.contains("  end_[\""),
            "o id reservado `end` é escapado: {m}"
        );
    }

    #[test]
    fn depends_style_round_trips() {
        let mut a = Architecture::default();
        a.components
            .push(Component::new("iface", "interface", Kind::Adapter));
        a.components
            .push(Component::new("facade", "facade", Kind::Socket));
        let mut cn = Connection::link("iface", "facade");
        cn.style = Some(EdgeStyle::Depends);
        a.connections.push(cn);
        let m = to_mermaid(&a);
        assert!(m.contains("iface --> facade"), "{m}");
        assert!(m.contains("\"style\":\"depends\""), "{m}");
        assert_eq!(js(&import(&m).arch), js(&a));
    }

    #[test]
    fn group_cycle_exports_without_looping() {
        let mut a = Architecture::default();
        for (id, p) in [("a", "b"), ("b", "a")] {
            a.groups.push(Group {
                id: id.into(),
                label: id.into(),
                kind: GroupKind::Module,
                parent: Some(p.into()),
                style: GroupStyle::Dashed,
                source: None,
            });
        }
        let m = to_mermaid(&a);
        assert_eq!(m.matches("subgraph ").count(), 2, "{m}");
    }

    #[test]
    fn not_a_flowchart_is_an_error() {
        let e = from_mermaid("sequenceDiagram\n  A->>B: hi").unwrap_err();
        assert!(e.contains("sequenceDiagram"), "{e}");
        assert!(from_mermaid("").is_err());
        assert!(from_mermaid("%% only a comment").is_err());
    }

    #[test]
    fn hand_written_syntax() {
        let r = import(
            "flowchart LR\n\
             %% a comment\n\
             A[Plain text] & B([\"Stadium\"]) --> C[(Store)]\n\
             C -.-> D((Client)) ==> E>Ext]\n\
             E -- \"says #quot;hi#quot;\" --> F[/Kernel\\]\n\
             F -. maybe .-> G{{Hex}}; G -->|pipe label| H\n\
             H --- I\n\
             I ~~~ J\n\
             classDef red fill:#f00\n\
             class A red",
        );
        let a = &r.arch;
        let kind = |id: &str| a.components.iter().find(|c| c.id == id).unwrap().kind;
        assert_eq!(kind("A"), Kind::Process);
        assert_eq!(kind("C"), Kind::State);
        assert_eq!(kind("D"), Kind::Client);
        assert_eq!(kind("E"), Kind::External);
        assert_eq!(kind("F"), Kind::Kernel);
        assert_eq!(
            a.components.iter().find(|c| c.id == "A").unwrap().name,
            "Plain text"
        );
        let e = |f: &str, t: &str| {
            a.connections
                .iter()
                .find(|c| c.from == f && c.to == t)
                .unwrap()
        };
        assert_eq!(e("A", "C").style, Some(EdgeStyle::Data));
        assert_eq!(e("B", "C").style, Some(EdgeStyle::Data));
        assert_eq!(e("C", "D").style, Some(EdgeStyle::Control));
        assert_eq!(e("D", "E").style, Some(EdgeStyle::Data));
        assert_eq!(e("E", "F").label.as_deref(), Some("says \"hi\""));
        assert_eq!(e("F", "G").label.as_deref(), Some("maybe"));
        assert_eq!(e("F", "G").style, Some(EdgeStyle::Control));
        assert_eq!(e("G", "H").label.as_deref(), Some("pipe label"));
        assert_eq!(e("H", "I").style, Some(EdgeStyle::Optional));
        assert!(
            !a.connections.iter().any(|c| c.from == "I"),
            "~~~ não é uma ligação"
        );
        assert_eq!(a.components.len(), 10);
        let w = r.warnings.join("\n");
        assert!(w.contains("direction `LR`"), "{w}");
        assert!(w.contains("`classDef`") && w.contains("`class`"), "{w}");
        assert!(w.contains("invisible"), "{w}");
        assert!(w.contains("guessed from the node shapes"), "{w}");
    }

    #[test]
    fn subgraph_header_forms_and_nesting() {
        let r = import(
            "graph TD\n\
             subgraph H[\"Host Linux\"]\n\
               a\n\
               subgraph CP [Control Plane]\n\
                 b\n\
               end\n\
             end\n\
             subgraph \"Camada de dados\"\n\
               c\n\
             end\n\
             subgraph Workers\n\
               d\n\
             end\n\
             a --> b --> c\n",
        );
        let g = |id: &str| r.arch.groups.iter().find(|g| g.id == id).unwrap();
        assert_eq!(g("H").kind, GroupKind::Host);
        assert_eq!(g("CP").label, "Control Plane");
        assert_eq!(g("CP").kind, GroupKind::Plane);
        assert_eq!(g("CP").parent.as_deref(), Some("H"));
        assert_eq!(g("Camada_de_dados").kind, GroupKind::Layer);
        assert_eq!(g("Workers").label, "Workers");
        let grp = |id: &str| {
            r.arch
                .components
                .iter()
                .find(|c| c.id == id)
                .unwrap()
                .group
                .clone()
        };
        assert_eq!(grp("a").as_deref(), Some("H"));
        assert_eq!(grp("b").as_deref(), Some("CP"));
        assert_eq!(grp("c").as_deref(), Some("Camada_de_dados"));
        assert_eq!(
            r.arch.connections.len(),
            2,
            "a cadeia a → b → c dá duas setas"
        );
    }

    #[test]
    fn view_prefixed_subgraphs_become_panels() {
        let r = import(
            "graph TB\n\
             subgraph view__left[\"Docker\"]\n  subgraph host[\"Host\"]\n    d1\n  end\nend\n\
             subgraph view__right[\"Delonix\"]\n  subgraph h2[\"Host\"]\n    x\n  end\nend\n",
        );
        let v: Vec<(&str, &str, Vec<String>)> = r
            .arch
            .views
            .iter()
            .map(|v| (v.id.as_str(), v.title.as_str(), v.roots.clone()))
            .collect();
        assert_eq!(
            v,
            vec![
                ("left", "Docker", vec!["host".to_string()]),
                ("right", "Delonix", vec!["h2".to_string()])
            ]
        );
        assert!(r.arch.groups.iter().all(|g| g.parent.is_none()));
    }

    #[test]
    fn semicolons_split_statements_but_not_entities() {
        let r = import("graph TB; A[\"x #59; y\"] --> B; B --> C[a#35;b]");
        assert_eq!(r.arch.components[0].name, "x ; y");
        assert_eq!(r.arch.components[2].name, "a#b");
        assert_eq!(r.arch.connections.len(), 2);
    }

    /// A referência com corpos de painel (o grupo raiz com o nome do painel), como a UI os cria.
    fn with_bodies() -> Architecture {
        let mut a = docker_vs_k8s();
        a.views[0].title = "Docker".into();
        a.views[1].title = "Kubernetes".into();
        for (g, label) in [(0, "Docker"), (1, "Kubernetes")] {
            a.groups[g].label = label.into();
        }
        a
    }

    #[test]
    fn panel_bodies_are_not_a_second_subgraph() {
        let a = with_bodies();
        let m = to_mermaid(&a);
        // cada título uma vez: o subgraph do painel, e não outro do corpo lá dentro
        assert_eq!(m.matches("[\"Docker\"]").count(), 1, "{m}");
        assert_eq!(m.matches("[\"Kubernetes\"]").count(), 1, "{m}");
        assert!(!m.contains("subgraph host["), "{m}");
        assert!(m.contains("\"body\":\"view__docker\""), "{m}");
        let back = import(&m);
        assert!(back.warnings.is_empty(), "{:?}", back.warnings);
        assert_eq!(js(&back.arch), js(&a), "{m}");
    }

    #[test]
    fn hand_written_nodes_directly_in_a_panel_get_a_body() {
        let r = import(
            "graph TB\n\
             subgraph view__dlx[\"Delonix\"]\n  cli[\"delonix CLI\"]\n  subgraph host[\"Host\"]\n    ctr\n  end\nend\n\
             cli --> ctr\n",
        );
        let v = &r.arch.views[0];
        assert_eq!(v.roots, vec!["dlx_body".to_string()]);
        let body = r.arch.groups.iter().find(|g| g.id == "dlx_body").unwrap();
        assert_eq!(body.label, "Delonix");
        assert_eq!(body.parent, None);
        let g = |id: &str| {
            r.arch
                .components
                .iter()
                .find(|c| c.id == id)
                .unwrap()
                .group
                .clone()
        };
        assert_eq!(g("cli").as_deref(), Some("dlx_body"));
        assert_eq!(g("ctr").as_deref(), Some("host"));
        assert_eq!(
            r.arch
                .groups
                .iter()
                .find(|g| g.id == "host")
                .unwrap()
                .parent
                .as_deref(),
            Some("dlx_body")
        );
        assert!(r.arch.validate().is_empty(), "{:?}", r.arch.validate());
        assert!(
            !r.warnings.iter().any(|w| w.contains("panel")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn edited_metadata_is_reported_not_trusted_blindly() {
        let m = to_mermaid(&docker_vs_k8s()).replace("%% dxt:node runc ", "%% dxt:node ghost ");
        let r = import(&m);
        assert!(
            r.warnings.iter().any(|w| w.contains("did not match")),
            "{:?}",
            r.warnings
        );
        assert!(
            r.warnings
                .iter()
                .any(|w| w.contains("had no dxtutor metadata")),
            "{:?}",
            r.warnings
        );
        let runc = r.arch.components.iter().find(|c| c.id == "runc").unwrap();
        assert_eq!(
            runc.kind,
            Kind::Process,
            "sem metadados, o tipo vem da forma"
        );
    }
}
