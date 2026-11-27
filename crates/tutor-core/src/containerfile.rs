//! **Containerfiles e Dockerfiles** (Learn P3a): ler as instruções e a GUARDA que corre antes de
//! cada `podman build` da avaliação. PURO (sem I/O).
//!
//! O avaliador constrói o Containerfile do aluno no sandbox de contentores com `--pull=never` e
//! `--network=none`, mas há instruções que iriam à rede por outros caminhos (o `ADD <url>`
//! descarrega no anfitrião, um `FROM`/`COPY --from` de uma imagem que não foi preparada tentaria
//! puxá-la, `RUN --network=host` pediria a rede do anfitrião). [`guard`] recusa-as com uma frase
//! que diz o que fazer, antes de correr seja o que for:
//!
//! - `FROM` só de uma imagem PREPARADA do curso (o nome e a tag, ou o digest), de `scratch` ou de
//!   um estágio anterior; nada de `--platform` nem de variáveis (`FROM $BASE`);
//! - `COPY --from`/`RUN --mount from=` só de um estágio anterior ou de uma imagem preparada;
//! - `ADD` só de ficheiros do contexto (nada de URLs nem de repositórios git);
//! - `RUN --network` só `none`; `RUN --security` e as montagens `ssh`/`secret` não;
//! - heredocs (`RUN <<EOF`) não: o curso escreve os comandos com `&&`.
//!
//! [`parse`] segue a referência do Dockerfile (https://docs.docker.com/reference/dockerfile/): a
//! directiva `# escape=`, linhas continuadas, comentários dentro de uma continuação, instruções
//! sem distinção de maiúsculas, e o primeiro passo (depois de `ARG`) tem de ser `FROM`.

use crate::build::ImageRef;

/// As instruções que existem (https://docs.docker.com/reference/dockerfile/#overview).
pub const INSTRUCTIONS: [&str; 18] = [
    "FROM",
    "RUN",
    "CMD",
    "LABEL",
    "MAINTAINER",
    "EXPOSE",
    "ENV",
    "ADD",
    "COPY",
    "ENTRYPOINT",
    "VOLUME",
    "USER",
    "WORKDIR",
    "ARG",
    "ONBUILD",
    "STOPSIGNAL",
    "HEALTHCHECK",
    "SHELL",
];

/// Uma instrução (uma linha lógica, já com as continuações juntas).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instruction {
    /// A linha (base 1) onde começa.
    pub line: u32,
    /// A palavra-chave em maiúsculas (`FROM`).
    pub keyword: String,
    /// As flags do início (`--from=build`), nas instruções que as têm.
    pub flags: Vec<String>,
    /// O resto, depois das flags (o texto como foi escrito, sem as pontas).
    pub args: String,
}

/// Um erro de leitura, com a linha.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub line: u32,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

/// As instruções cujas flags (`--x`) se separam do resto.
const WITH_FLAGS: [&str; 5] = ["FROM", "RUN", "COPY", "ADD", "HEALTHCHECK"];

/// Lê um Containerfile/Dockerfile. Ver o cabeçalho do módulo.
pub fn parse(text: &str) -> Result<Vec<Instruction>, ParseError> {
    let lines: Vec<&str> = text.lines().collect();
    let mut escape = '\\';
    // As directivas só existem antes de qualquer outra linha (comentário, vazia ou instrução).
    let mut i = 0;
    while i < lines.len() {
        let l = lines[i].trim();
        let Some(body) = l.strip_prefix('#') else {
            break;
        };
        let Some((k, v)) = body.split_once('=') else {
            break;
        };
        let key = k.trim().to_ascii_lowercase();
        if key.is_empty() || key.contains(char::is_whitespace) {
            break;
        }
        if key == "escape" {
            escape = match v.trim() {
                "\\" => '\\',
                "`" => '`',
                other => {
                    return Err(ParseError {
                        line: i as u32 + 1,
                        message: format!(
                            "the escape directive takes `\\` or a backtick, not `{other}`"
                        ),
                    })
                }
            };
        }
        i += 1;
    }

    let mut out: Vec<Instruction> = Vec::new();
    let mut n = 0;
    while n < lines.len() {
        let start = n;
        let first = lines[n].trim();
        n += 1;
        if first.is_empty() || first.starts_with('#') {
            continue;
        }
        let mut logical = String::new();
        let mut cur = first.to_string();
        loop {
            let t = cur.trim_end();
            if let Some(stripped) = t.strip_suffix(escape) {
                logical.push_str(stripped);
                logical.push(' ');
                // A linha seguinte que não seja vazia nem comentário continua esta.
                let mut next = None;
                while n < lines.len() {
                    let l = lines[n];
                    n += 1;
                    let lt = l.trim();
                    if lt.is_empty() || lt.starts_with('#') {
                        continue;
                    }
                    next = Some(l.to_string());
                    break;
                }
                match next {
                    Some(l) => cur = l,
                    None => break,
                }
            } else {
                logical.push_str(t);
                break;
            }
        }
        let logical = logical.trim();
        let line = start as u32 + 1;
        let (kw, rest) = match logical.split_once(char::is_whitespace) {
            Some((k, r)) => (k, r.trim()),
            None => (logical, ""),
        };
        let keyword = kw.to_ascii_uppercase();
        if !INSTRUCTIONS.contains(&keyword.as_str()) {
            return Err(ParseError {
                line,
                message: format!("unknown instruction `{kw}`"),
            });
        }
        if rest.is_empty() {
            return Err(ParseError {
                line,
                message: format!("{keyword} needs arguments"),
            });
        }
        let (flags, args) = if WITH_FLAGS.contains(&keyword.as_str()) {
            split_flags(rest)
        } else {
            (Vec::new(), rest.to_string())
        };
        if args.is_empty() && keyword != "HEALTHCHECK" {
            return Err(ParseError {
                line,
                message: format!("{keyword} needs arguments after its flags"),
            });
        }
        out.push(Instruction {
            line,
            keyword,
            flags,
            args,
        });
    }
    match out.iter().find(|i| i.keyword != "ARG") {
        None => Err(ParseError {
            line: 1,
            message: "there is no FROM instruction".into(),
        }),
        Some(i) if i.keyword != "FROM" => Err(ParseError {
            line: i.line,
            message: format!("the first instruction must be FROM (found {})", i.keyword),
        }),
        Some(_) => Ok(out),
    }
}

fn split_flags(rest: &str) -> (Vec<String>, String) {
    let mut flags = Vec::new();
    let mut r = rest.trim_start();
    while r.starts_with("--") {
        let end = r.find(char::is_whitespace).unwrap_or(r.len());
        flags.push(r[..end].to_string());
        r = r[end..].trim_start();
    }
    (flags, r.to_string())
}

/// As palavras de um argumento em forma de lista JSON (`["a", "b"]`) ou separadas por espaços.
fn words(args: &str) -> Vec<String> {
    let t = args.trim();
    if t.starts_with('[') {
        if let Ok(v) = serde_json::from_str::<Vec<String>>(t) {
            return v;
        }
    }
    t.split_whitespace().map(str::to_string).collect()
}

/// O nome que um `FROM` dá ao estágio (`AS build`), em minúsculas.
fn stage_name(args: &str) -> Option<String> {
    let w: Vec<&str> = args.split_whitespace().collect();
    match w.as_slice() {
        [_, as_kw, name] if as_kw.eq_ignore_ascii_case("as") => Some(name.to_ascii_lowercase()),
        _ => None,
    }
}

fn prepared_list(images: &[ImageRef]) -> String {
    if images.is_empty() {
        return "none (this step has no prepared images)".into();
    }
    images
        .iter()
        .map(|i| format!("`{}`", i.short()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// A guarda de um Containerfile antes de o construir no sandbox. Ver o cabeçalho do módulo.
/// `images` são as imagens preparadas do curso.
pub fn guard(instrs: &[Instruction], images: &[ImageRef]) -> Result<(), String> {
    let mut stages: Vec<Option<String>> = Vec::new();
    for ins in instrs {
        guard_one(ins, images, &mut stages, false)?;
    }
    Ok(())
}

fn refuse(ins: &Instruction, why: String) -> Result<(), String> {
    Err(format!("line {} ({}): {why}", ins.line, ins.keyword))
}

fn source_ok(src: &str, images: &[ImageRef], stages: &[Option<String>]) -> bool {
    let s = src.to_ascii_lowercase();
    stages.iter().flatten().any(|n| *n == s)
        || s.parse::<usize>().is_ok_and(|i| i < stages.len())
        || images.iter().any(|i| i.matches(src))
}

fn guard_one(
    ins: &Instruction,
    images: &[ImageRef],
    stages: &mut Vec<Option<String>>,
    in_onbuild: bool,
) -> Result<(), String> {
    match ins.keyword.as_str() {
        "FROM" => {
            if in_onbuild {
                return refuse(ins, "ONBUILD cannot run FROM".into());
            }
            if let Some(f) = ins.flags.first() {
                return refuse(
                    ins,
                    format!(
                        "`{f}` is not graded here: the sandbox builds for this machine from the prepared images"
                    ),
                );
            }
            let image = ins.args.split_whitespace().next().unwrap_or("");
            let w = ins.args.split_whitespace().count();
            if w != 1 && stage_name(&ins.args).is_none() {
                return refuse(
                    ins,
                    "write `FROM <image>` or `FROM <image> AS <name>`".into(),
                );
            }
            if image.contains('$') {
                return refuse(
                    ins,
                    format!(
                        "`{image}` uses a build variable; write the image literally (one of {})",
                        prepared_list(images)
                    ),
                );
            }
            let known = image.eq_ignore_ascii_case("scratch")
                || stages
                    .iter()
                    .flatten()
                    .any(|n| n.eq_ignore_ascii_case(image))
                || images.iter().any(|i| i.matches(image));
            if !known {
                return refuse(
                    ins,
                    format!(
                        "`{image}` is not one of the images this course prepared, so it cannot be built offline. Use {} (or `scratch`, or an earlier stage)",
                        prepared_list(images)
                    ),
                );
            }
            stages.push(stage_name(&ins.args));
        }
        "COPY" | "ADD" => {
            for f in &ins.flags {
                let (name, value) = f.split_once('=').unwrap_or((f.as_str(), ""));
                match name {
                    "--from" => {
                        if !source_ok(value, images, stages) {
                            return refuse(
                                ins,
                                format!(
                                    "`--from={value}` names no earlier stage and no prepared image ({})",
                                    prepared_list(images)
                                ),
                            );
                        }
                    }
                    "--chown" | "--chmod" | "--link" => {}
                    other => {
                        return refuse(ins, format!("the flag `{other}` is not graded here"));
                    }
                }
            }
            if ins.args.contains("<<") {
                return refuse(
                    ins,
                    "heredocs are not graded here: put the content in a file of the step".into(),
                );
            }
            if ins.keyword == "ADD" {
                let w = words(&ins.args);
                let sources = &w[..w.len().saturating_sub(1)];
                if let Some(s) = sources.iter().find(|s| {
                    let l = s.to_ascii_lowercase();
                    l.contains("://") || l.starts_with("git@")
                }) {
                    return refuse(
                        ins,
                        format!(
                            "`ADD {s}` downloads from the network, which grading never does: put the file in the build context and COPY it"
                        ),
                    );
                }
            }
        }
        "RUN" => {
            if ins.args.contains("<<") {
                return refuse(
                    ins,
                    "heredocs (`<<EOF`) are not graded here: chain the commands with `&&`".into(),
                );
            }
            for f in &ins.flags {
                let (name, value) = f.split_once('=').unwrap_or((f.as_str(), ""));
                match name {
                    "--network" if value == "none" => {}
                    "--network" => {
                        return refuse(
                            ins,
                            format!("`{f}`: RUN steps have no network while grading (only `--network=none`)"),
                        )
                    }
                    "--mount" => {
                        let mut kind = "bind";
                        let mut from = None;
                        for kv in value.split(',') {
                            match kv.split_once('=') {
                                Some(("type", t)) => kind = t,
                                Some(("from", x)) => from = Some(x),
                                _ => {}
                            }
                        }
                        if !matches!(kind, "bind" | "cache" | "tmpfs") {
                            return refuse(
                                ins,
                                format!("a `type={kind}` mount is not graded here (only bind, cache and tmpfs)"),
                            );
                        }
                        if let Some(x) = from {
                            if !source_ok(x, images, stages) {
                                return refuse(
                                    ins,
                                    format!("the mount's `from={x}` names no earlier stage and no prepared image"),
                                );
                            }
                        }
                    }
                    other => {
                        return refuse(ins, format!("the flag `{other}` is not graded here"));
                    }
                }
            }
        }
        "ONBUILD" => {
            if in_onbuild {
                return refuse(ins, "ONBUILD cannot be nested".into());
            }
            let (kw, rest) = ins
                .args
                .split_once(char::is_whitespace)
                .unwrap_or((&ins.args, ""));
            let keyword = kw.to_ascii_uppercase();
            if !INSTRUCTIONS.contains(&keyword.as_str()) {
                return refuse(ins, format!("unknown instruction `{kw}` after ONBUILD"));
            }
            let (flags, args) = if WITH_FLAGS.contains(&keyword.as_str()) {
                split_flags(rest)
            } else {
                (Vec::new(), rest.trim().to_string())
            };
            let inner = Instruction {
                line: ins.line,
                keyword,
                flags,
                args,
            };
            guard_one(&inner, images, stages, true)?;
        }
        _ => {}
    }
    Ok(())
}

/// O que um drill de Containerfile «corre»: lê-o e diz que instruções e estágios tem (sem
/// construir nada).
pub fn describe(instrs: &[Instruction]) -> String {
    let stages = instrs.iter().filter(|i| i.keyword == "FROM").count();
    let mut out = format!(
        "valid Containerfile: {} instruction(s), {} stage(s)\n",
        instrs.len(),
        stages
    );
    for i in instrs {
        let mut shown = i.flags.clone();
        shown.push(i.args.clone());
        let text = shown.join(" ");
        let text = if text.chars().count() > 70 {
            format!("{}…", text.chars().take(69).collect::<String>())
        } else {
            text
        };
        out.push_str(&format!("  {:>3}  {:<11} {text}\n", i.line, i.keyword));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn images() -> Vec<ImageRef> {
        vec![
            crate::build::image_reference(
                "docker.io/library/alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf",
            )
            .unwrap(),
            crate::build::image_reference(
                "docker.io/library/golang:1.27.4-alpine3.24@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280",
            )
            .unwrap(),
        ]
    }

    #[test]
    fn instructions_parse_with_continuations_comments_and_flags() {
        let text = "# syntax=docker/dockerfile:1\nARG V=1\nfrom golang:1.27.4-alpine3.24 AS build\nRUN --mount=type=cache,target=/root/.cache \\\n    # a comment inside\n    go build -o /out/app . \\\n && echo done\n\nFROM scratch\nCOPY --from=build /out/app /app\nENTRYPOINT [\"/app\"]\n";
        let p = parse(text).unwrap();
        let kws: Vec<&str> = p.iter().map(|i| i.keyword.as_str()).collect();
        assert_eq!(kws, ["ARG", "FROM", "RUN", "FROM", "COPY", "ENTRYPOINT"]);
        assert_eq!(p[2].line, 4);
        assert_eq!(p[2].flags, ["--mount=type=cache,target=/root/.cache"]);
        assert_eq!(p[2].args, "go build -o /out/app .   && echo done");
        assert_eq!(p[4].flags, ["--from=build"]);
        assert!(guard(&p, &images()).is_ok());
        assert!(describe(&p).contains("6 instruction(s), 2 stage(s)"));
    }

    #[test]
    fn the_escape_directive_and_errors_have_lines() {
        let p = parse("# escape=`\nFROM alpine:3.24.4\nRUN echo a `\n  && echo b\n").unwrap();
        assert_eq!(p[1].args, "echo a    && echo b");
        let e = parse("FROM alpine:3.24.4\nRUNN echo\n").unwrap_err();
        assert_eq!(
            (e.line, e.message.contains("unknown instruction")),
            (2, true)
        );
        let e = parse("RUN echo\n").unwrap_err();
        assert!(e.message.contains("must be FROM"), "{e}");
        assert!(parse("# just a comment\n").is_err());
        assert!(parse("FROM\n").is_err());
    }

    #[test]
    fn the_guard_refuses_what_would_reach_the_network() {
        let g = |t: &str| guard(&parse(t).unwrap(), &images());
        assert!(g("FROM alpine:3.24.4\nRUN echo ok\n").is_ok());
        assert!(g("FROM docker.io/library/alpine:3.24.4\n").is_ok());
        assert!(g("FROM scratch\nCOPY app /app\n").is_ok());
        assert!(g("FROM alpine:3.24.4 AS base\nFROM base\nCOPY --from=0 /a /a\n").is_ok());
        for (bad, frag) in [
            ("FROM alpine:3.20\n", "not one of the images"),
            ("FROM alpine\n", "not one of the images"),
            ("FROM ubuntu:24.04\n", "`alpine:3.24.4`"),
            ("ARG B=alpine:3.24.4\nFROM $B\n", "build variable"),
            ("FROM --platform=linux/arm64 alpine:3.24.4\n", "--platform"),
            (
                "FROM alpine:3.24.4\nADD https://example.com/x.tgz /x\n",
                "network",
            ),
            (
                "FROM alpine:3.24.4\nADD git@github.com:a/b.git /src\n",
                "network",
            ),
            (
                "FROM alpine:3.24.4\nCOPY --from=nginx:1.27 /a /a\n",
                "no earlier stage",
            ),
            (
                "FROM alpine:3.24.4\nRUN --network=host wget x\n",
                "no network",
            ),
            (
                "FROM alpine:3.24.4\nRUN --mount=type=ssh git clone x\n",
                "type=ssh",
            ),
            (
                "FROM alpine:3.24.4\nRUN --security=insecure x\n",
                "--security",
            ),
            ("FROM alpine:3.24.4\nRUN <<EOF\n", "heredocs"),
            ("FROM alpine:3.24.4\nONBUILD ADD http://x/y /y\n", "network"),
        ] {
            let e = g(bad).unwrap_err();
            assert!(e.contains(frag), "{bad}: {e}");
        }
    }
}
