//! `dxtutor-grade` — o avaliador que corre no devcontainer do curso (ADR-0008).
//!
//! ```text
//! dxtutor-grade [--course-dir DIR] < request.json > report.json
//! dxtutor-grade --protocol      # o número do protocolo (GRADE_PROTOCOL)
//! dxtutor-grade --version
//! ```
//!
//! Lê um `GradeRequest` (JSON) no stdin e escreve um `GradeReport` (JSON, uma linha) no stdout.
//! Saída 0: o passo foi avaliado (passou ou falhou: o relatório diz qual). Saída 3: houve um
//! relatório de erro. Saída 2: os argumentos estão errados (sem relatório). O que os testes do
//! aluno escrevem vai para dentro do relatório, nunca para o stdout solto.

use std::io::Read;
use std::path::PathBuf;

use tutor_core::grade::{Outcome, GRADE_PROTOCOL};
use tutor_grade::{grade_dir, DEFAULT_COURSE_DIR, GRADER};

const USAGE: &str = "usage: dxtutor-grade [--course-dir DIR] < request.json\n       dxtutor-grade --protocol | --version";

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let mut dir = PathBuf::from(DEFAULT_COURSE_DIR);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--protocol" => {
                println!("{GRADE_PROTOCOL}");
                return 0;
            }
            "--version" => {
                println!("{GRADER}");
                return 0;
            }
            "--course-dir" => match args.next() {
                Some(d) => dir = PathBuf::from(d),
                None => {
                    eprintln!("--course-dir needs a folder\n{USAGE}");
                    return 2;
                }
            },
            "-h" | "--help" => {
                println!("{USAGE}");
                return 0;
            }
            other => {
                eprintln!("unknown argument `{other}`\n{USAGE}");
                return 2;
            }
        }
    }
    let mut raw = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut raw) {
        eprintln!("cannot read the request from stdin: {e}");
        return 2;
    }
    let report = grade_dir(&dir, &raw);
    match serde_json::to_string(&report) {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("cannot write the report: {e}");
            return 3;
        }
    }
    match report.outcome {
        Outcome::Passed | Outcome::Failed => 0,
        Outcome::Error => 3,
    }
}
