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
    /// H5c: images, inside the `tool_result` of the tool that produced them.
    pub images: Vec<Image>,
}

/// H5c: an image for the model, already sized when it enters the conversation (the history never changes it
/// afterwards): its media type and the bytes in base64.
#[derive(Debug, Clone, PartialEq)]
pub struct Image {
    /// `image/png`, `image/jpeg`, `image/gif` or `image/webp`
    pub media_type: String,
    pub data: String,
}

/// The largest image the agent sends, in bytes before base64 (the API takes up to 5 MB of base64 per image).
pub const MAX_IMAGE_BYTES: usize = 3_750_000;

impl Image {
    /// The media type of an image by its first bytes (the extension is not trusted).
    pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
        if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
            Some("image/png")
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            Some("image/jpeg")
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            Some("image/gif")
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some("image/webp")
        } else {
            None
        }
    }

    /// An image from its bytes: a known type and at most [`MAX_IMAGE_BYTES`] — otherwise why not.
    pub fn from_bytes(bytes: &[u8]) -> Result<Image, String> {
        let media_type = Image::sniff(bytes)
            .ok_or("not a PNG, JPEG, GIF or WebP image")?
            .to_string();
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "the image has {} bytes; at most {MAX_IMAGE_BYTES} go to the model — downscale it first",
                bytes.len()
            ));
        }
        Ok(Image {
            media_type,
            data: base64_encode(bytes),
        })
    }

    /// The image as an API content block.
    pub fn block(&self) -> Value {
        json!({"type": "image", "source": {"type": "base64", "media_type": self.media_type, "data": self.data}})
    }

    /// The images of API content blocks (a `tool_result`'s array content, a user message's blocks).
    pub fn from_blocks(blocks: &[Value]) -> Vec<Image> {
        blocks
            .iter()
            .filter(|b| b["type"] == "image" && b["source"]["type"] == "base64")
            .map(|b| Image {
                media_type: b["source"]["media_type"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                data: b["source"]["data"].as_str().unwrap_or_default().to_string(),
            })
            .collect()
    }
}

/// Standard base64 back to bytes (padding optional; `None` on anything else).
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let s = s.trim_end_matches('=').as_bytes();
    if s.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for c in s.chunks(4) {
        let mut n = 0u32;
        for (k, b) in c.iter().enumerate() {
            n |= val(*b)? << (18 - 6 * k);
        }
        out.push((n >> 16) as u8);
        if c.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if c.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// Standard base64 (no line breaks).
pub fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
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
                // H5c: with images, the content is blocks — the text, then each image
                let content = if r.images.is_empty() {
                    Value::String(r.content.clone())
                } else {
                    let mut v = vec![json!({"type": "text", "text": r.content})];
                    v.extend(r.images.iter().map(Image::block));
                    Value::Array(v)
                };
                let mut b = json!({
                    "type": "tool_result",
                    "tool_use_id": r.tool_use_id,
                    "content": content,
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
    /// A new transcript with the first `n` messages ("Rewind to here", A3): a prefix of what
    /// was sent is still valid to continue from; the live transcript is never edited.
    pub fn truncated(&self, n: usize) -> Transcript {
        Transcript(self.0[..n.min(self.0.len())].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_sniffed_sized_and_go_inside_their_tool_result() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        for x in [
            &b""[..],
            b"f",
            b"fo",
            b"foo",
            b"foob",
            b"\x00\xff\x10binary",
        ] {
            assert_eq!(base64_decode(&base64_encode(x)).as_deref(), Some(x));
        }
        assert_eq!(base64_decode("Zm9v!"), None);
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
        assert_eq!(Image::sniff(&png), Some("image/png"));
        assert_eq!(Image::sniff(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(Image::sniff(b"GIF89a.."), Some("image/gif"));
        assert_eq!(Image::sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(Image::sniff(b"%PDF-1.7"), None);
        assert!(Image::from_bytes(b"hello").is_err());
        let mut big = png.to_vec();
        big.resize(MAX_IMAGE_BYTES + 1, 0);
        assert!(Image::from_bytes(&big).unwrap_err().contains("downscale"));
        let img = Image::from_bytes(&png).unwrap();
        let m = Message::tool_results(&[ToolResult {
            tool_use_id: "a".into(),
            content: "shot.png".into(),
            is_error: false,
            images: vec![img.clone()],
        }]);
        let c = &m.content[0]["content"];
        assert_eq!(c[0], json!({"type": "text", "text": "shot.png"}));
        assert_eq!(c[1]["type"], "image");
        assert_eq!(c[1]["source"]["media_type"], "image/png");
        assert_eq!(Image::from_blocks(c.as_array().unwrap()), vec![img]);
    }

    #[test]
    fn tool_results_go_in_one_user_message_with_is_error_only_when_set() {
        let m = Message::tool_results(&[
            ToolResult {
                tool_use_id: "a".into(),
                content: "ok".into(),
                is_error: false,
                images: Vec::new(),
            },
            ToolResult {
                tool_use_id: "b".into(),
                content: "boom".into(),
                is_error: true,
                images: Vec::new(),
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
