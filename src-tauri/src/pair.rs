//! PairCode: two developers, one host and one guest, joined by a token.
//!
//! The host listens on a TCP port and hands out a token holding its addresses, the port and a
//! fresh 256-bit key. Every WebSocket frame is sealed with ChaCha20-Poly1305 under that key, so
//! only someone holding the token can join or read the traffic, and the first frame each side
//! sends is a sealed handshake that must open within ten seconds. One guest at a time.
//! The messages themselves (files, cursor, control, WebRTC signalling) are opaque JSON for the UI.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

pub const DEFAULT_PORT: u16 = 47821;
const HELLO: &[u8] = b"dxtutor-paircode-v1";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Token {
    pub v: u8,
    pub host: String,
    pub addrs: Vec<String>,
    pub port: u16,
    pub key: String,
}

pub fn encode_token(t: &Token) -> String {
    format!(
        "dxp_{}",
        B64.encode(serde_json::to_vec(t).unwrap_or_default())
    )
}

pub fn decode_token(s: &str) -> Result<Token, String> {
    let body = s
        .trim()
        .strip_prefix("dxp_")
        .ok_or("this is not a PairCode token (it starts with dxp_)")?;
    let bytes = B64
        .decode(body)
        .map_err(|_| "the token is damaged — copy it again")?;
    serde_json::from_slice(&bytes).map_err(|_| "the token is damaged — copy it again".to_string())
}

pub struct Crypto(ChaCha20Poly1305);

impl Crypto {
    pub fn new(key: &[u8]) -> Result<Self, String> {
        if key.len() != 32 {
            return Err("the token key has the wrong size".into());
        }
        Ok(Self(ChaCha20Poly1305::new(Key::from_slice(key))))
    }
    /// nonce (12 bytes) followed by the ciphertext and tag
    pub fn seal(&self, plain: &[u8]) -> Vec<u8> {
        let n = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let mut out = n.to_vec();
        out.extend(self.0.encrypt(&n, plain).expect("chacha20poly1305 encrypt"));
        out
    }
    pub fn open(&self, data: &[u8]) -> Option<Vec<u8>> {
        if data.len() < 12 + 16 {
            return None;
        }
        let (n, c) = data.split_at(12);
        self.0.decrypt(Nonce::from_slice(n), c).ok()
    }
}

/// Where the session reports to: status changes and incoming messages.
#[derive(Clone)]
pub struct Events {
    pub status: Arc<dyn Fn(Value) + Send + Sync>,
    pub msg: Arc<dyn Fn(String) + Send + Sync>,
}

#[derive(Default)]
struct State {
    out: Option<(u64, UnboundedSender<Vec<u8>>)>,
    crypto: Option<Arc<Crypto>>,
    task: Option<JoinHandle<()>>,
    gen: u64,
}

#[derive(Default, Clone)]
pub struct Pair(Arc<Mutex<State>>);

impl Pair {
    fn set_out(&self, tx: UnboundedSender<Vec<u8>>) -> u64 {
        let mut s = self.0.lock().unwrap();
        s.gen += 1;
        s.out = Some((s.gen, tx));
        s.gen
    }
    fn clear_out(&self, gen: u64) {
        let mut s = self.0.lock().unwrap();
        if matches!(s.out, Some((g, _)) if g == gen) {
            s.out = None;
        }
    }
    #[cfg(test)]
    pub fn connected(&self) -> bool {
        self.0.lock().unwrap().out.is_some()
    }

    pub fn send(&self, msg: &str) -> Result<(), String> {
        let s = self.0.lock().unwrap();
        match (&s.out, &s.crypto) {
            (Some((_, tx)), Some(c)) => tx
                .send(c.seal(msg.as_bytes()))
                .map_err(|_| "the session has ended".into()),
            _ => Err("no one is connected".into()),
        }
    }

    pub fn stop(&self) {
        let mut s = self.0.lock().unwrap();
        if let Some(t) = s.task.take() {
            t.abort();
        }
        s.out = None;
        s.crypto = None;
    }

    /// Starts hosting. Returns the token to give to the other developer.
    pub async fn host(&self, name: &str, port: Option<u16>, ev: Events) -> Result<String, String> {
        self.stop();
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        let crypto = Arc::new(Crypto::new(&key)?);
        let want = port.unwrap_or(DEFAULT_PORT);
        let listener = match TcpListener::bind(("0.0.0.0", want)).await {
            Ok(l) => l,
            Err(_) => TcpListener::bind(("0.0.0.0", 0))
                .await
                .map_err(|e| format!("cannot listen: {e}"))?,
        };
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let token = Token {
            v: 1,
            host: name.to_string(),
            addrs: local_addrs(),
            port,
            key: B64.encode(key),
        };
        let (p, c, ev2) = (self.clone(), crypto.clone(), ev.clone());
        let task = tokio::spawn(async move {
            loop {
                let Ok((tcp, addr)) = listener.accept().await else { break };
                let _ = tcp.set_nodelay(true);
                if let Ok(ws) =
                    tokio_tungstenite::accept_async_with_config(tcp, Some(ws_config())).await
                {
                    session(
                        ws,
                        false,
                        addr.ip().to_string(),
                        p.clone(),
                        c.clone(),
                        ev2.clone(),
                    )
                    .await;
                    (ev2.status)(json!({"state": "waiting", "role": "host"}));
                }
            }
        });
        {
            let mut s = self.0.lock().unwrap();
            s.crypto = Some(crypto);
            s.task = Some(task);
        }
        (ev.status)(
            json!({"state": "waiting", "role": "host", "port": port, "addrs": token.addrs}),
        );
        Ok(encode_token(&token))
    }

    /// Joins a host. `via` ("host:port") overrides the addresses in the token — for tunnels or VPNs.
    pub async fn join(
        &self,
        token: &str,
        via: Option<String>,
        ev: Events,
    ) -> Result<String, String> {
        self.stop();
        let t = decode_token(token)?;
        let key = B64
            .decode(&t.key)
            .map_err(|_| "the token is damaged — copy it again")?;
        let crypto = Arc::new(Crypto::new(&key)?);
        let targets: Vec<String> = match via.filter(|v| !v.trim().is_empty()) {
            Some(v) => vec![v.trim().to_string()],
            None => t
                .addrs
                .iter()
                .map(|a| {
                    if a.contains(':') {
                        format!("[{a}]:{}", t.port)
                    } else {
                        format!("{a}:{}", t.port)
                    }
                })
                .collect(),
        };
        let mut last = String::from("no address in the token");
        for target in &targets {
            let url = format!("ws://{target}/");
            match tokio::time::timeout(
                Duration::from_secs(4),
                tokio_tungstenite::connect_async_with_config(url, Some(ws_config()), true),
            )
            .await
            {
                Ok(Ok((ws, _))) => {
                    let (p, c, ev2, peer) =
                        (self.clone(), crypto.clone(), ev.clone(), target.clone());
                    let task = tokio::spawn(async move {
                        session(ws, true, peer, p, c, ev2.clone()).await;
                        (ev2.status)(json!({"state": "ended", "role": "guest"}));
                    });
                    let mut s = self.0.lock().unwrap();
                    s.crypto = Some(crypto);
                    s.task = Some(task);
                    return Ok(t.host);
                }
                Ok(Err(e)) => last = e.to_string(),
                Err(_) => last = "timed out".into(),
            }
        }
        Err(format!("could not reach {} at {} — {last}. Both machines must see each other (same network or VPN), or use \"via\" with an address that reaches the host.", t.host, targets.join(", ")))
    }
}

fn ws_config() -> WebSocketConfig {
    let mut c = WebSocketConfig::default();
    c.max_message_size = Some(512 << 20);
    c.max_frame_size = Some(512 << 20);
    c
}

async fn session<S>(
    ws: WebSocketStream<S>,
    guest: bool,
    peer: String,
    p: Pair,
    c: Arc<Crypto>,
    ev: Events,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let role = if guest { "guest" } else { "host" };
    let (mut sink, mut stream) = ws.split();
    if guest
        && sink
            .send(Message::Binary(c.seal(HELLO).into()))
            .await
            .is_err()
    {
        return;
    }
    let first = tokio::time::timeout(Duration::from_secs(10), stream.next()).await;
    let ok =
        matches!(&first, Ok(Some(Ok(Message::Binary(b)))) if c.open(b).as_deref() == Some(HELLO));
    if !ok {
        let _ = sink.close().await;
        if guest {
            (ev.status)(
                json!({"state": "error", "role": role, "error": "the host did not accept this token (it may be from an older session)"}),
            );
        }
        return;
    }
    if !guest
        && sink
            .send(Message::Binary(c.seal(HELLO).into()))
            .await
            .is_err()
    {
        return;
    }
    let (tx, mut rx) = unbounded_channel::<Vec<u8>>();
    let gen = p.set_out(tx);
    (ev.status)(json!({"state": "connected", "role": role, "peer": peer}));
    let writer = async {
        while let Some(b) = rx.recv().await {
            if sink.send(Message::Binary(b.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    };
    let reader = async {
        while let Some(Ok(m)) = stream.next().await {
            match m {
                Message::Binary(b) => {
                    if let Some(plain) = c.open(&b) {
                        if let Ok(s) = String::from_utf8(plain) {
                            (ev.msg)(s);
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };
    tokio::select! { _ = writer => {}, _ = reader => {} }
    p.clear_out(gen);
    (ev.status)(json!({"state": "disconnected", "role": role, "peer": peer}));
}

/// Addresses another machine may reach: private LAN and VPN (100.64/10) first, loopback last.
pub fn local_addrs() -> Vec<String> {
    let mut v: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
        .map(|l| {
            l.into_iter()
                .map(|(_, ip)| ip)
                .filter(|ip| ip.is_ipv4() && !ip.is_loopback())
                .collect()
        })
        .unwrap_or_default();
    let rank = |ip: &IpAddr| match ip {
        IpAddr::V4(a) if a.is_private() => 0,
        IpAddr::V4(a) if a.octets()[0] == 100 && (64..128).contains(&a.octets()[1]) => 1,
        _ => 2,
    };
    v.sort_by_key(rank);
    v.dedup();
    let mut out: Vec<String> = v.into_iter().map(|ip| ip.to_string()).collect();
    out.push("127.0.0.1".into());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn events() -> (Events, mpsc::Receiver<String>, mpsc::Receiver<Value>) {
        let (mt, mr) = mpsc::channel();
        let (st, sr) = mpsc::channel();
        let mt = Mutex::new(mt);
        let st = Mutex::new(st);
        (
            Events {
                status: Arc::new(move |v| {
                    let _ = st.lock().unwrap().send(v);
                }),
                msg: Arc::new(move |m| {
                    let _ = mt.lock().unwrap().send(m);
                }),
            },
            mr,
            sr,
        )
    }

    fn wait_state(r: &mpsc::Receiver<Value>, state: &str) -> Value {
        loop {
            let v = r.recv_timeout(Duration::from_secs(10)).expect("status");
            if v["state"] == state {
                return v;
            }
        }
    }

    #[test]
    fn token_round_trip_and_damage() {
        let t = Token {
            v: 1,
            host: "walter".into(),
            addrs: vec!["10.0.0.2".into()],
            port: 47821,
            key: B64.encode([7u8; 32]),
        };
        let s = encode_token(&t);
        assert!(s.starts_with("dxp_"));
        assert_eq!(decode_token(&format!("  {s}\n")).unwrap(), t);
        assert!(decode_token("hello").is_err());
        assert!(decode_token("dxp_!!!").is_err());
    }

    #[test]
    fn sealed_frames_open_only_with_the_key() {
        let a = Crypto::new(&[1u8; 32]).unwrap();
        let b = Crypto::new(&[2u8; 32]).unwrap();
        let s = a.seal(b"fn main() {}");
        assert_eq!(a.open(&s).unwrap(), b"fn main() {}");
        assert!(b.open(&s).is_none());
        let mut t = s.clone();
        *t.last_mut().unwrap() ^= 1;
        assert!(a.open(&t).is_none());
        assert_ne!(a.seal(b"x"), a.seal(b"x"), "nonces must differ");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn host_and_guest_exchange_messages_and_wrong_keys_are_refused() {
        let (hev, hmsg, hst) = events();
        let host = Pair::default();
        let token = host.host("host", Some(0), hev).await.unwrap();
        let t = decode_token(&token).unwrap();
        assert_eq!(t.addrs.last().unwrap(), "127.0.0.1");

        // a token with the right address but another key is refused
        let mut bad = t.clone();
        bad.key = B64.encode([9u8; 32]);
        let (bev, _bm, bst) = events();
        let intruder = Pair::default();
        intruder
            .join(
                &encode_token(&bad),
                Some(format!("127.0.0.1:{}", t.port)),
                bev,
            )
            .await
            .unwrap();
        assert_eq!(wait_state(&bst, "error")["role"], "guest");
        assert!(!host.connected());

        let (gev, gmsg, gst) = events();
        let guest = Pair::default();
        assert_eq!(
            guest
                .join(&token, Some(format!("127.0.0.1:{}", t.port)), gev)
                .await
                .unwrap(),
            "host"
        );
        wait_state(&gst, "connected");
        wait_state(&hst, "connected");
        guest.send(r#"{"t":"hello"}"#).unwrap();
        assert_eq!(
            hmsg.recv_timeout(Duration::from_secs(5)).unwrap(),
            r#"{"t":"hello"}"#
        );
        let big = "x".repeat(3 << 20);
        host.send(&big).unwrap();
        assert_eq!(
            gmsg.recv_timeout(Duration::from_secs(10)).unwrap().len(),
            big.len()
        );

        guest.stop();
        wait_state(&hst, "disconnected");
        assert!(host.send("late").is_err());
        host.stop();
    }
}
