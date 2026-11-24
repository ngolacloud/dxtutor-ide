//! `tutor-board` — persistência SQLite do Board (kanban) do dxtutor.
//!
//! O Board deixou de ser estado só-cliente (localStorage) e passa a ter um backend durável:
//! um backlog por *workspace* (chaveado pela raiz da pasta aberta, ou `"default"` sem pasta),
//! estruturado em **sprints** e **user stories** — nunca épicos. Cada story carrega a sua
//! narrativa (papel/quero/para-quê), critérios de aceitação, e um **prompt-template de
//! execução** (context engineering) que o assistente usará para implementar a feature.
//!
//! Propriedades centrais (como o [`tutor_track`](../tutor_track) irmão):
//! - **Durabilidade**: sobrevive ao reinício da app.
//! - **Idempotência**: `save_board` substitui atomicamente o estado de uma raiz; reaplicar o
//!   mesmo backlog deixa a base exactamente igual (sem duplicar stories).
//! - **Isolamento por workspace**: cada raiz vê apenas o seu backlog.

pub mod project;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Uma *sprint*: um objectivo entregável num ciclo, com um conjunto de stories.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Sprint {
    /// Índice 0-based da sprint (Sprint 1 = 0).
    pub index: u32,
    /// Objectivo da sprint (uma frase — o "porquê" do conjunto de stories).
    pub goal: String,
}

/// Uma **user story** — a unidade de trabalho do Board. Evita épicos: é pequena, testável e
/// descreve valor para um papel concreto.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    /// Identificador estável, p.ex. `DX-12`.
    pub id: String,
    /// Sprint a que pertence (índice 0-based).
    pub sprint: u32,
    /// Papel — "Como \<papel\>".
    pub role: String,
    /// Capacidade desejada — "quero \<capacidade\>".
    pub want: String,
    /// Benefício — "para \<benefício\>".
    #[serde(rename = "soThat")]
    pub so_that: String,
    /// Critérios de aceitação verificáveis (Given/When/Then ou afirmações observáveis).
    pub acceptance: Vec<String>,
    /// Estimativa em pontos (Fibonacci curto: 1,2,3,5,8).
    pub points: u32,
    /// Coluna do kanban: `backlog|todo|dev|test|func|done`.
    pub stage: String,
    /// Tipo: `feature|fix`.
    pub kind: String,
    /// Prompt-template de execução (context engineering) — o que se envia ao assistente para
    /// implementar a story seguindo boas práticas de engenharia de IA.
    pub prompt: String,
    /// Nota livre (p.ex. motivo de rejeição, veredicto de teste).
    #[serde(default)]
    pub note: String,
    /// Ramo git associado, se houver.
    #[serde(default)]
    pub branch: Option<String>,
    /// Campos do quadro da UI sem coluna própria (agente dono, dono humano, commit do merge,
    /// componente do Studio, revisão/explicação, custo…), guardados tal-e-qual como JSON. O
    /// backend não os interpreta: é a UI que os escreve e lê (ADR-0006, R3b).
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
}

/// O backlog completo de um workspace: o problema de origem, as sprints e as stories.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Backlog {
    /// Enunciado do problema que gerou este backlog (rastreabilidade).
    #[serde(default)]
    pub problem: String,
    /// Sequência para o próximo id `DX-N`.
    #[serde(default)]
    pub seq: u32,
    pub sprints: Vec<Sprint>,
    pub stories: Vec<Story>,
}

/// Armazenamento SQLite do Board.
pub struct BoardStore {
    conn: Connection,
}

impl BoardStore {
    /// Abre (ou cria) a base num ficheiro e garante o esquema.
    pub fn open(path: &std::path::Path) -> rusqlite::Result<Self> {
        Self::from_conn(Connection::open(path)?)
    }

    /// Base em memória (testes / efémero).
    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::from_conn(Connection::open_in_memory()?)
    }

    fn from_conn(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS boards (
                root     TEXT PRIMARY KEY,
                problem  TEXT NOT NULL,
                seq      INTEGER NOT NULL,
                updated  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sprints (
                root     TEXT NOT NULL,
                idx      INTEGER NOT NULL,
                goal     TEXT NOT NULL,
                PRIMARY KEY (root, idx)
            );
            CREATE TABLE IF NOT EXISTS stories (
                root        TEXT NOT NULL,
                id          TEXT NOT NULL,
                sprint      INTEGER NOT NULL,
                role        TEXT NOT NULL,
                want        TEXT NOT NULL,
                so_that     TEXT NOT NULL,
                acceptance  TEXT NOT NULL,
                points      INTEGER NOT NULL,
                stage       TEXT NOT NULL,
                kind        TEXT NOT NULL,
                prompt      TEXT NOT NULL,
                note        TEXT NOT NULL,
                branch      TEXT,
                ord         INTEGER NOT NULL,
                PRIMARY KEY (root, id)
            );
            CREATE INDEX IF NOT EXISTS idx_stories_root ON stories(root);",
        )?;
        // Migração aditiva (ADR-0006, R3b): bases criadas antes da coluna `meta` ganham-na.
        let has_meta = {
            let mut st = conn.prepare("PRAGMA table_info(stories)")?;
            let names = st
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            names.iter().any(|n| n == "meta")
        };
        if !has_meta {
            conn.execute_batch("ALTER TABLE stories ADD COLUMN meta TEXT")?;
        }
        Ok(Self { conn })
    }

    /// Grava o backlog de `root` de forma ATÓMICA e IDEMPOTENTE: apaga o estado anterior desta
    /// raiz e reinsere o novo. Reaplicar o mesmo backlog deixa a base exactamente igual.
    pub fn save_board(&mut self, root: &str, b: &Backlog, now: i64) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM stories WHERE root = ?1", params![root])?;
        tx.execute("DELETE FROM sprints WHERE root = ?1", params![root])?;
        tx.execute(
            "INSERT OR REPLACE INTO boards (root, problem, seq, updated) VALUES (?1, ?2, ?3, ?4)",
            params![root, b.problem, b.seq, now],
        )?;
        for s in &b.sprints {
            tx.execute(
                "INSERT INTO sprints (root, idx, goal) VALUES (?1, ?2, ?3)",
                params![root, s.index, s.goal],
            )?;
        }
        for (ord, st) in b.stories.iter().enumerate() {
            let acceptance = serde_json::to_string(&st.acceptance)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            let meta = match &st.meta {
                Some(v) => Some(
                    serde_json::to_string(v)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                ),
                None => None,
            };
            tx.execute(
                "INSERT INTO stories
                   (root, id, sprint, role, want, so_that, acceptance, points, stage, kind, prompt, note, branch, ord, meta)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    root, st.id, st.sprint, st.role, st.want, st.so_that, acceptance,
                    st.points, st.stage, st.kind, st.prompt, st.note, st.branch, ord as i64, meta
                ],
            )?;
        }
        tx.commit()
    }

    /// Lê o backlog de `root`, ou `None` se ainda não existe.
    pub fn load_board(&self, root: &str) -> rusqlite::Result<Option<Backlog>> {
        let mut head = self
            .conn
            .prepare("SELECT problem, seq FROM boards WHERE root = ?1")?;
        let mut rows = head.query(params![root])?;
        let (problem, seq): (String, u32) = match rows.next()? {
            Some(r) => (r.get(0)?, r.get::<_, i64>(1)? as u32),
            None => return Ok(None),
        };

        let mut sp = self
            .conn
            .prepare("SELECT idx, goal FROM sprints WHERE root = ?1 ORDER BY idx")?;
        let sprints = sp
            .query_map(params![root], |r| {
                Ok(Sprint {
                    index: r.get::<_, i64>(0)? as u32,
                    goal: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut so = self.conn.prepare(
            "SELECT id, sprint, role, want, so_that, acceptance, points, stage, kind, prompt, note, branch, meta
             FROM stories WHERE root = ?1 ORDER BY ord",
        )?;
        let stories = so
            .query_map(params![root], |r| {
                let acc_json: String = r.get(5)?;
                let acceptance: Vec<String> = serde_json::from_str(&acc_json).unwrap_or_default();
                Ok(Story {
                    id: r.get(0)?,
                    sprint: r.get::<_, i64>(1)? as u32,
                    role: r.get(2)?,
                    want: r.get(3)?,
                    so_that: r.get(4)?,
                    acceptance,
                    points: r.get::<_, i64>(6)? as u32,
                    stage: r.get(7)?,
                    kind: r.get(8)?,
                    prompt: r.get(9)?,
                    note: r.get(10)?,
                    branch: r.get(11)?,
                    meta: r
                        .get::<_, Option<String>>(12)?
                        .and_then(|m| serde_json::from_str(&m).ok()),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(Some(Backlog {
            problem,
            seq,
            sprints,
            stories,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Backlog {
        Backlog {
            problem: "Marketplace precisa de carrinho de compras".into(),
            seq: 3,
            sprints: vec![
                Sprint { index: 0, goal: "Carrinho mínimo utilizável".into() },
                Sprint { index: 1, goal: "Checkout e pagamento".into() },
            ],
            stories: vec![
                Story {
                    id: "DX-1".into(), sprint: 0,
                    role: "comprador".into(),
                    want: "adicionar um produto ao carrinho".into(),
                    so_that: "reunir o que vou comprar antes de pagar".into(),
                    acceptance: vec![
                        "Dado um produto na lista, Quando clico «Adicionar», Então o contador do carrinho aumenta em 1".into(),
                        "O item adicionado aparece no carrinho com nome, preço e quantidade 1".into(),
                    ],
                    points: 3, stage: "backlog".into(), kind: "feature".into(),
                    prompt: "## Contexto\nProjecto …\n## Tarefa\nImplementar …\n## Critérios\n- …".into(),
                    note: String::new(), branch: None, meta: None,
                },
                Story {
                    id: "DX-2".into(), sprint: 1,
                    role: "comprador".into(),
                    want: "pagar com cartão no checkout".into(),
                    so_that: "concluir a compra".into(),
                    acceptance: vec!["Pagamento aprovado → pedido criado".into()],
                    points: 5, stage: "backlog".into(), kind: "feature".into(),
                    prompt: "## Contexto\n…".into(),
                    note: String::new(), branch: Some("feature/checkout".into()),
                    meta: Some(serde_json::json!({ "agent": "be", "owner": "you" })),
                },
            ],
        }
    }

    #[test]
    fn save_then_load_round_trips() {
        let mut s = BoardStore::in_memory().unwrap();
        let b = sample();
        s.save_board("/ws/shop", &b, 1000).unwrap();
        let got = s.load_board("/ws/shop").unwrap().expect("board exists");
        assert_eq!(got, b);
    }

    #[test]
    fn reapplying_same_board_is_idempotent() {
        let mut s = BoardStore::in_memory().unwrap();
        let b = sample();
        s.save_board("/ws/shop", &b, 1).unwrap();
        s.save_board("/ws/shop", &b, 2).unwrap(); // reaplica
        let got = s.load_board("/ws/shop").unwrap().unwrap();
        assert_eq!(got.stories.len(), 2, "sem duplicados");
        assert_eq!(got, b);
    }

    #[test]
    fn boards_are_isolated_per_workspace() {
        let mut s = BoardStore::in_memory().unwrap();
        s.save_board("/ws/a", &sample(), 1).unwrap();
        assert!(
            s.load_board("/ws/b").unwrap().is_none(),
            "outra raiz não vê"
        );
        // Guardar em /ws/b não mexe em /ws/a.
        let mut only_one = sample();
        only_one.stories.truncate(1);
        only_one.sprints.truncate(1);
        s.save_board("/ws/b", &only_one, 1).unwrap();
        assert_eq!(s.load_board("/ws/a").unwrap().unwrap().stories.len(), 2);
        assert_eq!(s.load_board("/ws/b").unwrap().unwrap().stories.len(), 1);
    }

    #[test]
    fn save_replaces_previous_state() {
        let mut s = BoardStore::in_memory().unwrap();
        s.save_board("/ws/a", &sample(), 1).unwrap();
        let mut smaller = sample();
        smaller.stories.truncate(1);
        s.save_board("/ws/a", &smaller, 2).unwrap();
        let got = s.load_board("/ws/a").unwrap().unwrap();
        assert_eq!(
            got.stories.len(),
            1,
            "estado anterior substituído, não acumulado"
        );
    }

    #[test]
    fn meta_round_trips_and_old_dbs_gain_the_column() {
        // uma base antiga, sem a coluna `meta`
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE stories (root TEXT NOT NULL, id TEXT NOT NULL, sprint INTEGER NOT NULL, role TEXT NOT NULL,
               want TEXT NOT NULL, so_that TEXT NOT NULL, acceptance TEXT NOT NULL, points INTEGER NOT NULL,
               stage TEXT NOT NULL, kind TEXT NOT NULL, prompt TEXT NOT NULL, note TEXT NOT NULL, branch TEXT,
               ord INTEGER NOT NULL, PRIMARY KEY (root, id));",
        )
        .unwrap();
        let mut s = BoardStore::from_conn(conn).unwrap();
        let b = sample();
        s.save_board("/ws", &b, 1).unwrap();
        let got = s.load_board("/ws").unwrap().unwrap();
        assert_eq!(
            got.stories[1].meta,
            Some(serde_json::json!({ "agent": "be", "owner": "you" }))
        );
        assert_eq!(got.stories[0].meta, None);
        assert_eq!(got, b);
    }
}
