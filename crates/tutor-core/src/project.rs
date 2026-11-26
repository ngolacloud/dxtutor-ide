//! **Passos de projecto** (vários ficheiros) de um curso guiado.
//!
//! Um desafio (`kind = "challenge"`) pode trazer uma tabela `project` em vez de `starter`/
//! `tests`/`gabarito`: um conjunto de ficheiros com que o aluno começa, ficheiros de teste
//! ocultos, a solução de referência (gabarito) em ficheiros, o ficheiro a abrir primeiro e os
//! ficheiros só de leitura. É o que os cursos de frameworks e ferramentas precisam (um módulo
//! Django, um manifesto e o seu Dockerfile), e que um desafio de um só ficheiro não exprime.
//!
//! ```toml
//! [unit.step.project]
//! main = "shop/service.py"            # aberto primeiro; tem de ser editável
//! readonly = ["shop/__init__.py"]      # o aluno vê, não muda; a avaliação usa a cópia do curso
//! explanation = "Porquê esta solução." # markdown mostrado com a solução, depois de passar
//!
//! [unit.step.project.starter]          # caminho → conteúdo (o que o aluno recebe)
//! "shop/__init__.py" = ""
//! "shop/service.py" = '''...'''
//!
//! [unit.step.project.tests]            # ocultos: nunca vão para o webview
//! "test_shop.py" = '''...'''
//!
//! [unit.step.project.solution]         # gabarito: os ficheiros editáveis como devem acabar
//! "shop/service.py" = '''...'''
//! ```
//!
//! As regras de forma ([`ProjectFiles::check`]) e de montagem da árvore do aluno
//! ([`ProjectFiles::learner_tree`]) vivem aqui, no modelo, para a validação dos plugins, o
//! avaliador e o backend aplicarem exactamente as mesmas.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

/// Máximo de ficheiros de um passo de projecto (iniciais + testes).
pub const MAX_PROJECT_FILES: usize = 64;
/// Tamanho máximo de um ficheiro de um passo de projecto (bytes).
pub const MAX_PROJECT_FILE_BYTES: usize = 256 * 1024;
/// Tamanho máximo da árvore inteira (iniciais + testes, ou a submissão) em bytes.
pub const MAX_PROJECT_BYTES: usize = 2 * 1024 * 1024;
/// Comprimento máximo de um caminho e profundidade máxima (número de segmentos).
const MAX_PATH_LEN: usize = 200;
const MAX_PATH_DEPTH: usize = 10;

/// O conjunto de ficheiros de um passo de projecto. Ver o cabeçalho do módulo.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct ProjectFiles {
    /// O ficheiro que o editor abre primeiro (uma chave de `starter`, editável).
    #[serde(default)]
    pub main: String,
    /// Os ficheiros com que o aluno começa (caminho relativo → conteúdo).
    #[serde(default)]
    pub starter: BTreeMap<String, String>,
    /// Caminhos de `starter` que o aluno vê mas não muda. A avaliação usa sempre a cópia do
    /// curso, e uma submissão que os traga é recusada.
    #[serde(default)]
    pub readonly: Vec<String>,
    /// Ficheiros de teste OCULTOS, escritos ao lado dos do aluno na avaliação.
    #[serde(default)]
    pub tests: BTreeMap<String, String>,
    /// Solução de referência (gabarito): os ficheiros editáveis como devem acabar. Os que não
    /// aparecem aqui ficam como no `starter`. Oculta até os testes passarem.
    #[serde(default)]
    pub solution: BTreeMap<String, String>,
    /// Explicação da solução (markdown), mostrada com ela depois de os testes passarem.
    #[serde(default)]
    pub explanation: String,
}

/// Um caminho de ficheiro de projecto seguro: relativo, só com `/` como separador, sem
/// segmentos vazios, `.` ou `..`, e cada segmento feito de `[A-Za-z0-9._+@-]`. Nunca sai da
/// pasta de trabalho onde a árvore é escrita.
pub fn safe_project_path(p: &str) -> bool {
    if p.is_empty() || p.len() > MAX_PATH_LEN {
        return false;
    }
    let segs: Vec<&str> = p.split('/').collect();
    segs.len() <= MAX_PATH_DEPTH
        && segs.iter().all(|s| {
            !s.is_empty()
                && *s != "."
                && *s != ".."
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+' | '@'))
        })
}

/// Erros de uma árvore de ficheiros: caminhos inseguros, um ficheiro que é também pasta de
/// outro (`a` e `a/b`), ficheiros grandes demais. `what` nomeia a árvore nas mensagens.
fn check_tree<'a>(
    paths: impl Iterator<Item = (&'a String, &'a String)>,
    what: &str,
    errs: &mut Vec<String>,
) {
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut total = 0usize;
    for (p, content) in paths {
        if !safe_project_path(p) {
            errs.push(format!(
                "{what}: path `{p}` is not a safe relative path (use `a/b.ext`, no `..`, no `\\`)"
            ));
            continue;
        }
        if content.len() > MAX_PROJECT_FILE_BYTES {
            errs.push(format!(
                "{what}: `{p}` is larger than {} KiB",
                MAX_PROJECT_FILE_BYTES / 1024
            ));
        }
        total += content.len();
        seen.insert(p.as_str());
    }
    if total > MAX_PROJECT_BYTES {
        errs.push(format!(
            "{what}: the files add up to more than {} MiB",
            MAX_PROJECT_BYTES / (1024 * 1024)
        ));
    }
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
}

impl ProjectFiles {
    /// `true` se `path` é um ficheiro inicial que o aluno pode mudar.
    pub fn is_editable(&self, path: &str) -> bool {
        self.starter.contains_key(path) && !self.readonly.iter().any(|r| r == path)
    }

    /// Os caminhos editáveis (os de `starter` que não são só de leitura), por ordem.
    pub fn editable(&self) -> Vec<&str> {
        self.starter
            .keys()
            .map(String::as_str)
            .filter(|p| self.is_editable(p))
            .collect()
    }

    /// Erros de forma do conjunto de ficheiros (vazio = válido). A validação dos plugins e o
    /// avaliador usam a mesma regra.
    pub fn check(&self) -> Vec<String> {
        let mut errs = Vec::new();
        if self.starter.is_empty() {
            errs.push("project.starter is empty: list the files the learner starts with".into());
        }
        if self.tests.is_empty() {
            errs.push("project.tests is empty: a project step needs hidden test files".into());
        }
        if self.solution.is_empty() {
            errs.push("project.solution is empty: give the reference solution files".into());
        }
        if self.starter.len() + self.tests.len() > MAX_PROJECT_FILES {
            errs.push(format!(
                "project: more than {MAX_PROJECT_FILES} files (starter + tests)"
            ));
        }
        check_tree(
            self.starter.iter().chain(self.tests.iter()),
            "project",
            &mut errs,
        );
        check_tree(self.solution.iter(), "project.solution", &mut errs);
        for t in self.tests.keys() {
            if self.starter.contains_key(t) {
                errs.push(format!(
                    "project.tests: `{t}` is also a starter file (hidden tests must be separate files)"
                ));
            }
        }
        for r in &self.readonly {
            if !self.starter.contains_key(r) {
                errs.push(format!("project.readonly: `{r}` is not a starter file"));
            }
        }
        if self.main.is_empty() {
            errs.push("project.main is empty: name the file the editor opens first".into());
        } else if !self.starter.contains_key(&self.main) {
            errs.push(format!(
                "project.main: `{}` is not a starter file",
                self.main
            ));
        } else if !self.is_editable(&self.main) {
            errs.push(format!("project.main: `{}` is read-only", self.main));
        }
        for s in self.solution.keys() {
            if !self.is_editable(s) {
                errs.push(format!(
                    "project.solution: `{s}` is not an editable starter file"
                ));
            }
        }
        errs
    }

    /// A árvore que o aluno entrega para avaliação: os ficheiros iniciais com os `submitted`
    /// por cima. Só se aceitam caminhos editáveis (um ficheiro só de leitura ou desconhecido é
    /// um erro, nunca ignorado em silêncio); os que faltam ficam como no `starter`, e os só de
    /// leitura ficam SEMPRE com a cópia do curso.
    pub fn learner_tree(
        &self,
        submitted: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, String>, String> {
        let mut total = 0usize;
        for (p, content) in submitted {
            if !self.starter.contains_key(p) {
                return Err(format!("`{p}` is not a file of this project step"));
            }
            if !self.is_editable(p) {
                return Err(format!("`{p}` is read-only in this project step"));
            }
            if content.len() > MAX_PROJECT_FILE_BYTES {
                return Err(format!(
                    "`{p}` is larger than {} KiB",
                    MAX_PROJECT_FILE_BYTES / 1024
                ));
            }
            total += content.len();
        }
        if total > MAX_PROJECT_BYTES {
            return Err(format!(
                "the submitted files add up to more than {} MiB",
                MAX_PROJECT_BYTES / (1024 * 1024)
            ));
        }
        let mut tree = self.starter.clone();
        for (p, content) in submitted {
            tree.insert(p.clone(), content.clone());
        }
        Ok(tree)
    }

    /// A árvore da solução de referência (o gabarito por cima dos ficheiros iniciais).
    pub fn solution_tree(&self) -> Result<BTreeMap<String, String>, String> {
        self.learner_tree(&self.solution)
    }
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

    fn sample() -> ProjectFiles {
        ProjectFiles {
            main: "app/service.py".into(),
            starter: map(&[
                ("app/__init__.py", ""),
                ("app/models.py", "M0"),
                ("app/service.py", "S0"),
            ]),
            readonly: vec!["app/__init__.py".into()],
            tests: map(&[("test_app.py", "T")]),
            solution: map(&[("app/models.py", "M1"), ("app/service.py", "S1")]),
            explanation: String::new(),
        }
    }

    #[test]
    fn caminhos_seguros() {
        for ok in [
            "a.py",
            "pkg/mod.py",
            ".env.example",
            "k8s/deploy-v1.yaml",
            "a+b@c.txt",
        ] {
            assert!(safe_project_path(ok), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../b",
            "a//b",
            "./a",
            "a/",
            "a\\b",
            "C:x",
            "a b",
            "ç.py",
            "a\0b",
        ] {
            assert!(!safe_project_path(bad), "{bad:?}");
        }
        // 11 segmentos: acima da profundidade máxima.
        assert!(!safe_project_path("a/".repeat(11).trim_end_matches('/')));
        assert!(safe_project_path("a/".repeat(10).trim_end_matches('/')));
    }

    #[test]
    fn conjunto_valido_nao_tem_erros() {
        assert_eq!(sample().check(), Vec::<String>::new());
        assert_eq!(sample().editable(), vec!["app/models.py", "app/service.py"]);
    }

    #[test]
    fn apanha_os_erros_de_forma() {
        let mut p = sample();
        p.main = "app/__init__.py".into();
        p.readonly.push("nope.py".into());
        p.tests.insert("app/models.py".into(), "x".into());
        p.solution.insert("app/__init__.py".into(), "x".into());
        p.starter.insert("../evil.py".into(), "x".into());
        p.starter.insert("app".into(), "file and folder".into());
        let e = p.check().join("\n");
        for frag in [
            "project.main: `app/__init__.py` is read-only",
            "project.readonly: `nope.py`",
            "project.tests: `app/models.py` is also a starter file",
            "project.solution: `app/__init__.py` is not an editable",
            "`../evil.py` is not a safe relative path",
            "`app` is a file and also the folder of `app/models.py`",
        ] {
            assert!(e.contains(frag), "falta `{frag}` em:\n{e}");
        }
        let vazio = ProjectFiles::default().check().join("\n");
        for frag in [
            "starter is empty",
            "tests is empty",
            "solution is empty",
            "main is empty",
        ] {
            assert!(vazio.contains(frag), "{frag}");
        }
    }

    #[test]
    fn arvore_do_aluno_so_aceita_editaveis_e_repoe_os_so_de_leitura() {
        let p = sample();
        let t = p.learner_tree(&map(&[("app/service.py", "S2")])).unwrap();
        assert_eq!(t["app/service.py"], "S2");
        assert_eq!(
            t["app/models.py"], "M0",
            "os que faltam ficam como no starter"
        );
        assert_eq!(t["app/__init__.py"], "");
        assert!(
            !t.contains_key("test_app.py"),
            "os testes não fazem parte da árvore do aluno"
        );
        assert!(p
            .learner_tree(&map(&[("app/__init__.py", "hack")]))
            .unwrap_err()
            .contains("read-only"));
        assert!(p
            .learner_tree(&map(&[("test_app.py", "pass")]))
            .unwrap_err()
            .contains("not a file of this project step"));
        assert!(p
            .learner_tree(&map(&[("../x", "")]))
            .unwrap_err()
            .contains("not a file"));
        let big = "x".repeat(MAX_PROJECT_FILE_BYTES + 1);
        assert!(p
            .learner_tree(&map(&[("app/service.py", &big)]))
            .unwrap_err()
            .contains("larger"));
        let sol = p.solution_tree().unwrap();
        assert_eq!(
            (
                sol["app/models.py"].as_str(),
                sol["app/service.py"].as_str()
            ),
            ("M1", "S1")
        );
    }
}
