//! Carregar os **ficheiros de apoio** de um curso (`tutor_core::support`) da pasta de um plugin.
//!
//! O curso declara `caminho na pasta de trabalho → ficheiro do plugin`; aqui lê-se cada ficheiro
//! com as regras de quem lê conteúdo de fora: o caminho é seguro (as regras do modelo), não é uma
//! ligação simbólica, é um ficheiro normal, fica DENTRO da pasta do plugin depois de resolvido,
//! cabe no limite antes de ser lido e é texto UTF-8. A validação (`dxt plugin validate`, a
//! instalação) e o registo dos plugins instalados usam esta mesma função.

use std::path::Path;

use tutor_core::support::MAX_SUPPORT_FILE_BYTES;
use tutor_core::Course;

/// Carrega os ficheiros de apoio de `course`, lidos de `dir` (a raiz do plugin). Sem tabela
/// `support`, não faz nada. Com algum erro, o curso fica sem eles e devolvem-se todos.
pub fn load_support(dir: &Path, course: &mut Course) -> Result<(), Vec<String>> {
    if course.support.is_empty() {
        return Ok(());
    }
    let root = dir
        .canonicalize()
        .map_err(|e| vec![format!("support: cannot resolve the plugin folder: {e}")])?;
    course.load_support(|source| read_support_file(&root, source))
}

/// Lê `source` (relativo a `root`, já canónica). Ver o cabeçalho do módulo para as regras.
fn read_support_file(root: &Path, source: &str) -> Result<String, String> {
    let path = root.join(source);
    let meta = std::fs::symlink_metadata(&path).map_err(|_| "file not found".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("is a symbolic link".into());
    }
    if !meta.is_file() {
        return Err("is not a regular file".into());
    }
    if meta.len() > MAX_SUPPORT_FILE_BYTES as u64 {
        return Err(format!(
            "is larger than {} MiB",
            MAX_SUPPORT_FILE_BYTES / (1024 * 1024)
        ));
    }
    let real = path.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(root) {
        return Err("leaves the plugin folder".into());
    }
    let bytes = std::fs::read(&real).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "is not UTF-8 text".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_core::CourseFormat;

    fn course(support: &str) -> Course {
        let raw = format!(
            "id = \"c\"\nlanguage = \"typescript\"\ntitle = \"T\"\nlevel = \"x\"\nsummary = \"s\"\n{support}\n\n[[unit]]\nid = \"u\"\ntitle = \"U\"\n\n[[unit.step]]\nkind = \"concept\"\nid = \"c1\"\ntitle = \"C\"\nbody = \"b\"\n"
        );
        Course::parse(&raw, CourseFormat::Toml).unwrap()
    }

    #[test]
    fn le_os_ficheiros_do_plugin_para_os_caminhos_da_pasta_de_trabalho() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("support/lib")).unwrap();
        std::fs::write(dir.path().join("support/lib/index.js"), "export const x = 1;\n").unwrap();
        let mut c = course(
            "[support]\n\"node_modules/lib/index.js\" = \"support/lib/index.js\"",
        );
        load_support(dir.path(), &mut c).unwrap();
        assert_eq!(
            c.support_files.get("node_modules/lib/index.js").map(String::as_str),
            Some("export const x = 1;\n")
        );
        // Sem tabela, nada a fazer.
        let mut plain = course("");
        load_support(dir.path(), &mut plain).unwrap();
        assert!(plain.support_files.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn recusa_ligacoes_pastas_ficheiros_em_falta_e_binarios() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        std::fs::create_dir_all(dir.path().join("support/folder")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            dir.path().join("support/link.js"),
        )
        .unwrap();
        std::fs::write(dir.path().join("support/bin.js"), [0xff, 0xfe, 0x00]).unwrap();
        let mut c = course(
            "[support]\n\"a.js\" = \"support/link.js\"\n\"b.js\" = \"support/folder\"\n\"c.js\" = \"support/none.js\"\n\"d.js\" = \"support/bin.js\"",
        );
        let errs = load_support(dir.path(), &mut c).unwrap_err().join("\n");
        for frag in [
            "`support/link.js`: is a symbolic link",
            "`support/folder`: is not a regular file",
            "`support/none.js`: file not found",
            "`support/bin.js`: is not UTF-8 text",
        ] {
            assert!(errs.contains(frag), "falta `{frag}` em:\n{errs}");
        }
        assert!(c.support_files.is_empty(), "com erros, o curso fica sem apoio");
    }
}
