//! Reads the manifest (extension/package.json) out of a VS Code extension package.

use base64::Engine;
use serde_json::Value;
use std::io::{Cursor, Read};

pub fn manifest(bytes: &[u8]) -> Result<Value, String> {
    let mut zip =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("not a VSIX (zip): {e}"))?;
    let mut f = zip
        .by_name("extension/package.json")
        .map_err(|_| "extension/package.json not found — is this a VSIX?".to_string())?;
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| format!("package.json: {e}"))
}

pub fn manifest_b64(b64: &str) -> Result<Value, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| e.to_string())?;
    manifest(&bytes)
}

// ── Open VSX (ADR-0005, Fase 4): descarregar o VSIX mais recente de uma extensão ──────────

/// Servidor do registo aberto de extensões VS Code.
pub const OPEN_VSX: &str = "https://open-vsx.org";
/// Tamanho máximo de um VSIX descarregado.
pub const MAX_VSIX_BYTES: usize = 100 * 1024 * 1024;

/// `publisher.name` válido (o formato dos ids de extensão VS Code).
pub fn valid_extension_id(id: &str) -> bool {
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    matches!(id.split_once('.'), Some((p, n)) if ok(p) && ok(n))
}

/// URL da API do Open VSX com os metadados da versão mais recente.
pub fn open_vsx_latest_url(id: &str) -> Result<String, String> {
    if !valid_extension_id(id) {
        return Err(format!("`{id}` is not an extension id (publisher.name)"));
    }
    let (publisher, name) = id.split_once('.').unwrap();
    Ok(format!("{OPEN_VSX}/api/{publisher}/{name}/latest"))
}

/// O URL do ficheiro `.vsix` na resposta da API — tem de ser HTTPS e do próprio Open VSX
/// (nunca seguimos para outro servidor indicado pela resposta).
pub fn download_url_from_metadata(meta: &Value) -> Result<String, String> {
    let url = meta["files"]["download"]
        .as_str()
        .ok_or("the Open VSX response has no download link")?;
    if !url.starts_with(&format!("{OPEN_VSX}/")) {
        return Err(format!("unexpected download location: {url}"));
    }
    Ok(url.to_string())
}

/// Descarrega o VSIX mais recente de `id` do Open VSX.
pub async fn fetch_open_vsx(id: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent(concat!("dxtutor-ide/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let meta_resp = client
        .get(open_vsx_latest_url(id)?)
        .send()
        .await
        .map_err(|e| format!("Open VSX: {e}"))?;
    if meta_resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("`{id}` was not found on Open VSX"));
    }
    if !meta_resp.status().is_success() {
        return Err(format!("Open VSX: HTTP {}", meta_resp.status()));
    }
    let meta: Value = meta_resp
        .json()
        .await
        .map_err(|e| format!("Open VSX: {e}"))?;
    let url = download_url_from_metadata(&meta)?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Open VSX: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Open VSX download: HTTP {}", resp.status()));
    }
    if resp
        .content_length()
        .is_some_and(|n| n as usize > MAX_VSIX_BYTES)
    {
        return Err("the VSIX is larger than 100 MiB".into());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Open VSX download: {e}"))?;
    if bytes.len() > MAX_VSIX_BYTES {
        return Err("the VSIX is larger than 100 MiB".into());
    }
    // Garante que é mesmo um VSIX antes de o entregar à UI.
    manifest(&bytes)?;
    Ok(bytes.to_vec())
}

/// Um resultado da pesquisa do Open VSX (ADR-0006, R6b): o que o pane «Extensions» mostra.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvsxHit {
    /// `publisher.name` (o id que o `vsix_fetch_open_vsx` descarrega).
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub description: String,
    pub version: String,
    pub downloads: u64,
    pub verified: bool,
}

/// Quantos resultados se pedem por pesquisa (1..=50).
pub fn search_size(size: Option<u32>) -> u32 {
    size.unwrap_or(30).clamp(1, 50)
}

/// Os resultados da resposta de `/api/-/search` — os sem id válido e os descontinuados ficam de fora.
pub fn parse_search(v: &Value) -> Vec<OvsxHit> {
    let s = |x: &Value| x.as_str().unwrap_or_default().to_string();
    v["extensions"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|e| !e["deprecated"].as_bool().unwrap_or(false))
                .filter_map(|e| {
                    let (publisher, name) = (s(&e["namespace"]), s(&e["name"]));
                    let id = format!("{publisher}.{name}");
                    if !valid_extension_id(&id) {
                        return None;
                    }
                    let display = s(&e["displayName"]);
                    Some(OvsxHit {
                        id,
                        name: if display.is_empty() { name } else { display },
                        publisher,
                        description: s(&e["description"]),
                        version: s(&e["version"]),
                        downloads: e["downloadCount"].as_u64().unwrap_or(0),
                        verified: e["verified"].as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pesquisa extensões no Open VSX (só fala com open-vsx.org).
pub async fn search_open_vsx(query: &str, size: Option<u32>) -> Result<Vec<OvsxHit>, String> {
    let q = query.trim();
    if q.is_empty() || q.len() > 200 {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("dxtutor-ide/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("{OPEN_VSX}/api/-/search"))
        .query(&[("query", q.to_string()), ("size", search_size(size).to_string()), ("sortBy", "relevance".to_string())])
        .send()
        .await
        .map_err(|e| format!("Open VSX: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Open VSX: HTTP {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| format!("Open VSX: {e}"))?;
    Ok(parse_search(&v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn reads_package_json_from_a_vsix() {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            w.start_file(
                "extension/package.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            w.write_all(br#"{"name":"demo","publisher":"acme","contributes":{"commands":[{"command":"demo.hi","title":"Hi"}]}}"#).unwrap();
            w.finish().unwrap();
        }
        let m = manifest(buf.get_ref()).unwrap();
        assert_eq!(m["publisher"], "acme");
        assert_eq!(m["contributes"]["commands"][0]["title"], "Hi");
        assert!(manifest(b"nope").is_err());
    }

    #[test]
    fn open_vsx_urls_are_built_and_checked() {
        assert!(valid_extension_id("llvm-vs-code-extensions.vscode-clangd"));
        assert!(valid_extension_id("rust-lang.rust-analyzer"));
        for bad in ["", "noname", "a.", ".b", "a/b.c", "a.b/../x", "a b.c"] {
            assert!(!valid_extension_id(bad), "{bad}");
        }
        assert_eq!(
            open_vsx_latest_url("golang.go").unwrap(),
            "https://open-vsx.org/api/golang/go/latest"
        );
        assert!(open_vsx_latest_url("x/../y.z").is_err());
        let ok = serde_json::json!({"files": {"download": "https://open-vsx.org/api/golang/go/0.1.0/file/golang.go-0.1.0.vsix"}});
        assert!(download_url_from_metadata(&ok).unwrap().ends_with(".vsix"));
        let elsewhere = serde_json::json!({"files": {"download": "https://evil.example/x.vsix"}});
        assert!(download_url_from_metadata(&elsewhere).is_err());
        assert!(download_url_from_metadata(&serde_json::json!({})).is_err());
    }

    #[test]
    fn search_results_are_parsed_and_filtered() {
        let v = serde_json::json!({"extensions": [
            {"namespace": "rust-lang", "name": "rust-analyzer", "displayName": "rust-analyzer", "description": "Rust support", "version": "0.4.1", "downloadCount": 7, "verified": true},
            {"namespace": "old", "name": "thing", "deprecated": true},
            {"namespace": "bad id", "name": "x"},
            {"namespace": "golang", "name": "go", "version": "0.1"}
        ]});
        let hits = parse_search(&v);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0], OvsxHit { id: "rust-lang.rust-analyzer".into(), name: "rust-analyzer".into(), publisher: "rust-lang".into(), description: "Rust support".into(), version: "0.4.1".into(), downloads: 7, verified: true });
        assert_eq!(hits[1].name, "go"); // sem displayName, o nome
        assert!(parse_search(&serde_json::json!({})).is_empty());
        assert_eq!((search_size(None), search_size(Some(0)), search_size(Some(500))), (30, 1, 50));
    }

    /// Ao vivo contra o open-vsx.org (rede): `cargo test -p dxtutor-ide --lib -- --ignored open_vsx_live`.
    #[test]
    #[ignore = "needs network access to open-vsx.org"]
    fn open_vsx_live_download_is_a_real_vsix() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let bytes = rt
            .block_on(fetch_open_vsx("editorconfig.editorconfig"))
            .unwrap();
        let m = manifest(&bytes).unwrap();
        assert_eq!(m["name"], "EditorConfig");
        assert!(rt
            .block_on(fetch_open_vsx("dxtutor-nobody.no-such-ext"))
            .is_err());
    }
}
