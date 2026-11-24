//! Checkpoints dos ficheiros do projecto (F6), para voltar atrás depois de um turno.
//!
//! Antes da primeira alteração de ficheiros em cada turno, o loop tira um snapshot da
//! árvore de trabalho inteira (ficheiros seguidos e por seguir, respeitando o
//! `.gitignore`) como um commit git **que nenhum ramo vê**: é escrito com um *index*
//! temporário e guardado numa ref oculta `refs/dxtutor/cp/<sessão>/<n>`. O index, os
//! ramos e o stash do utilizador não são tocados.
//!
//! Voltar a um checkpoint repõe só os ficheiros que mudaram desde então e apaga os que
//! foram criados depois — sem reescrever os restantes (os builds incrementais não
//! recompilam tudo). A conversa não é editada: continua append-only, e a sessão avisa o
//! modelo do rewind na mensagem seguinte.
//!
//! Só existe em repositórios git; fora deles, `Checkpoints::new` devolve `None`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use crate::tool::ToolCtx;
use crate::tools::run_process;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Checkpoint {
    pub id: u32,
    /// O pedido do utilizador que abriu o turno (para a lista na UI).
    pub label: String,
    pub created: u64,
    pub commit: String,
}

pub struct Checkpoints {
    root: PathBuf,
    session: String,
    list: Mutex<Vec<Checkpoint>>,
}

fn ctx(root: &Path) -> ToolCtx {
    ToolCtx {
        root: root.to_path_buf(),
        cancel: Arc::new(AtomicBool::new(false)),
    }
}

/// Corre `git` na raiz; com `index`, usa esse ficheiro de index em vez do do utilizador.
fn git(root: &Path, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    let mut c = Command::new("git");
    c.args(args);
    if let Some(i) = index {
        c.env("GIT_INDEX_FILE", i);
    }
    let r = run_process(c, root, Duration::from_secs(120), &ctx(root));
    if r.ok() {
        Ok(r.stdout.trim_end().to_string())
    } else {
        Err(format!(
            "git {}: {}",
            args.first().unwrap_or(&""),
            r.stderr.trim()
        ))
    }
}

impl Checkpoints {
    /// `None` se `root` não é um repositório git (ou o git não está disponível).
    pub fn new(root: &Path, session: &str) -> Option<Self> {
        let inside = git(root, &["rev-parse", "--is-inside-work-tree"], None).ok()?;
        (inside == "true").then(|| Checkpoints {
            root: root.to_path_buf(),
            session: session
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect(),
            list: Mutex::new(vec![]),
        })
    }

    /// Escreve a árvore de trabalho actual como um tree object, sem tocar no index real.
    fn worktree_tree(&self) -> Result<String, String> {
        let tmp = crate::tools::unique_temp("dxtutor-cp", "index");
        // parte do index real (só re-hasheia o que mudou) — se não houver, começa vazio
        if let Ok(real) = git(&self.root, &["rev-parse", "--git-path", "index"], None) {
            let real = if Path::new(&real).is_absolute() {
                PathBuf::from(real)
            } else {
                self.root.join(real)
            };
            let _ = std::fs::copy(real, &tmp);
        }
        let r = git(&self.root, &["add", "-A", "--", "."], Some(&tmp))
            .and_then(|_| git(&self.root, &["write-tree"], Some(&tmp)));
        let _ = std::fs::remove_file(&tmp);
        r
    }

    /// Tira um checkpoint agora.
    pub fn snapshot(&self, label: &str) -> Result<Checkpoint, String> {
        let tree = self.worktree_tree()?;
        let msg = format!("dxtutor checkpoint: {label}");
        let commit = git(&self.root, &["commit-tree", &tree, "-m", &msg], None)?;
        let mut list = self.list.lock().unwrap();
        let id = list.last().map(|c| c.id + 1).unwrap_or(1);
        git(
            &self.root,
            &[
                "update-ref",
                &format!("refs/dxtutor/cp/{}/{id}", self.session),
                &commit,
            ],
            None,
        )?;
        let cp = Checkpoint {
            id,
            label: label.chars().take(80).collect(),
            created: crate::session::now(),
            commit,
        };
        list.push(cp.clone());
        Ok(cp)
    }

    pub fn list(&self) -> Vec<Checkpoint> {
        self.list.lock().unwrap().clone()
    }

    /// Repõe os ficheiros como estavam no checkpoint `id`. Devolve um resumo.
    pub fn restore(&self, id: u32) -> Result<String, String> {
        let cp = self
            .list()
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("checkpoint {id} não existe"))?;
        let now = self.worktree_tree()?;
        let target = format!("{}^{{tree}}", cp.commit);
        // ficheiros que diferem entre o checkpoint e agora
        let diff = git(
            &self.root,
            &["diff", "--name-status", "--no-renames", "-z", &target, &now],
            None,
        )?;
        let mut parts = diff.split('\0').filter(|s| !s.is_empty());
        let (mut restore, mut delete) = (vec![], vec![]);
        while let (Some(status), Some(path)) = (parts.next(), parts.next()) {
            match status {
                "A" => delete.push(path.to_string()), // criado depois do checkpoint
                _ => restore.push(path.to_string()),  // modificado ou apagado depois
            }
        }
        for p in &delete {
            let abs = crate::sandbox::resolve(&self.root, p)?;
            let _ = std::fs::remove_file(abs);
        }
        if !restore.is_empty() {
            let tmp = crate::tools::unique_temp("dxtutor-rs", "index");
            let mut args = vec!["checkout-index", "-f", "--"];
            args.extend(restore.iter().map(String::as_str));
            let r = git(&self.root, &["read-tree", &target], Some(&tmp))
                .and_then(|_| git(&self.root, &args, Some(&tmp)));
            let _ = std::fs::remove_file(&tmp);
            r?;
        }
        Ok(format!(
            "ficheiros repostos para o checkpoint {id} («{}»): {} reposto(s), {} apagado(s)",
            cp.label,
            restore.len(),
            delete.len()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let g = |args: &[&str]| {
            assert!(Command::new("git")
                .args(args)
                .current_dir(d.path())
                .output()
                .unwrap()
                .status
                .success())
        };
        g(&["init", "-q", "-b", "main"]);
        // Identidade local: o `snapshot` usa `git commit-tree`, que precisa dela, e uma
        // máquina sem `user.name`/`user.email` globais (o runner do CI) não a tem.
        g(&["config", "user.name", "t"]);
        g(&["config", "user.email", "t@t"]);
        std::fs::write(d.path().join("a.txt"), "um\n").unwrap();
        std::fs::write(d.path().join(".gitignore"), "target/\n").unwrap();
        g(&["add", "."]);
        g(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-qm",
            "init",
        ]);
        d
    }

    #[test]
    fn not_a_repo_has_no_checkpoints() {
        let d = tempfile::tempdir().unwrap();
        assert!(Checkpoints::new(d.path(), "s").is_none());
    }

    #[test]
    fn rewind_restores_modified_deleted_and_removes_created_without_touching_the_index() {
        let d = repo();
        let root = d.path();
        std::fs::write(root.join("novo-antes.txt"), "por seguir mas existente\n").unwrap();
        let index_before = std::fs::read(root.join(".git/index")).unwrap();
        let cps = Checkpoints::new(root, "sess-1").unwrap();
        let cp = cps.snapshot("corrige a soma").unwrap();
        assert_eq!(cp.id, 1);

        // o "agente" mexe em tudo
        std::fs::write(root.join("a.txt"), "estragado\n").unwrap();
        std::fs::remove_file(root.join("novo-antes.txt")).unwrap();
        std::fs::write(root.join("criado-depois.rs"), "x").unwrap();
        std::fs::create_dir_all(root.join("target")).unwrap();
        std::fs::write(root.join("target/ignorado"), "build").unwrap();

        let msg = cps.restore(1).unwrap();
        assert!(msg.contains("2 reposto(s), 1 apagado(s)"), "{msg}");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "um\n");
        assert_eq!(
            std::fs::read_to_string(root.join("novo-antes.txt")).unwrap(),
            "por seguir mas existente\n"
        );
        assert!(!root.join("criado-depois.rs").exists());
        assert!(
            root.join("target/ignorado").exists(),
            "ficheiros ignorados não são tocados"
        );
        assert_eq!(
            std::fs::read(root.join(".git/index")).unwrap(),
            index_before,
            "o index do utilizador fica intacto"
        );

        // ref oculta, sem ramo novo
        let refs = Command::new("git")
            .args(["for-each-ref", "--format=%(refname)"])
            .current_dir(root)
            .output()
            .unwrap();
        let refs = String::from_utf8_lossy(&refs.stdout);
        assert!(refs.contains("refs/dxtutor/cp/sess-1/1"));
        assert!(!refs.contains("refs/heads/dxtutor"));
        assert!(cps.restore(9).is_err());
        assert_eq!(cps.snapshot("outro").unwrap().id, 2);
    }
}
