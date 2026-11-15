//! Reads the manifest (extension/package.json) out of a VS Code extension package.

use base64::Engine;
use serde_json::Value;
use std::io::{Cursor, Read};

pub fn manifest(bytes: &[u8]) -> Result<Value, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("not a VSIX (zip): {e}"))?;
    let mut f = zip.by_name("extension/package.json").map_err(|_| "extension/package.json not found — is this a VSIX?".to_string())?;
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| format!("package.json: {e}"))
}

pub fn manifest_b64(b64: &str) -> Result<Value, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| e.to_string())?;
    manifest(&bytes)
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
            w.start_file("extension/package.json", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(br#"{"name":"demo","publisher":"acme","contributes":{"commands":[{"command":"demo.hi","title":"Hi"}]}}"#).unwrap();
            w.finish().unwrap();
        }
        let m = manifest(buf.get_ref()).unwrap();
        assert_eq!(m["publisher"], "acme");
        assert_eq!(m["contributes"]["commands"][0]["title"], "Hi");
        assert!(manifest(b"nope").is_err());
    }
}
