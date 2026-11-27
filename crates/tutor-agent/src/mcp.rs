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

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct ServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    #[serde(default, rename = "mcpServers", alias = "servers")]
    servers: BTreeMap<String, ServerConfig>,
}

/// Lê um ficheiro de configuração MCP. Inexistente → vazio.
pub fn load_config(path: &Path) -> Result<BTreeMap<String, ServerConfig>, String> {
    match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str::<ConfigFile>(&t)
            .map(|f| f.servers)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(_) => Ok(BTreeMap::new()),
    }
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

/// Uma ligação a um servidor MCP (o processo morre com ela).
pub struct McpClient {
    pub name: String,
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Value>,
    next_id: u64,
}

impl Drop for McpClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
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
        let mut c = McpClient {
            name: name.to_string(),
            child,
            stdin,
            rx,
            next_id: 1,
        };
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
        Ok(c)
    }

    fn send(&mut self, msg: &Value) -> Result<(), String> {
        let mut s = msg.to_string();
        s.push('\n');
        self.stdin
            .write_all(s.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("MCP {}: {e}", self.name))
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
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.rx.recv_timeout(left) {
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
            env: BTreeMap::new(),
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
                args: vec![],
                env: BTreeMap::new(),
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
        assert_eq!(exposed_name(&"s".repeat(40), &"t".repeat(40)).len(), 64);
    }
}
