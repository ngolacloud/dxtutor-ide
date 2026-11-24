//! Importar os diagramas Mermaid reais do `ARCHITECTURE.md` do Delonix (cópias em
//! `tests/fixtures/mermaid/`, tiradas do repositório `delonix` em b06acbb7) e confirmar
//! que Mermaid → modelo → Mermaid é estável.

use tutor_eval::arch::mermaid::{from_mermaid, to_mermaid};
use tutor_eval::arch::{Architecture, EdgeStyle, GroupKind, Kind};

const CONTEXT: &str = include_str!("fixtures/mermaid/delonix-context.mmd");
const RUNTIME: &str = include_str!("fixtures/mermaid/delonix-runtime.mmd");
const CRATES: &str = include_str!("fixtures/mermaid/delonix-crates.mmd");

fn import(src: &str) -> (Architecture, Vec<String>) {
    let r = from_mermaid(src).unwrap_or_else(|e| panic!("{e}"));
    (r.arch, r.warnings)
}

fn json(a: &Architecture) -> String {
    serde_json::to_string_pretty(a).unwrap()
}

/// Mermaid → modelo → Mermaid → modelo: o segundo modelo é igual ao primeiro, e o segundo
/// Mermaid é igual ao primeiro exportado (a exportação é um ponto fixo).
fn assert_stable(src: &str) {
    let (a1, _) = import(src);
    let m1 = to_mermaid(&a1);
    let (a2, w2) = import(&m1);
    assert!(
        w2.is_empty(),
        "a reimportação do export não devia avisar: {w2:?}\n{m1}"
    );
    assert_eq!(json(&a2), json(&a1), "{m1}");
    assert_eq!(to_mermaid(&a2), m1);
}

#[test]
fn all_delonix_diagrams_round_trip() {
    for src in [CONTEXT, RUNTIME, CRATES] {
        assert_stable(src);
    }
}

#[test]
fn context_diagram() {
    let (a, w) = import(CONTEXT);
    assert_eq!(a.components.len(), 7);
    assert_eq!(a.connections.len(), 6);
    assert!(a.groups.is_empty() && a.views.is_empty());
    let dlx = a.components.iter().find(|c| c.id == "DLX").unwrap();
    assert_eq!(
        dlx.name,
        "Delonix Engine\nmotor de containers e microVMs\ndaemonless, rootless-first"
    );
    let cri = a.connections.iter().find(|c| c.from == "KUBELET").unwrap();
    assert_eq!(
        cri.label.as_deref(),
        Some("CRI runtime.v1 gRPC\nsocket unix")
    );
    assert_eq!(cri.style, Some(EdgeStyle::Data));
    // Sem metadados do dxtutor: os tipos foram adivinhados, e isso é dito.
    assert!(w.iter().any(|x| x.contains("guessed")), "{w:?}");
    assert!(a.validate().is_empty(), "{:?}", a.validate());
}

#[test]
fn runtime_diagram_keeps_nested_boundaries() {
    let (a, _) = import(RUNTIME);
    assert_eq!(a.components.len(), 11);
    assert_eq!(a.connections.len(), 10);
    let g = |id: &str| a.groups.iter().find(|g| g.id == id).unwrap();
    assert_eq!(g("HOST").label, "Host Linux");
    assert_eq!(g("HOST").kind, GroupKind::Host);
    assert_eq!(g("INFRA").parent.as_deref(), Some("HOST"));
    assert_eq!(g("PERCONT").parent.as_deref(), Some("HOST"));
    let grp = |id: &str| {
        a.components
            .iter()
            .find(|c| c.id == id)
            .unwrap()
            .group
            .clone()
    };
    assert_eq!(grp("CLI").as_deref(), Some("HOST"));
    assert_eq!(grp("HOLDER").as_deref(), Some("INFRA"));
    assert_eq!(grp("SHIM").as_deref(), Some("PERCONT"));
    assert_eq!(grp("VM").as_deref(), Some("HOST"));
    assert_eq!(grp("KUBELET2"), None, "o kubelet está fora do host");
    let e = |f: &str, t: &str| {
        a.connections
            .iter()
            .find(|c| c.from == f && c.to == t)
            .unwrap()
    };
    assert_eq!(e("CLI", "SHIM").label.as_deref(), Some("fork"));
    assert_eq!(e("CLI", "STATE").label.as_deref(), Some("lê e escreve"));
    assert_eq!(e("HOLDER", "SLIRP1").style, Some(EdgeStyle::Optional));
    assert!(a.validate().is_empty(), "{:?}", a.validate());
}

#[test]
fn crates_diagram_is_large_but_complete() {
    let (a, _) = import(CRATES);
    assert_eq!(a.components.len(), 41);
    assert_eq!(a.connections.len(), 147);
    assert!(a.components.iter().all(|c| c.kind == Kind::Process));
    assert!(a.validate().is_empty(), "{:?}", a.validate());
}

/// O diagrama real «Delonix vs Docker» desenhado no Studio (painel Delonix strict e
/// daemonless, cada elemento com a fonte no código do `delonix`, commit 6b8d18f3).
const DELONIX_VS_DOCKER: &str = include_str!("fixtures/arch/delonix-vs-docker.json");

#[test]
fn delonix_vs_docker_is_confirmed_and_round_trips_without_a_duplicate_title() {
    let a: Architecture = serde_json::from_str(DELONIX_VS_DOCKER).unwrap();
    assert!(a.validate().is_empty(), "{:?}", a.validate());
    let m = to_mermaid(&a);
    for title in ["Docker — 2 daemons residentes", "Delonix — sem daemon"] {
        assert_eq!(m.matches(&format!("[\"{title}\"]")).count(), 1, "{m}");
    }
    let (back, w) = import(&m);
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(json(&back), json(&a));
}

/// O diagrama real «Seiva — o mesmo módulo» (os dois painéis strict, cada elemento com a
/// fonte nos geradores do `seiva`, commit 26592bd).
const SEIVA: &str = include_str!("fixtures/arch/seiva-o-mesmo-modulo.json");

#[test]
fn seiva_same_module_is_confirmed_and_round_trips() {
    let a: Architecture = serde_json::from_str(SEIVA).unwrap();
    assert!(a.validate().is_empty(), "{:?}", a.validate());
    let m = to_mermaid(&a);
    for title in [
        "Monólito modular · um processo",
        "seiva module split · um serviço",
    ] {
        assert_eq!(m.matches(&format!("[\"{title}\"]")).count(), 1, "{m}");
    }
    let (back, w) = import(&m);
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(json(&back), json(&a));
}
