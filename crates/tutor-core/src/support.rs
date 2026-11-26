//! **Ficheiros de apoio** de um curso: só de leitura, partilhados por TODOS os passos.
//!
//! Um curso pode precisar de ficheiros que não são do aluno nem de um passo: uma biblioteca
//! que não existe num registo público (o bundle do Dxjs, que não está no npm), um ambiente de
//! teste (um DOM para o Node), um ficheiro de configuração comum. Copiá-los para cada passo
//! repetia megabytes; ir buscá-los à rede na avaliação partia o «offline». O curso declara-os
//! UMA vez, numa tabela `support`:
//!
//! ```toml
//! [support]                                     # caminho na pasta de trabalho → ficheiro do plugin
//! "node_modules/.dxjs/dxjs.js" = "support/dxjs-1.2.0.js"
//! "node_modules/@dxjs/core/index.js" = "support/core/index.js"
//! ```
//!
//! Quem lê o curso resolve a tabela ([`resolve`]): o plugin instalado lê os ficheiros do disco
//! (`tutor-plugins`), o curso embutido do binário (`include_str!`). O conteúdo fica em
//! [`crate::Course::support_files`] e viaja no [`crate::Phase::support`] até ao avaliador, que
//! o escreve ao lado dos ficheiros de cada drill, desafio ou projecto, sem nunca o deixar ser
//! substituído (um ficheiro do aluno com o mesmo caminho é um erro). Nunca vai para o webview.
//!
//! As regras de forma vivem aqui, para a validação dos plugins, os embutidos e o avaliador
//! aplicarem as mesmas: caminhos seguros dos dois lados (os de [`crate::safe_project_path`]),
//! só texto UTF-8, e limites de número e tamanho.

use std::collections::{BTreeMap, BTreeSet};

use crate::project::{safe_project_path, ProjectFiles};

/// Máximo de ficheiros de apoio de um curso.
pub const MAX_SUPPORT_FILES: usize = 64;
/// Tamanho máximo de um ficheiro de apoio (bytes): cabe uma biblioteca empacotada num só ficheiro.
pub const MAX_SUPPORT_FILE_BYTES: usize = 2 * 1024 * 1024;
/// Tamanho máximo de todos os ficheiros de apoio de um curso (bytes).
pub const MAX_SUPPORT_BYTES: usize = 4 * 1024 * 1024;

/// Erros de forma da tabela `support` como o curso a declara (vazio = válida): caminhos
/// seguros na pasta de trabalho e no plugin, nenhum caminho que seja ficheiro e também pasta
/// de outro, e no máximo [`MAX_SUPPORT_FILES`] entradas.
pub fn check_declared(support: &BTreeMap<String, String>) -> Vec<String> {
    let mut errs = Vec::new();
    if support.len() > MAX_SUPPORT_FILES {
        errs.push(format!("support: more than {MAX_SUPPORT_FILES} files"));
    }
    for (dest, source) in support {
        if !safe_project_path(dest) {
            errs.push(format!(
                "support: `{dest}` is not a safe relative path in the work folder (use `a/b.ext`, no `..`)"
            ));
        }
        if !safe_project_path(source) {
            errs.push(format!(
                "support: source `{source}` (for `{dest}`) is not a safe path inside the plugin"
            ));
        }
    }
    errs.extend(file_folder_clashes(
        support.keys().map(String::as_str),
        "support",
    ));
    errs
}

/// Erros do conteúdo carregado (vazio = cabe nos limites).
pub fn check_loaded(files: &BTreeMap<String, String>) -> Vec<String> {
    let mut errs = Vec::new();
    let mut total = 0usize;
    for (dest, content) in files {
        if content.len() > MAX_SUPPORT_FILE_BYTES {
            errs.push(format!(
                "support: `{dest}` is larger than {} MiB",
                MAX_SUPPORT_FILE_BYTES / (1024 * 1024)
            ));
        }
        total += content.len();
    }
    if total > MAX_SUPPORT_BYTES {
        errs.push(format!(
            "support: the files add up to more than {} MiB",
            MAX_SUPPORT_BYTES / (1024 * 1024)
        ));
    }
    errs
}

/// Resolve a tabela `support` com `read` (fonte no plugin → conteúdo, ou o motivo de não o
/// conseguir ler). Devolve os ficheiros (caminho na pasta de trabalho → conteúdo) ou TODOS os
/// erros (forma, leitura, limites).
pub fn resolve(
    support: &BTreeMap<String, String>,
    mut read: impl FnMut(&str) -> Result<String, String>,
) -> Result<BTreeMap<String, String>, Vec<String>> {
    let mut errs = check_declared(support);
    if !errs.is_empty() {
        return Err(errs);
    }
    let mut files = BTreeMap::new();
    for (dest, source) in support {
        match read(source) {
            Ok(content) => {
                files.insert(dest.clone(), content);
            }
            Err(why) => errs.push(format!("support: `{source}`: {why}")),
        }
    }
    errs.extend(check_loaded(&files));
    if errs.is_empty() {
        Ok(files)
    } else {
        Err(errs)
    }
}

/// Choques entre os ficheiros de apoio e os de um passo de projecto (iniciais e testes): o
/// mesmo caminho, ou um que é ficheiro de um lado e pasta do outro. A avaliação recusaria o
/// passo; a validação diz qual.
pub fn project_clashes(support: &BTreeMap<String, String>, project: &ProjectFiles) -> Vec<String> {
    let mut errs = Vec::new();
    for p in project.starter.keys().chain(project.tests.keys()) {
        if support.contains_key(p) {
            errs.push(format!("`{p}` is also a support file of the course"));
        }
    }
    let all = support
        .keys()
        .chain(project.starter.keys())
        .chain(project.tests.keys())
        .map(String::as_str);
    errs.extend(file_folder_clashes(all, "project + support"));
    errs
}

/// Caminhos que são ficheiro e também pasta de outro (`a` e `a/b`).
fn file_folder_clashes<'a>(paths: impl Iterator<Item = &'a str>, what: &str) -> Vec<String> {
    let seen: BTreeSet<&str> = paths.collect();
    let mut errs = Vec::new();
    for p in &seen {
        let segs: Vec<&str> = p.split('/').collect();
        let mut prefix = String::new();
        for seg in &segs[..segs.len() - 1] {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(seg);
            if seen.contains(prefix.as_str()) {
                errs.push(format!(
                    "{what}: `{prefix}` is a file and also the folder of `{p}`"
                ));
            }
        }
    }
    errs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn resolve_le_cada_fonte_e_devolve_os_ficheiros_pela_pasta_de_trabalho() {
        let decl = map(&[
            ("node_modules/.lib/lib.js", "support/lib-1.0.js"),
            ("node_modules/@x/core/index.js", "support/core/index.js"),
        ]);
        let files = resolve(&decl, |src| Ok(format!("<{src}>"))).unwrap();
        assert_eq!(
            files,
            map(&[
                ("node_modules/.lib/lib.js", "<support/lib-1.0.js>"),
                ("node_modules/@x/core/index.js", "<support/core/index.js>"),
            ])
        );
    }

    #[test]
    fn caminhos_inseguros_e_choques_ficheiro_pasta_sao_erros_antes_de_ler() {
        let decl = map(&[
            ("../escape.js", "support/a.js"),
            ("ok.js", "../../etc/passwd"),
            ("lib", "support/lib.js"),
            ("lib/inner.js", "support/inner.js"),
        ]);
        let mut reads = 0;
        let errs = resolve(&decl, |_| {
            reads += 1;
            Ok(String::new())
        })
        .unwrap_err()
        .join("\n");
        assert_eq!(reads, 0, "nada se lê com a tabela mal formada");
        for frag in [
            "`../escape.js` is not a safe relative path",
            "source `../../etc/passwd` (for `ok.js`)",
            "`lib` is a file and also the folder of `lib/inner.js`",
        ] {
            assert!(errs.contains(frag), "falta `{frag}` em:\n{errs}");
        }
    }

    #[test]
    fn leituras_falhadas_e_limites_juntam_todos_os_erros() {
        let decl = map(&[("a.js", "support/a.js"), ("b.js", "support/missing.js")]);
        let big = "x".repeat(MAX_SUPPORT_FILE_BYTES + 1);
        let errs = resolve(&decl, |src| {
            if src.ends_with("missing.js") {
                Err("file not found".into())
            } else {
                Ok(big.clone())
            }
        })
        .unwrap_err()
        .join("\n");
        assert!(
            errs.contains("`support/missing.js`: file not found"),
            "{errs}"
        );
        assert!(errs.contains("`a.js` is larger than 2 MiB"), "{errs}");

        let many: BTreeMap<String, String> = (0..=MAX_SUPPORT_FILES)
            .map(|i| (format!("f{i}.js"), format!("support/f{i}.js")))
            .collect();
        assert!(check_declared(&many)
            .join("\n")
            .contains("more than 64 files"));
        let total: BTreeMap<String, String> = (0..3)
            .map(|i| (format!("f{i}.js"), "x".repeat(MAX_SUPPORT_FILE_BYTES)))
            .collect();
        assert!(check_loaded(&total)
            .join("\n")
            .contains("add up to more than 4 MiB"));
    }

    #[test]
    fn um_passo_de_projecto_nao_pode_reusar_um_caminho_de_apoio() {
        let support = map(&[("node_modules/lib/index.js", "support/lib.js")]);
        let project = ProjectFiles {
            main: "src/app.ts".into(),
            starter: map(&[("src/app.ts", ""), ("node_modules/lib/index.js", "")]),
            tests: map(&[("node_modules/lib/index.js/x.test.ts", "")]),
            ..Default::default()
        };
        let errs = project_clashes(&support, &project).join("\n");
        assert!(
            errs.contains("`node_modules/lib/index.js` is also a support file"),
            "{errs}"
        );
        assert!(
            errs.contains("`node_modules/lib/index.js` is a file and also the folder of"),
            "{errs}"
        );
        let clean = ProjectFiles {
            starter: map(&[("src/app.ts", "")]),
            tests: map(&[("app.test.ts", "")]),
            ..project
        };
        assert!(project_clashes(&support, &clean).is_empty());
    }
}
