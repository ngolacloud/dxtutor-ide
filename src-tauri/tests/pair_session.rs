//! Integração do 12º grupo (PairCode), Etapa 3.
//!
//! Prova que a fachada do caso de uso é alcançável de FORA do crate (o ponto de
//! `pub mod pair`): o crate de teste só vê `dxtutor_ide_lib`, não `tutor_eval`. Exercita o
//! mecanismo par-a-par real (`Pair` + `Events`) sobre loopback TCP — sem webview, sem Tauri
//! — que é a parte testável headless (o WebRTC do webview valida-se na máquina do
//! utilizador). O adaptador IPC (`commands::pair`) é só a emissão dos eventos Tauri sobre
//! estes mesmos callbacks.

use dxtutor_ide_lib::pair::{decode_token, encode_token, Events, Pair, Token};
use serde_json::Value;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Liga os callbacks do caso de uso a canais que o teste pode drenar — o equivalente
/// in-process ao que `commands::pair::pair_events` faz com `app.emit`.
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
fn token_round_trips_through_the_public_facade() {
    let t = Token {
        v: 1,
        host: "walter".into(),
        addrs: vec!["10.0.0.2".into()],
        port: 47821,
        key: base64_key(),
    };
    let s = encode_token(&t);
    assert!(s.starts_with("dxp_"));
    assert_eq!(decode_token(&format!("  {s}\n")).unwrap(), t);
    assert!(decode_token("hello").is_err());
    assert!(decode_token("dxp_!!!").is_err());
}

#[test]
fn send_without_a_peer_is_an_error() {
    // Nenhuma ligação ainda: a mensagem não tem para onde ir — mensagem histórica estável.
    assert_eq!(Pair::default().send("late").unwrap_err(), "no one is connected");
}

#[tokio::test(flavor = "multi_thread")]
async fn host_and_guest_exchange_over_loopback_through_the_facade() {
    let (hev, hmsg, hst) = events();
    let host = Pair::default();
    // port 0 = porta efémera: o teste não prende a 47821 da máquina.
    let token = host.host("host", Some(0), hev).await.unwrap();
    let t = decode_token(&token).unwrap();
    assert_eq!(t.addrs.last().unwrap(), "127.0.0.1", "loopback fica por último");
    let port = t.port;

    // um token com o endereço certo mas outra chave é recusado no handshake selado.
    let mut bad = t.clone();
    bad.key = base64_key_other();
    let (bev, _bm, bst) = events();
    Pair::default()
        .join(&encode_token(&bad), Some(format!("127.0.0.1:{port}")), bev)
        .await
        .unwrap();
    assert_eq!(wait_state(&bst, "error")["role"], "guest");

    // o par legítimo junta-se, troca uma mensagem em cada sentido e desliga.
    let (gev, gmsg, gst) = events();
    let guest = Pair::default();
    assert_eq!(
        guest
            .join(&token, Some(format!("127.0.0.1:{port}")), gev)
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
    host.send(r#"{"t":"ack"}"#).unwrap();
    assert_eq!(
        gmsg.recv_timeout(Duration::from_secs(5)).unwrap(),
        r#"{"t":"ack"}"#
    );

    guest.stop();
    wait_state(&hst, "disconnected");
    assert!(host.send("late").is_err(), "sem par, enviar falha");
    host.stop();
}

// Chaves de 32 bytes em base64 url-safe sem padding, como o token real as carrega.
fn base64_key() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
    B64.encode([7u8; 32])
}
fn base64_key_other() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
    B64.encode([9u8; 32])
}
