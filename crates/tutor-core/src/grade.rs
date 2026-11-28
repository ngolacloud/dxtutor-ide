//! O contrato entre a IDE e o avaliador que corre no devcontainer do curso (ADR-0008).
//!
//! A avaliação de um passo sai do processo da IDE: a IDE escreve um [`GradeRequest`] no stdin
//! do `dxtutor-grade` (crate `tutor-grade`), que corre dentro do contentor do curso com o curso
//! montado só de leitura, e lê um [`GradeReport`] do stdout. Os dois lados são JSON com um número
//! de protocolo ([`GRADE_PROTOCOL`]): um lado que recebe outro número recusa com
//! [`codes::PROTOCOL`] em vez de adivinhar.
//!
//! O relatório nunca traz a solução do curso: a IDE tem o curso instalado e só a mostra depois de
//! os testes passarem (o contrato de honestidade do Learning Track continua do lado dela).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A versão do protocolo. Muda quando um campo muda de sentido ou um campo obrigatório nasce.
pub const GRADE_PROTOCOL: u32 = 1;

/// Os códigos de [`GradeError::code`]: estáveis, para a IDE decidir o que dizer e o que oferecer.
pub mod codes {
    /// O pedido não é JSON válido ou falta-lhe um campo.
    pub const BAD_REQUEST: &str = "BAD_REQUEST";
    /// O pedido (ou o relatório) traz outro número de protocolo.
    pub const PROTOCOL: &str = "PROTOCOL";
    /// A pasta do curso não é um plugin válido (manifesto, cursos ou ficheiros de apoio).
    pub const COURSE_INVALID: &str = "COURSE_INVALID";
    /// Nenhum curso da pasta tem esse passo (na linguagem pedida, se veio uma).
    pub const STEP_NOT_FOUND: &str = "STEP_NOT_FOUND";
    /// O passo existe mas não é um desafio (não há nada para avaliar).
    pub const NOT_A_CHALLENGE: &str = "NOT_A_CHALLENGE";
    /// Vieram ficheiros para um passo de um só ficheiro.
    pub const NOT_A_PROJECT: &str = "NOT_A_PROJECT";
    /// Este avaliador não sabe avaliar a linguagem do curso.
    pub const LANGUAGE_UNSUPPORTED: &str = "LANGUAGE_UNSUPPORTED";
    /// O curso precisa de dependências que o contentor não tem preparadas.
    pub const COURSE_NOT_PREPARED: &str = "COURSE_NOT_PREPARED";
    /// Um passo ao vivo precisa de um cluster que este contentor não consegue ter.
    pub const LIVE_UNAVAILABLE: &str = "LIVE_UNAVAILABLE";
    /// A avaliação começou e falhou por outra razão (o texto diz qual).
    pub const EVAL: &str = "EVAL";
}

/// O que o aluno entrega.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Submission {
    /// O código de um passo de um só ficheiro (num passo de projecto, o ficheiro principal).
    Code { code: String },
    /// Os ficheiros editáveis de um passo de projecto (caminho relativo → conteúdo).
    Files { files: BTreeMap<String, String> },
}

/// O pedido da IDE ao avaliador.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeRequest {
    pub protocol: u32,
    /// O id do passo (`ch1-greet`).
    pub step: String,
    /// A linguagem do curso: Rust e Go repetem ids de passo, por isso a IDE manda-a.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub submission: Submission,
}

impl GradeRequest {
    /// Um pedido com o protocolo desta versão.
    pub fn new(step: impl Into<String>, language: Option<String>, submission: Submission) -> Self {
        GradeRequest {
            protocol: GRADE_PROTOCOL,
            step: step.into(),
            language,
            submission,
        }
    }

    /// Lê um pedido. Um protocolo diferente é recusado ANTES de olhar para o resto (os campos
    /// podem ter mudado de sentido).
    pub fn parse(raw: &str) -> Result<GradeRequest, GradeError> {
        let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| {
            GradeError::new(codes::BAD_REQUEST, format!("the request is not JSON: {e}"))
        })?;
        check_protocol(&v, "request")?;
        serde_json::from_value(v)
            .map_err(|e| GradeError::new(codes::BAD_REQUEST, format!("invalid request: {e}")))
    }
}

/// O resultado de uma avaliação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// Os testes ocultos passaram.
    Passed,
    /// Os testes correram e falharam (ou não compilou): `correctness` diz porquê.
    Failed,
    /// Não houve avaliação: `error` diz porquê.
    Error,
}

/// O veredicto dos testes (a fonte de verdade).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Correctness {
    pub passed: bool,
    pub summary: String,
    /// A saída dos testes, para mostrar ao aluno o que falhou.
    pub raw: String,
}

/// A complexidade medida (só quando o passo tem sonda e os testes passaram).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Complexity {
    pub big_o: String,
    pub r_squared: f64,
    pub exponent: f64,
    pub confidence: String,
    pub ranking: Vec<(String, f64)>,
}

/// Porque é que não houve avaliação.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GradeError {
    /// Um de [`codes`].
    pub code: String,
    pub message: String,
}

impl GradeError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        GradeError {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for GradeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for GradeError {}

/// O relatório do avaliador.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeReport {
    pub protocol: u32,
    pub step: String,
    /// O id do curso onde o passo foi encontrado.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub course: Option<String>,
    pub outcome: Outcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correctness: Option<Correctness>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub complexity: Option<Complexity>,
    /// A classe esperada (`O(n)`), do gabarito.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<GradeError>,
    /// Quem avaliou (`dxtutor-grade 0.7.0`), para o registo e para os relatórios de erros.
    pub grader: String,
}

impl GradeReport {
    /// Um relatório sem avaliação.
    pub fn failure(step: impl Into<String>, error: GradeError, grader: impl Into<String>) -> Self {
        GradeReport {
            protocol: GRADE_PROTOCOL,
            step: step.into(),
            course: None,
            outcome: Outcome::Error,
            correctness: None,
            complexity: None,
            expected: None,
            error: Some(error),
            grader: grader.into(),
        }
    }

    /// Lê um relatório, com as mesmas regras do pedido. Um relatório incoerente (diz `passed`
    /// mas os testes não passaram, ou `error` sem erro) é recusado: a IDE nunca mostra um
    /// «passou» que o próprio relatório desmente.
    pub fn parse(raw: &str) -> Result<GradeReport, GradeError> {
        let v: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|e| {
            GradeError::new(codes::BAD_REQUEST, format!("the report is not JSON: {e}"))
        })?;
        check_protocol(&v, "report")?;
        let r: GradeReport = serde_json::from_value(v)
            .map_err(|e| GradeError::new(codes::BAD_REQUEST, format!("invalid report: {e}")))?;
        r.check()?;
        Ok(r)
    }

    /// As regras de coerência do relatório.
    pub fn check(&self) -> Result<(), GradeError> {
        let bad = |m: &str| {
            Err(GradeError::new(
                codes::BAD_REQUEST,
                format!("incoherent report: {m}"),
            ))
        };
        match self.outcome {
            Outcome::Passed if !self.correctness.as_ref().is_some_and(|c| c.passed) => {
                bad("`passed` without passing tests")
            }
            Outcome::Failed if self.correctness.as_ref().is_none_or(|c| c.passed) => {
                bad("`failed` without failing tests")
            }
            Outcome::Error if self.error.is_none() => bad("`error` without an error"),
            Outcome::Passed | Outcome::Failed if self.error.is_some() => {
                bad("a graded step with an error")
            }
            _ => Ok(()),
        }
    }
}

fn check_protocol(v: &serde_json::Value, what: &str) -> Result<(), GradeError> {
    match v.get("protocol").and_then(serde_json::Value::as_u64) {
        Some(p) if p == u64::from(GRADE_PROTOCOL) => Ok(()),
        Some(p) => Err(GradeError::new(
            codes::PROTOCOL,
            format!("the {what} speaks protocol {p}; this side speaks {GRADE_PROTOCOL}"),
        )),
        None => Err(GradeError::new(
            codes::BAD_REQUEST,
            format!("the {what} has no `protocol` number"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_round_trips_in_both_submission_shapes() {
        let code = GradeRequest::new(
            "ch1-greet",
            Some("go".into()),
            Submission::Code {
                code: "package main".into(),
            },
        );
        let raw = serde_json::to_string(&code).unwrap();
        assert!(raw.contains(r#""kind":"code""#), "{raw}");
        assert_eq!(GradeRequest::parse(&raw).unwrap(), code);

        let files = GradeRequest::new(
            "p1",
            None,
            Submission::Files {
                files: BTreeMap::from([("src/app.py".into(), "x = 1".into())]),
            },
        );
        let raw = serde_json::to_string(&files).unwrap();
        assert!(
            !raw.contains("language"),
            "an absent language is not sent: {raw}"
        );
        assert_eq!(GradeRequest::parse(&raw).unwrap(), files);
    }

    #[test]
    fn another_protocol_is_refused_before_the_rest_is_read() {
        let e = GradeRequest::parse(r#"{"protocol": 2, "whatever": true}"#).unwrap_err();
        assert_eq!(e.code, codes::PROTOCOL);
        assert!(e.message.contains("protocol 2"), "{e}");
        let e = GradeRequest::parse(r#"{"step": "x"}"#).unwrap_err();
        assert_eq!(e.code, codes::BAD_REQUEST);
        let e = GradeRequest::parse("not json").unwrap_err();
        assert_eq!(e.code, codes::BAD_REQUEST);
        let e = GradeRequest::parse(r#"{"protocol": 1, "step": "x"}"#).unwrap_err();
        assert_eq!(e.code, codes::BAD_REQUEST, "a missing submission");
    }

    fn graded(outcome: Outcome, passed: bool) -> GradeReport {
        GradeReport {
            protocol: GRADE_PROTOCOL,
            step: "s".into(),
            course: Some("c".into()),
            outcome,
            correctness: Some(Correctness {
                passed,
                summary: String::new(),
                raw: String::new(),
            }),
            complexity: None,
            expected: None,
            error: None,
            grader: "dxtutor-grade test".into(),
        }
    }

    #[test]
    fn a_report_never_claims_what_its_tests_deny() {
        let ok = graded(Outcome::Passed, true);
        let raw = serde_json::to_string(&ok).unwrap();
        assert_eq!(GradeReport::parse(&raw).unwrap(), ok);
        assert!(GradeReport::parse(
            &serde_json::to_string(&graded(Outcome::Failed, false)).unwrap()
        )
        .is_ok());

        for liar in [
            graded(Outcome::Passed, false),
            graded(Outcome::Failed, true),
        ] {
            let e = GradeReport::parse(&serde_json::to_string(&liar).unwrap()).unwrap_err();
            assert!(e.message.contains("incoherent"), "{e}");
        }
        let mut no_error = graded(Outcome::Error, false);
        no_error.correctness = None;
        assert!(no_error.check().is_err());
        let mut both = graded(Outcome::Passed, true);
        both.error = Some(GradeError::new(codes::EVAL, "x"));
        assert!(both.check().is_err());

        let failure = GradeReport::failure("s", GradeError::new(codes::STEP_NOT_FOUND, "no"), "g");
        let raw = serde_json::to_string(&failure).unwrap();
        assert!(!raw.contains("correctness"), "{raw}");
        assert_eq!(GradeReport::parse(&raw).unwrap(), failure);
    }

    #[test]
    fn the_report_never_has_a_field_for_the_solution() {
        let raw = serde_json::to_string(&graded(Outcome::Passed, true)).unwrap();
        for word in ["gabarito", "solution"] {
            assert!(!raw.contains(word), "{raw}");
        }
    }
}
