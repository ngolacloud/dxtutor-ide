//! Tipos canónicos da conversa.
//!
//! O conteúdo de cada mensagem é guardado como o JSON dos blocos (`Vec<Value>`), não
//! como um enum reinterpretado: os blocos que o modelo devolve (`thinking` com a sua
//! `signature`, `redacted_thinking`, `compaction`, `fallback`, `text` com `citations`, e
//! tipos futuros) têm de voltar ao servidor **exactamente** como vieram. As vistas
//! tipadas ([`Message::tool_uses`], [`Message::text`]) lêem esse JSON sem o alterar.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    /// Mensagem `system` a meio da conversa (instrução do operador — ex.: mudança de modo)
    /// sem tocar no `system` de topo, que invalidaria a cache.
    System,
}

/// Uma mensagem da conversa: papel + blocos de conteúdo (JSON da API).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<Value>,
}

/// Uma chamada de ferramenta pedida pelo modelo (vista tipada de um bloco `tool_use`).
#[derive(Debug, Clone, PartialEq)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// O resultado de uma ferramenta, para devolver ao modelo.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
}

impl Message {
    /// Mensagem do utilizador só com texto.
    pub fn user_text(text: impl Into<String>) -> Self {
        Message {
            role: Role::User,
            content: vec![json!({ "type": "text", "text": text.into() })],
        }
    }

    /// Instrução do operador a meio da conversa (vai como `role: "system"`; tem de seguir
    /// uma mensagem do utilizador e ser a última ou ser seguida do assistente).
    pub fn system(text: impl Into<String>) -> Self {
        Message {
            role: Role::System,
            content: vec![json!({ "type": "text", "text": text.into() })],
        }
    }

    /// Mensagem do assistente com os blocos tal como chegaram do servidor.
    pub fn assistant(content: Vec<Value>) -> Self {
        Message {
            role: Role::Assistant,
            content,
        }
    }

    /// **Todos** os resultados de um turno numa só mensagem `user` — partir os
    /// resultados de chamadas paralelas por várias mensagens ensina o modelo a deixar
    /// de as fazer em paralelo.
    pub fn tool_results(results: &[ToolResult]) -> Self {
        let content = results
            .iter()
            .map(|r| {
                let mut b = json!({
                    "type": "tool_result",
                    "tool_use_id": r.tool_use_id,
                    "content": r.content,
                });
                if r.is_error {
                    b["is_error"] = Value::Bool(true);
                }
                b
            })
            .collect();
        Message {
            role: Role::User,
            content,
        }
    }

    /// Os blocos `tool_use` desta mensagem, por ordem.
    pub fn tool_uses(&self) -> Vec<ToolUse> {
        self.content
            .iter()
            .filter(|b| b["type"] == "tool_use")
            .map(|b| ToolUse {
                id: b["id"].as_str().unwrap_or_default().to_string(),
                name: b["name"].as_str().unwrap_or_default().to_string(),
                input: b.get("input").cloned().unwrap_or_else(|| json!({})),
            })
            .collect()
    }

    /// O texto visível (blocos `text`) concatenado.
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("")
    }
}

/// O histórico de uma sessão. **Só cresce**: não há remoção, edição nem reordenação.
/// Reduzir contexto faz-se por compactação no servidor (F5), nunca reescrevendo o que
/// já foi enviado — o *preserved thinking* invalida blocos `thinking` quando o
/// histórico anterior muda.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Transcript(Vec<Message>);

impl Transcript {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, m: Message) {
        self.0.push(m);
    }
    pub fn messages(&self) -> &[Message] {
        &self.0
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn last(&self) -> Option<&Message> {
        self.0.last()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_results_go_in_one_user_message_with_is_error_only_when_set() {
        let m = Message::tool_results(&[
            ToolResult {
                tool_use_id: "a".into(),
                content: "ok".into(),
                is_error: false,
            },
            ToolResult {
                tool_use_id: "b".into(),
                content: "boom".into(),
                is_error: true,
            },
        ]);
        assert_eq!(m.role, Role::User);
        assert_eq!(m.content.len(), 2);
        assert!(m.content[0].get("is_error").is_none());
        assert_eq!(m.content[1]["is_error"], true);
    }

    #[test]
    fn views_read_without_touching_unknown_blocks() {
        let blocks = vec![
            json!({"type":"thinking","thinking":"hmm","signature":"sig=="}),
            json!({"type":"text","text":"Vou ler "}),
            json!({"type":"text","text":"o ficheiro.","citations":[]}),
            json!({"type":"tool_use","id":"t1","name":"read","input":{"path":"a.rs"}}),
            json!({"type":"something_new","x":1}),
        ];
        let m = Message::assistant(blocks.clone());
        assert_eq!(m.text(), "Vou ler o ficheiro.");
        assert_eq!(m.tool_uses()[0].input["path"], "a.rs");
        // serializa tal como recebeu (é isto que volta ao servidor)
        let back: Message = serde_json::from_value(serde_json::to_value(&m).unwrap()).unwrap();
        assert_eq!(back.content, blocks);
    }

    #[test]
    fn transcript_serializes_as_a_plain_list() {
        let mut t = Transcript::new();
        t.push(Message::user_text("olá"));
        let v = serde_json::to_value(&t).unwrap();
        assert!(v.is_array());
        assert_eq!(v[0]["role"], "user");
    }
}
