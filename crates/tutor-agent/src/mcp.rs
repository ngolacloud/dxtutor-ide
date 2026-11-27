//! Cliente MCP (Model Context Protocol) sobre stdio (F7).
//!
//! Configuração (formato habitual dos clientes MCP):
//! ```json
//! { "mcpServers": { "github": { "command": "npx", "args": ["-y", "@x/mcp-github"], "env": {"TOKEN": "…"} } } }
//! ```
//! em `~/.config/dxtutor/mcp.json` (do utilizador) e `.dxtutor/mcp.json` (do projecto — só
//! arranca se o humano confiou nele, [`crate::trust`]: são comandos definidos pelo repo).
//!
//! JSON-RPC 2.0, uma mensagem por linha: `initialize` → `notifications/initialized` →
//! `tools/list` (com paginação) → `tools/call`. Cada ferramenta de um servidor é exposta ao
//! agente como `mcp__<servidor>__<ferramenta>`; não é só leitura (a política decide).
//!
//! H5e — servidores remotos (o transporte «Streamable HTTP» do MCP):
//! ```json
//! { "mcpServers": { "docs": { "url": "https://mcp.example.com/mcp", "headers": {"Authorization": "Bearer ${env:DOCS_TOKEN}"} } } }
//! ```
//! Cada mensagem é um `POST` ao `url` (`Accept: application/json, text/event-stream`); a resposta vem em JSON ou
//! num stream SSE; a sessão segue no cabeçalho `Mcp-Session-Id` (e um `DELETE` fecha-a). Só `https`, ou `http` para
//! esta máquina. `${env:NOME}` nos cabeçalhos lê-se do ambiente do IDE (o token não fica no ficheiro). A ligação é
//! do IDE (fora da sandbox dos comandos); um `.dxtutor/mcp.json` do projecto continua a precisar da confiança do
//! humano. Sem OAuth por agora.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::tool::{Tool, ToolCtx, ToolOutput};

pub const PROJECT_FILE: &str = ".dxtutor/mcp.json";
pub const PROTOCOL_VERSION: &str = "2025-06-18";
const INIT_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Default)]
pub struct ServerConfig {
    /// a local server (stdio): its program — or, for a remote one, `url`
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// H5e: a remote server (Streamable HTTP)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// H5e: headers sent to a remote server (`${env:NAME}` read from the IDE's environment)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
}

/// H5e: whether a remote server's address is acceptable: `https`, or `http` only for this machine.
pub fn url_allowed(url: &str) -> Result<(), String> {
    let host =
        crate::tools::web::host_of(url).ok_or_else(|| format!("«{url}» is not an http(s) URL"))?;
    if url.trim().starts_with("https://") {
        return Ok(());
    }
    if matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
        return Ok(());
    }
    Err(format!(
        "«{url}»: a remote MCP server needs https (http only for this machine)"
    ))
}

/// H5e: `${env:NAME}` in a header, from the IDE's environment (a missing variable is an error, never empty).
pub fn expand_env(value: &str) -> Result<String, String> {
    let re = regex::Regex::new(r"\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}").unwrap();
    let mut missing = None;
    let out = re.replace_all(value, |c: &regex::Captures| match std::env::var(&c[1]) {
        Ok(v) => v,
        Err(_) => {
            missing = Some(c[1].to_string());
            String::new()
        }
    });
    match missing {
        Some(n) => Err(format!("${{env:{n}}} is not set in the IDE's environment")),
        None => Ok(out.into_owned()),
    }
}

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    #[serde(default, rename = "mcpServers", alias = "servers")]
    servers: BTreeMap<String, ServerConfig>,
}

/// Lê um ficheiro de configuração MCP. Inexistente → vazio.
pub fn load_config(path: &Path) -> Result<BTreeMap<String, ServerConfig>, String> {
    let servers = match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str::<ConfigFile>(&t)
            .map(|f| f.servers)
            .map_err(|e| format!("{}: {e}", path.display()))?,
        Err(_) => return Ok(BTreeMap::new()),
    };
    // H5e: a server is local (`command`) or remote (`url`), never both or neither
    for (name, s) in &servers {
        match (s.command.trim().is_empty(), &s.url) {
            (true, None) => {
                return Err(format!(
                    "{}: {name}: needs `command` or `url`",
                    path.display()
                ))
            }
            (false, Some(_)) => {
                return Err(format!(
                    "{}: {name}: `command` or `url`, not both",
                    path.display()
                ))
            }
            (true, Some(u)) => {
                url_allowed(u).map_err(|e| format!("{}: {name}: {e}", path.display()))?
            }
            _ => {}
        }
    }
    Ok(servers)
}

pub fn user_config() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(std::path::PathBuf::from(home).join(".config/dxtutor/mcp.json"))
}

/// Uma ferramenta anunciada por um servidor (e gravada com a sessão, para a retoma enviar
/// as mesmas definições).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpToolDef {
    pub server: String,
    /// Nome no servidor.
    pub tool: String,
    /// Nome exposto ao modelo (`mcp__servidor__ferramenta`).
    pub exposed: String,
    pub description: String,
    pub input_schema: Value,
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// `mcp__<servidor>__<ferramenta>`, no máximo 64 caracteres (limite da API).
pub fn exposed_name(server: &str, tool: &str) -> String {
    let n = format!("mcp__{}__{}", sanitize(server), sanitize(tool));
    n.chars().take(64).collect()
}

enum Transport {
    /// a local server: the process dies with the connection
    Stdio {
        child: Child,
        stdin: ChildStdin,
        rx: Receiver<Value>,
    },
    /// H5e: a remote server (Streamable HTTP)
    Http {
        agent: ureq::Agent,
        url: String,
        headers: Vec<(String, String)>,
        session: Option<String>,
    },
}

/// Uma ligação a um servidor MCP (o processo morre com ela; a sessão remota fecha-se).
pub struct McpClient {
    pub name: String,
    transport: Transport,
    next_id: u64,
}

impl Drop for McpClient {
    fn drop(&mut self) {
        match &mut self.transport {
            Transport::Stdio { child, .. } => {
                let _ = child.kill();
                let _ = child.wait();
            }
            Transport::Http {
                agent,
                url,
                headers,
                session: Some(sid),
            } => {
                let mut r = agent
                    .delete(url)
                    .timeout(Duration::from_secs(3))
                    .set("Mcp-Session-Id", sid)
                    .set("MCP-Protocol-Version", PROTOCOL_VERSION);
                for (k, v) in headers.iter() {
                    r = r.set(k, v);
                }
                let _ = r.call();
            }
            Transport::Http { .. } => {}
        }
    }
}

/// H5e: the JSON-RPC messages of an SSE body (`data:` lines, events split by a blank line), stopping at the
/// response to `id` (a stream may stay open after it).
fn sse_messages(reader: impl std::io::Read, id: &Value) -> Vec<Value> {
    let mut out = vec![];
    let mut data = String::new();
    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if !data.is_empty() {
                if let Ok(v) = serde_json::from_str::<Value>(&data) {
                    let done = v.get("id") == Some(id) && v.get("method").is_none();
                    out.push(v);
                    if done {
                        return out;
                    }
                }
                data.clear();
            }
            continue;
        }
        if let Some(d) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(d.strip_prefix(' ').unwrap_or(d));
        }
    }
    if let Ok(v) = serde_json::from_str::<Value>(&data) {
        out.push(v);
    }
    out
}

impl McpClient {
    /// Arranca o servidor e faz o handshake.
    pub fn connect(name: &str, cfg: &ServerConfig, cwd: &Path) -> Result<Self, String> {
        Self::connect_in(name, cfg, cwd, None)
    }

    /// [`connect`](Self::connect) with the server inside the OS sandbox (H1b), when there is one.
    pub fn connect_in(
        name: &str,
        cfg: &ServerConfig,
        cwd: &Path,
        sandbox: Option<&crate::os_sandbox::OsSandbox>,
    ) -> Result<Self, String> {
        if let Some(url) = &cfg.url {
            return Self::connect_http(name, url, &cfg.headers);
        }
        let mut cmd = Command::new(&cfg.command);
        cmd.args(&cfg.args).envs(&cfg.env).current_dir(cwd);
        let mut cmd = match sandbox {
            Some(sb) => sb.wrap(&cmd),
            None => cmd,
        };
        cmd.current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("MCP {name}: não arrancou «{}»: {e}", cfg.command))?;
        let stdin = child.stdin.take().ok_or("sem stdin")?;
        let stdout = child.stdout.take().ok_or("sem stdout")?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    if tx.send(v).is_err() {
                        break;
                    }
                }
            }
        });
        let c = McpClient {
            name: name.to_string(),
            transport: Transport::Stdio { child, stdin, rx },
            next_id: 1,
        };
        c.handshake()
    }

    /// H5e: a remote server — its address checked, its headers expanded, then the handshake.
    fn connect_http(
        name: &str,
        url: &str,
        headers: &BTreeMap<String, String>,
    ) -> Result<Self, String> {
        url_allowed(url).map_err(|e| format!("MCP {name}: {e}"))?;
        let headers = headers
            .iter()
            .map(|(k, v)| expand_env(v).map(|v| (k.clone(), v)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("MCP {name}: {e}"))?;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .user_agent(concat!("dxtutor-ide/", env!("CARGO_PKG_VERSION")))
            .build();
        let c = McpClient {
            name: name.to_string(),
            transport: Transport::Http {
                agent,
                url: url.trim().to_string(),
                headers,
                session: None,
            },
            next_id: 1,
        };
        c.handshake()
    }

    fn handshake(mut self) -> Result<Self, String> {
        let c = &mut self;
        c.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "dxtutor-ide", "version": env!("CARGO_PKG_VERSION") }
            }),
            INIT_TIMEOUT,
        )?;
        c.notify("notifications/initialized", json!({}))?;
        Ok(self)
    }

    /// Sends one message. Over HTTP, the messages that came back in its response (a stdio server answers on its
    /// own stream: none here).
    fn send_timed(&mut self, msg: &Value, timeout: Duration) -> Result<Vec<Value>, String> {
        let name = self.name.clone();
        match &mut self.transport {
            Transport::Stdio { stdin, .. } => {
                let mut s = msg.to_string();
                s.push('\n');
                stdin
                    .write_all(s.as_bytes())
                    .and_then(|_| stdin.flush())
                    .map_err(|e| format!("MCP {name}: {e}"))?;
                Ok(vec![])
            }
            Transport::Http {
                agent,
                url,
                headers,
                session,
            } => {
                let mut r = agent
                    .post(url)
                    .timeout(timeout)
                    .set("Content-Type", "application/json")
                    .set("Accept", "application/json, text/event-stream")
                    .set("MCP-Protocol-Version", PROTOCOL_VERSION);
                if let Some(sid) = session.as_deref() {
                    r = r.set("Mcp-Session-Id", sid);
                }
                for (k, v) in headers.iter() {
                    r = r.set(k, v);
                }
                let resp = match r.send_string(&msg.to_string()) {
                    Ok(resp) => resp,
                    Err(ureq::Error::Status(code, resp)) => {
                        return Err(format!(
                            "MCP {name}: HTTP {code} {}{}",
                            resp.status_text(),
                            if code == 404 && session.is_some() {
                                " (the server ended the session)"
                            } else {
                                ""
                            }
                        ))
                    }
                    Err(e) => return Err(format!("MCP {name}: {e}")),
                };
                if let Some(sid) = resp.header("mcp-session-id") {
                    *session = Some(sid.to_string());
                }
                if resp.status() == 202 {
                    return Ok(vec![]);
                }
                let id = msg.get("id").cloned().unwrap_or(Value::Null);
                if resp.content_type() == "text/event-stream" {
                    return Ok(sse_messages(resp.into_reader(), &id));
                }
                let body = resp.into_string().map_err(|e| format!("MCP {name}: {e}"))?;
                if body.trim().is_empty() {
                    return Ok(vec![]);
                }
                match serde_json::from_str::<Value>(&body) {
                    Ok(Value::Array(a)) => Ok(a),
                    Ok(v) => Ok(vec![v]),
                    Err(e) => Err(format!("MCP {name}: the response is not JSON ({e})")),
                }
            }
        }
    }

    fn send(&mut self, msg: &Value) -> Result<(), String> {
        let replies = self.send_timed(msg, INIT_TIMEOUT)?;
        // a server's requests in a response (over HTTP): answered «not supported», like over stdio
        for m in replies {
            if m.get("method").is_some() && m.get("id").is_some() {
                let _ = self.send_timed(&json!({ "jsonrpc": "2.0", "id": m["id"], "error": { "code": -32601, "message": "não suportado" } }), INIT_TIMEOUT);
            }
        }
        Ok(())
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    /// Um pedido JSON-RPC; ignora notificações e respostas a outros ids.
    pub fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        // H5e: over HTTP the answer comes in the response to the POST
        if matches!(self.transport, Transport::Http { .. }) {
            let replies = self.send_timed(&msg, timeout)?;
            let mut answer = None;
            for m in replies {
                if m["id"] == json!(id) && m.get("method").is_none() {
                    answer = Some(m);
                } else if m.get("method").is_some() && m.get("id").is_some() {
                    let _ = self.send_timed(&json!({ "jsonrpc": "2.0", "id": m["id"], "error": { "code": -32601, "message": "não suportado" } }), INIT_TIMEOUT);
                }
            }
            let m = answer
                .ok_or_else(|| format!("MCP {} {method}: no answer in the response", self.name))?;
            if let Some(e) = m.get("error") {
                return Err(format!(
                    "MCP {} {method}: {}",
                    self.name,
                    e["message"].as_str().unwrap_or("erro")
                ));
            }
            return Ok(m.get("result").cloned().unwrap_or(Value::Null));
        }
        self.send(&msg)?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let Transport::Stdio { rx, .. } = &self.transport else {
                unreachable!("stdio only here")
            };
            match rx.recv_timeout(left) {
                Ok(m) if m["id"] == json!(id) => {
                    if let Some(e) = m.get("error") {
                        return Err(format!(
                            "MCP {} {method}: {}",
                            self.name,
                            e["message"].as_str().unwrap_or("erro")
                        ));
                    }
                    return Ok(m.get("result").cloned().unwrap_or(Value::Null));
                }
                Ok(m) if m.get("method").is_some() && m.get("id").is_some() => {
                    // pedido do servidor (ex.: ping/sampling): responde que não suporta
                    let _ = self.send(&json!({ "jsonrpc": "2.0", "id": m["id"], "error": { "code": -32601, "message": "não suportado" } }));
                }
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "MCP {} {method}: sem resposta em {}s",
                        self.name,
                        timeout.as_secs()
                    ))
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(format!("MCP {}: o servidor terminou", self.name))
                }
            }
        }
    }

    /// As ferramentas do servidor (todas as páginas).
    pub fn list_tools(&mut self) -> Result<Vec<McpToolDef>, String> {
        let mut out = vec![];
        let mut cursor: Option<String> = None;
        for _ in 0..50 {
            let params = cursor
                .as_ref()
                .map(|c| json!({ "cursor": c }))
                .unwrap_or_else(|| json!({}));
            let r = self.request("tools/list", params, INIT_TIMEOUT)?;
            for t in r["tools"].as_array().cloned().unwrap_or_default() {
                let Some(tool) = t["name"].as_str() else {
                    continue;
                };
                out.push(McpToolDef {
                    server: self.name.clone(),
                    tool: tool.to_string(),
                    exposed: exposed_name(&self.name, tool),
                    description: t["description"]
                        .as_str()
                        .unwrap_or("")
                        .chars()
                        .take(1024)
                        .collect(),
                    input_schema: t
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object" })),
                });
            }
            cursor = r["nextCursor"].as_str().map(String::from);
            if cursor.is_none() {
                break;
            }
        }
        Ok(out)
    }

    /// Chama uma ferramenta; devolve o texto do resultado e se é erro.
    pub fn call(&mut self, tool: &str, args: &Value) -> Result<(String, bool), String> {
        let r = self.request(
            "tools/call",
            json!({ "name": tool, "arguments": args }),
            CALL_TIMEOUT,
        )?;
        let text: Vec<String> = r["content"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|c| match c["type"].as_str() {
                        Some("text") => c["text"].as_str().unwrap_or("").to_string(),
                        Some(other) => format!("[conteúdo {other} não mostrado]"),
                        None => c.to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut body = text.join("\n");
        if body.is_empty() {
            if let Some(s) = r.get("structuredContent") {
                body = s.to_string();
            }
        }
        Ok((body, r["isError"].as_bool().unwrap_or(false)))
    }
}

/// Uma ferramenta MCP vista pelo agente. A ligação pode faltar (servidor que não arrancou
/// numa sessão retomada): a chamada devolve erro em vez de rebentar.
pub struct McpTool {
    pub def: McpToolDef,
    pub client: Option<Arc<Mutex<McpClient>>>,
}

impl Tool for McpTool {
    fn name(&self) -> &str {
        &self.def.exposed
    }
    fn description(&self) -> &str {
        &self.def.description
    }
    fn input_schema(&self) -> Value {
        self.def.input_schema.clone()
    }
    fn read_only(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        let Some(c) = &self.client else {
            return ToolOutput::err(format!(
                "o servidor MCP «{}» não está ligado nesta sessão",
                self.def.server
            ));
        };
        match c.lock().unwrap().call(&self.def.tool, input) {
            Ok((text, is_error)) => ToolOutput {
                content: text,
                is_error,
                images: Vec::new(),
            },
            Err(e) => ToolOutput::err(e),
        }
    }
}

/// Liga os servidores dados e devolve as ferramentas deles (servidores que falham ficam
/// de fora, com a razão nos avisos).
/// Ferramentas ligadas: a definição e o cliente que a serve.
pub type Connected = Vec<(McpToolDef, Arc<Mutex<McpClient>>)>;

pub fn connect_all(
    servers: &BTreeMap<String, ServerConfig>,
    cwd: &Path,
) -> (Connected, Vec<String>) {
    connect_all_in(servers, cwd, None)
}

/// [`connect_all`] with every server inside the OS sandbox (H1b), when there is one.
pub fn connect_all_in(
    servers: &BTreeMap<String, ServerConfig>,
    cwd: &Path,
    sandbox: Option<&crate::os_sandbox::OsSandbox>,
) -> (Connected, Vec<String>) {
    let (mut tools, mut notes) = (vec![], vec![]);
    for (name, cfg) in servers {
        match McpClient::connect_in(name, cfg, cwd, sandbox)
            .and_then(|mut c| c.list_tools().map(|t| (t, c)))
        {
            Ok((defs, client)) => {
                let client = Arc::new(Mutex::new(client));
                tools.extend(defs.into_iter().map(|d| (d, client.clone())));
            }
            Err(e) => notes.push(e),
        }
    }
    (tools, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Um servidor MCP mínimo em Python (stdio, uma mensagem por linha), com paginação.
    const FAKE: &str = r#"
import json, sys
for line in sys.stdin:
    m = json.loads(line)
    if "id" not in m or "method" not in m:
        continue  # notificações e respostas do cliente (ex.: ao ping)
    meth, i = m["method"], m["id"]
    if meth == "initialize":
        r = {"protocolVersion": m["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fake"}}
    elif meth == "tools/list":
        if m["params"].get("cursor") is None:
            r = {"tools": [{"name": "echo", "description": "ecoa", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}}], "nextCursor": "p2"}
        else:
            r = {"tools": [{"name": "falha", "inputSchema": {"type": "object"}}]}
    elif meth == "tools/call":
        a = m["params"]
        if a["name"] == "echo":
            # um pedido do servidor pelo meio, que o cliente tem de recusar e seguir
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": "s1", "method": "ping"}) + "\n")
            r = {"content": [{"type": "text", "text": "eco: " + a["arguments"]["text"]}, {"type": "image", "data": "..."}]}
        else:
            r = {"content": [{"type": "text", "text": "correu mal"}], "isError": True}
    else:
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": i, "error": {"code": -32601, "message": "?"}}) + "\n"); sys.stdout.flush(); continue
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": i, "result": r}) + "\n"); sys.stdout.flush()
"#;

    fn fake_cfg(dir: &Path) -> ServerConfig {
        std::fs::write(dir.join("fake.py"), FAKE).unwrap();
        ServerConfig {
            command: "python3".into(),
            args: vec!["-I".into(), dir.join("fake.py").display().to_string()],
            ..Default::default()
        }
    }

    #[test]
    fn handshake_list_with_pagination_and_call() {
        let d = tempfile::tempdir().unwrap();
        let mut c = McpClient::connect("fake srv", &fake_cfg(d.path()), d.path()).unwrap();
        let tools = c.list_tools().unwrap();
        assert_eq!(
            tools.iter().map(|t| t.exposed.as_str()).collect::<Vec<_>>(),
            ["mcp__fake_srv__echo", "mcp__fake_srv__falha"]
        );
        assert_eq!(
            c.call("echo", &json!({"text": "olá"})).unwrap(),
            ("eco: olá\n[conteúdo image não mostrado]".into(), false)
        );
        assert_eq!(
            c.call("falha", &json!({})).unwrap(),
            ("correu mal".into(), true)
        );
        assert!(c
            .request("nada", json!({}), Duration::from_secs(5))
            .unwrap_err()
            .contains("?"));
    }

    /// H1b: a server runs inside the OS sandbox (when this machine has one) and still works.
    #[test]
    fn a_server_inside_the_sandbox_lists_its_tools() {
        let Ok(bwrap) = crate::os_sandbox::available() else {
            eprintln!("skipped: no usable bubblewrap here");
            return;
        };
        let d = tempfile::tempdir().unwrap();
        let sb = crate::os_sandbox::OsSandbox::for_project(
            &bwrap,
            d.path(),
            None,
            None,
            &crate::os_sandbox::SandboxConfig::default(),
        );
        let mut c =
            McpClient::connect_in("fake", &fake_cfg(d.path()), d.path(), Some(&sb)).unwrap();
        assert!(!c.list_tools().unwrap().is_empty());
    }

    #[test]
    fn tools_through_the_agent_interface_and_failures() {
        let d = tempfile::tempdir().unwrap();
        let mut servers = BTreeMap::new();
        servers.insert("fake".to_string(), fake_cfg(d.path()));
        servers.insert(
            "partido".to_string(),
            ServerConfig {
                command: "/nao/existe".into(),
                ..Default::default()
            },
        );
        let (tools, notes) = connect_all(&servers, d.path());
        assert_eq!(tools.len(), 2);
        assert_eq!(notes.len(), 1);
        assert!(notes[0].contains("partido"));
        let (def, client) = tools[0].clone();
        let t = McpTool {
            def,
            client: Some(client),
        };
        let ctx = ToolCtx {
            root: d.path().to_path_buf(),
            cancel: Default::default(),
        };
        assert_eq!(
            t.run(&json!({"text": "x"}), &ctx).content,
            "eco: x\n[conteúdo image não mostrado]"
        );
        assert!(!t.read_only());
        let orphan = McpTool {
            def: tools[1].0.clone(),
            client: None,
        };
        assert!(orphan.run(&json!({}), &ctx).is_error);
    }

    /// H5e: a remote server — the session id follows every request after `initialize`, the headers are expanded
    /// from the environment, an SSE answer is read up to the response (a server request in it is refused), and the
    /// session is closed with a DELETE when the client goes.
    #[test]
    fn a_remote_server_over_streamable_http() {
        use std::io::Read as _;
        type Seen = Arc<Mutex<Vec<(String, String, String)>>>; // (method, headers, body)
        let seen: Seen = Default::default();
        let srv = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = srv.local_addr().unwrap().port();
        let s2 = seen.clone();
        std::thread::spawn(move || {
            for conn in srv.incoming() {
                let Ok(mut conn) = conn else { break };
                let s3 = s2.clone();
                std::thread::spawn(move || loop {
                    // one request: the head, then Content-Length bytes
                    let mut head = vec![];
                    let mut b = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        if conn.read(&mut b).unwrap_or(0) == 0 {
                            return;
                        }
                        head.push(b[0]);
                    }
                    let head = String::from_utf8_lossy(&head).to_string();
                    let len: usize = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    let mut body = vec![0u8; len];
                    conn.read_exact(&mut body).unwrap();
                    let body = String::from_utf8_lossy(&body).to_string();
                    let method = head.split(' ').next().unwrap_or("").to_string();
                    s3.lock().unwrap().push((
                        method.clone(),
                        head.to_ascii_lowercase(),
                        body.clone(),
                    ));
                    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                    let reply = |status: &str, ctype: &str, extra: &str, body: &str| {
                        format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n{extra}Content-Length: {}\r\n\r\n{body}", body.len())
                    };
                    let out = match (method.as_str(), v["method"].as_str()) {
                        ("DELETE", _) => reply("200 OK", "text/plain", "", ""),
                        (_, Some("initialize")) => reply(
                            "200 OK",
                            "application/json",
                            "Mcp-Session-Id: s-1\r\n",
                            &json!({"jsonrpc": "2.0", "id": v["id"], "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}}}}).to_string(),
                        ),
                        (_, Some("tools/list")) => {
                            let ping = json!({"jsonrpc": "2.0", "id": "s1", "method": "ping"});
                            let res = json!({"jsonrpc": "2.0", "id": v["id"], "result": {"tools": [{"name": "search", "description": "searches the docs", "inputSchema": {"type": "object"}}]}});
                            reply("200 OK", "text/event-stream", "", &format!("event: message\ndata: {ping}\n\nevent: message\ndata: {res}\n\n"))
                        }
                        (_, Some("tools/call")) => reply(
                            "200 OK",
                            "application/json",
                            "",
                            &json!({"jsonrpc": "2.0", "id": v["id"], "result": {"content": [{"type": "text", "text": format!("found: {}", v["params"]["arguments"]["q"].as_str().unwrap_or(""))}]}}).to_string(),
                        ),
                        _ => reply("202 Accepted", "text/plain", "", ""),
                    };
                    if conn.write_all(out.as_bytes()).is_err() {
                        return;
                    }
                });
            }
        });
        std::env::set_var("DXTUTOR_TEST_MCP_TOKEN", "t0k3n");
        let cfg = ServerConfig {
            url: Some(format!("http://127.0.0.1:{port}/mcp")),
            headers: BTreeMap::from([(
                "Authorization".to_string(),
                "Bearer ${env:DXTUTOR_TEST_MCP_TOKEN}".to_string(),
            )]),
            ..Default::default()
        };
        let d = tempfile::tempdir().unwrap();
        let mut c = McpClient::connect("docs", &cfg, d.path()).unwrap();
        let tools = c.list_tools().unwrap();
        assert_eq!(
            tools.iter().map(|t| t.exposed.as_str()).collect::<Vec<_>>(),
            ["mcp__docs__search"]
        );
        assert_eq!(
            c.call("search", &json!({"q": "retry"})).unwrap(),
            ("found: retry".into(), false)
        );
        drop(c);
        std::thread::sleep(Duration::from_millis(100));
        let seen = seen.lock().unwrap().clone();
        // initialize had no session; everything after it carried s-1, the token and the protocol version
        assert!(!seen[0].1.contains("mcp-session-id"));
        for (m, h, _) in &seen[1..] {
            assert!(h.contains("mcp-session-id: s-1"), "{m}: {h}");
            assert!(h.contains("authorization: bearer t0k3n"), "{m}");
            assert!(h.contains("mcp-protocol-version: "), "{m}");
        }
        let bodies: Vec<&str> = seen
            .iter()
            .map(|(m, _, b)| if m == "DELETE" { "DELETE" } else { b.as_str() })
            .collect();
        assert!(bodies[1].contains("notifications/initialized"));
        assert!(
            bodies
                .iter()
                .any(|b| b.contains("\"id\":\"s1\"") && b.contains("-32601")),
            "the server's ping was refused"
        );
        assert_eq!(*bodies.last().unwrap(), "DELETE");
        // a missing variable is an error, never an empty header; plain http only for this machine
        let bad = ServerConfig {
            url: Some(format!("http://127.0.0.1:{port}/mcp")),
            headers: BTreeMap::from([(
                "X".to_string(),
                "${env:DXTUTOR_NOT_SET_ANYWHERE}".to_string(),
            )]),
            ..Default::default()
        };
        assert!(McpClient::connect("x", &bad, d.path())
            .err()
            .unwrap()
            .contains("DXTUTOR_NOT_SET_ANYWHERE"));
        assert!(url_allowed("http://mcp.example.com/mcp").is_err());
        assert!(url_allowed("https://mcp.example.com/mcp").is_ok());
        assert!(url_allowed("http://localhost:3000/mcp").is_ok());
    }

    #[test]
    fn config_files_and_names() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("mcp.json");
        std::fs::write(
            &p,
            r#"{"mcpServers":{"gh":{"command":"npx","args":["-y","x"],"env":{"T":"1"}}}}"#,
        )
        .unwrap();
        let c = load_config(&p).unwrap();
        assert_eq!(c["gh"].args, vec!["-y", "x"]);
        assert!(load_config(&d.path().join("nada.json")).unwrap().is_empty());
        std::fs::write(&p, "{x").unwrap();
        assert!(load_config(&p).is_err());
        assert_eq!(exposed_name("a.b", "c d"), "mcp__a_b__c_d");
        // H5e: local (command) or remote (url), never both or neither, and the url checked
        std::fs::write(
            &p,
            r#"{"mcpServers":{"docs":{"url":"https://mcp.example.com/mcp","headers":{"A":"b"}}}}"#,
        )
        .unwrap();
        assert_eq!(load_config(&p).unwrap()["docs"].headers["A"], "b");
        for bad in [
            r#"{"mcpServers":{"x":{}}}"#,
            r#"{"mcpServers":{"x":{"command":"npx","url":"https://a.b/mcp"}}}"#,
            r#"{"mcpServers":{"x":{"url":"http://a.example/mcp"}}}"#,
        ] {
            std::fs::write(&p, bad).unwrap();
            assert!(load_config(&p).is_err(), "{bad}");
        }
        assert_eq!(exposed_name(&"s".repeat(40), &"t".repeat(40)).len(), 64);
    }
}
