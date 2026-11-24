//! De onde vem um plugin a instalar.
//!
//! Formas aceites (as mesmas na app e em `dxt plugin install`):
//!
//! | Escrito                                   | Origem                                        |
//! |-------------------------------------------|-----------------------------------------------|
//! | `python`                                  | repo oficial `dxtutor-courses/python`         |
//! | `owner/repo` ou `github:owner/repo`       | GitHub, branch por omissão                    |
//! | `owner/repo@v1.2.0`                       | GitHub, tag ou branch                         |
//! | `https://github.com/owner/repo[/tree/ref]`| GitHub                                        |
//! | `https://…/x.zip`                         | um zip qualquer por HTTPS                     |
//! | `./pasta` ou `/caminho/x.zip`             | pasta ou zip locais (autores a testar)        |

use std::path::PathBuf;

/// Organização GitHub dos cursos oficiais.
pub const OFFICIAL_ORG: &str = "dxtutor-courses";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    GitHub {
        owner: String,
        repo: String,
        git_ref: Option<String>,
    },
    ZipUrl(String),
    LocalDir(PathBuf),
    LocalZip(PathBuf),
}

impl Source {
    /// Interpreta o que o utilizador escreveu. Caminhos locais só contam se existirem
    /// (`exists` é injectável para os testes).
    pub fn parse_with(
        input: &str,
        exists: impl Fn(&str) -> Option<bool>,
    ) -> Result<Source, String> {
        let s = input.trim();
        if s.is_empty() {
            return Err("empty plugin source".into());
        }
        // Local: pasta (Some(true)) ou ficheiro (Some(false)).
        if s.starts_with('.') || s.starts_with('/') || s.starts_with('~') || s.contains('\\') {
            let path = expand_home(s);
            return match exists(&path) {
                Some(true) => Ok(Source::LocalDir(PathBuf::from(path))),
                Some(false) if path.to_ascii_lowercase().ends_with(".zip") => {
                    Ok(Source::LocalZip(PathBuf::from(path)))
                }
                Some(false) => Err(format!("{s}: not a folder or a .zip file")),
                None => Err(format!("{s}: no such file or folder")),
            };
        }
        if let Some(rest) = s
            .strip_prefix("https://github.com/")
            .or_else(|| s.strip_prefix("http://github.com/"))
        {
            let parts: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
            if parts.len() < 2 {
                return Err(format!("{s}: expected https://github.com/<owner>/<repo>"));
            }
            let repo = parts[1].trim_end_matches(".git");
            let git_ref = match parts.get(2) {
                Some(&"tree") | Some(&"releases") => parts.get(3..).and_then(|r| {
                    let r: Vec<&str> = r.iter().copied().filter(|p| *p != "tag").collect();
                    (!r.is_empty()).then(|| r.join("/"))
                }),
                _ => None,
            };
            return github(parts[0], repo, git_ref);
        }
        if s.starts_with("https://") {
            if s.to_ascii_lowercase()
                .split('?')
                .next()
                .unwrap_or("")
                .ends_with(".zip")
            {
                return Ok(Source::ZipUrl(s.to_string()));
            }
            return Err(format!(
                "{s}: only GitHub repositories or .zip URLs are supported"
            ));
        }
        if s.starts_with("http://") {
            return Err(format!("{s}: use https"));
        }
        let spec = s.strip_prefix("github:").unwrap_or(s);
        let (path, git_ref) = match spec.split_once('@') {
            Some((p, r)) if !r.is_empty() => (p, Some(r.to_string())),
            Some(_) => return Err(format!("{s}: empty ref after @")),
            None => (spec, None),
        };
        match path.split_once('/') {
            Some((owner, repo)) => github(owner, repo, git_ref),
            None => github(OFFICIAL_ORG, path, git_ref),
        }
    }

    /// [`Source::parse_with`] contra o sistema de ficheiros real.
    pub fn parse(input: &str) -> Result<Source, String> {
        let abs = |p: PathBuf| std::fs::canonicalize(&p).unwrap_or(p);
        Ok(
            match Source::parse_with(input, |p| std::fs::metadata(p).ok().map(|m| m.is_dir()))? {
                // Absoluto, para o registo continuar a apontar para o sítio certo.
                Source::LocalDir(p) => Source::LocalDir(abs(p)),
                Source::LocalZip(p) => Source::LocalZip(abs(p)),
                other => other,
            },
        )
    }

    /// URL do zip a descarregar, quando a origem é remota.
    pub fn download_url(&self) -> Option<String> {
        match self {
            Source::GitHub {
                owner,
                repo,
                git_ref,
            } => Some(format!(
                "https://github.com/{owner}/{repo}/archive/{}.zip",
                git_ref.as_deref().unwrap_or("HEAD")
            )),
            Source::ZipUrl(u) => Some(u.clone()),
            _ => None,
        }
    }

    /// Forma canónica, guardada no registo e usada para reinstalar/actualizar.
    pub fn canonical(&self) -> String {
        match self {
            Source::GitHub {
                owner,
                repo,
                git_ref: Some(r),
            } => format!("github:{owner}/{repo}@{r}"),
            Source::GitHub {
                owner,
                repo,
                git_ref: None,
            } => format!("github:{owner}/{repo}"),
            Source::ZipUrl(u) => u.clone(),
            Source::LocalDir(p) | Source::LocalZip(p) => p.display().to_string(),
        }
    }
}

fn github(owner: &str, repo: &str, git_ref: Option<String>) -> Result<Source, String> {
    let ok = |x: &str| {
        !x.is_empty()
            && x.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    if !ok(owner) || !ok(repo) || repo.contains('/') {
        return Err(format!("`{owner}/{repo}` is not a valid GitHub repository"));
    }
    if let Some(r) = &git_ref {
        if r.contains("..")
            || r.chars()
                .any(|c| c.is_whitespace() || "~^:?*[\\".contains(c))
        {
            return Err(format!("`{r}` is not a valid git ref"));
        }
    }
    Ok(Source::GitHub {
        owner: owner.into(),
        repo: repo.into(),
        git_ref,
    })
}

fn expand_home(s: &str) -> String {
    match (s.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest).display().to_string(),
        _ => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Result<Source, String> {
        Source::parse_with(s, |path| match path {
            "./my-course" => Some(true),
            "/tmp/c.zip" => Some(false),
            _ => None,
        })
    }

    fn gh(o: &str, r: &str, git_ref: Option<&str>) -> Source {
        Source::GitHub {
            owner: o.into(),
            repo: r.into(),
            git_ref: git_ref.map(Into::into),
        }
    }

    #[test]
    fn formas_aceites() {
        assert_eq!(p("python").unwrap(), gh("dxtutor-courses", "python", None));
        assert_eq!(
            p("acme/kotlin@v1.0.0").unwrap(),
            gh("acme", "kotlin", Some("v1.0.0"))
        );
        assert_eq!(p("github:acme/kotlin").unwrap(), gh("acme", "kotlin", None));
        assert_eq!(
            p("https://github.com/acme/swift.git").unwrap(),
            gh("acme", "swift", None)
        );
        assert_eq!(
            p("https://github.com/acme/swift/tree/dev").unwrap(),
            gh("acme", "swift", Some("dev"))
        );
        assert_eq!(
            p("https://github.com/acme/swift/releases/tag/v2").unwrap(),
            gh("acme", "swift", Some("v2"))
        );
        assert_eq!(
            p("https://x.org/c.zip").unwrap(),
            Source::ZipUrl("https://x.org/c.zip".into())
        );
        assert_eq!(
            p("./my-course").unwrap(),
            Source::LocalDir("./my-course".into())
        );
        assert_eq!(
            p("/tmp/c.zip").unwrap(),
            Source::LocalZip("/tmp/c.zip".into())
        );
    }

    #[test]
    fn recusa_o_resto() {
        for bad in [
            "",
            "http://x.org/c.zip",
            "https://x.org/page",
            "a/b/c",
            "acme/k@",
            "acme/k@a..b",
            "./nope",
        ] {
            assert!(p(bad).is_err(), "devia recusar `{bad}`");
        }
    }

    #[test]
    fn url_de_download_e_forma_canonica() {
        let s = gh("dxtutor-courses", "go", Some("v1"));
        assert_eq!(
            s.download_url().unwrap(),
            "https://github.com/dxtutor-courses/go/archive/v1.zip"
        );
        assert_eq!(s.canonical(), "github:dxtutor-courses/go@v1");
        assert_eq!(
            gh("a", "b", None).download_url().unwrap(),
            "https://github.com/a/b/archive/HEAD.zip"
        );
    }
}
