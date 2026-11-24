//! Under the hood, for real (A8, docs/v2/UI-AUDIT.md item 7, VIZ-02/03/05).
//!
//! - [`line_asm`]: the machine code each source line becomes — the program is built with debug
//!   info (`rustc -C debuginfo=2`, debug or release), disassembled with `objdump -d -l`, and the
//!   instructions are grouped under the `main.rs` line they came from.
//! - [`python_bytecode`]: the bytecode CPython compiles each line to (`dis`), per function.
//! - [`measure_growth`]: the program built once and run with a growing N (its first argument);
//!   the wall time of each run and the complexity class those times fit
//!   ([`crate::complexity::estimate`]).
//!
//! Nothing is simulated: without `rustc`, `objdump` or `python3` the function says what is missing.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The instructions one source line became (in one or more functions).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineCode {
    pub line: u32,
    /// the functions the instructions belong to (demangled)
    pub funcs: Vec<String>,
    pub instructions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LineAsm {
    pub ok: bool,
    /// "debug" or "release"
    pub profile: String,
    pub lines: Vec<LineCode>,
    /// instructions in the user's functions
    pub total: usize,
    /// the compiler's errors, or what is missing
    pub notes: String,
}

fn tool(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

/// Parses `objdump -d -l -C --no-show-raw-insn` output: instructions after a `…/main.rs:N` marker
/// belong to line N, until another file/line marker.
pub fn parse_objdump_lines(text: &str, source_name: &str) -> Vec<LineCode> {
    let mut by: std::collections::BTreeMap<u32, LineCode> = std::collections::BTreeMap::new();
    let mut func = String::new();
    let mut cur: Option<u32> = None;
    for raw in text.lines() {
        let l = raw.trim_end();
        if l.is_empty() {
            continue;
        }
        // function header: `0000000000401136 <main::add>:`
        if let Some(h) = l.strip_suffix(">:") {
            if let Some(i) = h.find(" <") {
                func = h[i + 2..].to_string();
                cur = None;
                continue;
            }
        }
        // line marker: `/tmp/x/main.rs:12` (optionally ` (discriminator 1)`)
        if !l.starts_with(' ') && !l.starts_with('\t') && l.contains(':') {
            let marker = l.split(" (").next().unwrap_or(l);
            if let Some((file, n)) = marker.rsplit_once(':') {
                if let Ok(n) = n.trim().parse::<u32>() {
                    cur = if file.ends_with(source_name) {
                        Some(n)
                    } else {
                        None
                    };
                    continue;
                }
            }
            // `main::add():` — the function-with-source line objdump -l prints
            if l.ends_with("():") || l.ends_with(':') {
                continue;
            }
        }
        // instruction: `  401136:\tpush   %rbp`
        if let (Some(n), Some((_, ins))) = (cur, l.split_once(":\t")) {
            let ins = ins.split_whitespace().collect::<Vec<_>>().join(" ");
            if ins.is_empty() {
                continue;
            }
            let e = by.entry(n).or_insert_with(|| LineCode {
                line: n,
                funcs: vec![],
                instructions: vec![],
            });
            if !func.is_empty() && !e.funcs.contains(&func) {
                e.funcs.push(func.clone());
            }
            e.instructions.push(ins);
        }
    }
    by.into_values().collect()
}

/// The machine code of each line of a complete Rust program (`fn main`).
pub fn line_asm(code: &str, release: bool) -> LineAsm {
    let profile = if release { "release" } else { "debug" }.to_string();
    if !tool("rustc") {
        return LineAsm {
            profile,
            notes: "rustc is not installed.".into(),
            ..Default::default()
        };
    }
    if !tool("objdump") {
        return LineAsm {
            profile,
            notes: "objdump is not installed (binutils): it is what reads the machine code.".into(),
            ..Default::default()
        };
    }
    let dir = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => {
            return LineAsm {
                profile,
                notes: e.to_string(),
                ..Default::default()
            }
        }
    };
    let src = dir.path().join("main.rs");
    if let Err(e) = std::fs::write(&src, code) {
        return LineAsm {
            profile,
            notes: e.to_string(),
            ..Default::default()
        };
    }
    let bin = dir.path().join("hood-bin");
    let mut args = vec!["--edition", "2021", "-C", "debuginfo=2", "-o"];
    let bin_s = bin.display().to_string();
    args.push(&bin_s);
    if release {
        args.extend(["-C", "opt-level=3"]);
    }
    let src_s = src.display().to_string();
    args.push(&src_s);
    let build = Command::new("rustc")
        .args(&args)
        .current_dir(dir.path())
        .output();
    let build = match build {
        Ok(o) => o,
        Err(e) => {
            return LineAsm {
                profile,
                notes: format!("rustc: {e}"),
                ..Default::default()
            }
        }
    };
    if !build.status.success() {
        return LineAsm {
            profile,
            notes: String::from_utf8_lossy(&build.stderr)
                .trim()
                .chars()
                .take(6000)
                .collect(),
            ..Default::default()
        };
    }
    let dump = Command::new("objdump")
        .args(["-d", "-l", "-C", "--no-show-raw-insn", &bin_s])
        .output();
    let text = match dump {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        Ok(o) => {
            return LineAsm {
                profile,
                notes: String::from_utf8_lossy(&o.stderr).trim().to_string(),
                ..Default::default()
            }
        }
        Err(e) => {
            return LineAsm {
                profile,
                notes: format!("objdump: {e}"),
                ..Default::default()
            }
        }
    };
    let lines = parse_objdump_lines(&text, "/main.rs");
    let total = lines.iter().map(|l| l.instructions.len()).sum();
    let notes = if lines.is_empty() {
        "No line of this file produced machine code (everything was inlined away or the program has no user code).".into()
    } else {
        String::new()
    };
    LineAsm {
        ok: true,
        profile,
        lines,
        total,
        notes,
    }
}

// ───── Python bytecode ─────

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineOps {
    pub line: u32,
    /// the code object (module, function) the ops belong to
    pub scope: String,
    pub ops: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bytecode {
    pub ok: bool,
    pub version: String,
    pub lines: Vec<LineOps>,
    pub notes: String,
}

const DIS_SCRIPT: &str = r#"
import dis, json, sys, types
src = sys.stdin.read()
try:
    co = compile(src, "main.py", "exec")
except SyntaxError as e:
    print(json.dumps({"error": f"SyntaxError: {e.msg} (line {e.lineno})"})); sys.exit(0)
out = {}
def walk(c, scope):
    cur = None
    for ins in dis.get_instructions(c):
        n = getattr(ins, "line_number", None)  # 3.13+
        if n is None:
            pos = getattr(ins, "positions", None)  # 3.11+
            if pos is not None and pos.lineno:
                n = pos.lineno
        if n is None:
            # 3.8-3.10: only the first instruction of a line carries it (`starts_line`)
            sl = ins.starts_line
            if isinstance(sl, int) and not isinstance(sl, bool) and sl:
                cur = sl
            n = cur
        if not n:
            continue
        key = (scope, n)
        out.setdefault(key, []).append((ins.opname + " " + ins.argrepr).strip())
    for k in c.co_consts:
        if isinstance(k, types.CodeType):
            walk(k, k.co_qualname if hasattr(k, "co_qualname") else k.co_name)
walk(co, "<module>")
lines = [{"line": n, "scope": s, "ops": ops} for (s, n), ops in sorted(out.items(), key=lambda kv: (kv[0][1], kv[0][0]))]
print(json.dumps({"version": sys.version.split()[0], "lines": lines}))
"#;

/// The bytecode of each line of a Python file (`dis`), per code object.
pub fn python_bytecode(code: &str) -> Bytecode {
    let child = Command::new("python3")
        .args(["-I", "-c", DIS_SCRIPT])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(_) => {
            return Bytecode {
                notes: "python3 is not installed.".into(),
                ..Default::default()
            }
        }
    };
    if let Some(mut i) = child.stdin.take() {
        let _ = i.write_all(code.as_bytes());
    }
    let out = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => {
            return Bytecode {
                notes: e.to_string(),
                ..Default::default()
            }
        }
    };
    let v: serde_json::Value = match serde_json::from_slice(&out.stdout) {
        Ok(v) => v,
        Err(_) => {
            return Bytecode {
                notes: String::from_utf8_lossy(&out.stderr).trim().to_string(),
                ..Default::default()
            }
        }
    };
    if let Some(e) = v["error"].as_str() {
        return Bytecode {
            notes: e.to_string(),
            ..Default::default()
        };
    }
    let lines: Vec<LineOps> = serde_json::from_value(v["lines"].clone()).unwrap_or_default();
    Bytecode {
        ok: true,
        version: v["version"].as_str().unwrap_or("").to_string(),
        lines,
        notes: String::new(),
    }
}

// ───── growth ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthSample {
    pub n: u64,
    pub ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Growth {
    pub ok: bool,
    pub samples: Vec<GrowthSample>,
    /// e.g. "O(n log n)"
    pub big_o: Option<String>,
    /// R² of the fit in log space, 0–1
    pub r_squared: Option<f64>,
    /// "low" | "medium" | "high"
    pub confidence: Option<String>,
    /// the next best fits, (class, R²)
    pub ranking: Vec<(String, f64)>,
    /// the time of starting the program at all (n = 1), taken off every sample before the fit
    pub baseline_ms: f64,
    pub notes: String,
}

/// Wall-clock cap for one run of the growth series.
const RUN_CAP: Duration = Duration::from_secs(10);

fn run_once(bin: &Path, n: u64) -> Result<f64, String> {
    let t0 = Instant::now();
    let mut child = Command::new(bin)
        .arg(n.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            if !st.success() {
                let mut err = String::new();
                if let Some(mut e) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut e, &mut err);
                }
                return Err(format!(
                    "the program failed with n = {n}: {}",
                    err.trim().lines().last().unwrap_or("exit code ≠ 0")
                ));
            }
            return Ok(ms);
        }
        if t0.elapsed() > RUN_CAP {
            let _ = child.kill();
            return Err(format!("n = {n} took more than {} s", RUN_CAP.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// Builds the program once (`-O`) and runs it with each `n` as its first argument, timing each
/// run (best of 3), then fits the times to a complexity class.
pub fn measure_growth(code: &str, sizes: &[u64]) -> Growth {
    if !tool("rustc") {
        return Growth {
            notes: "rustc is not installed.".into(),
            ..Default::default()
        };
    }
    let mut sizes: Vec<u64> = sizes.iter().copied().filter(|n| *n > 0).collect();
    sizes.sort_unstable();
    sizes.dedup();
    if sizes.len() < 4 {
        return Growth {
            notes: "Give at least four different sizes.".into(),
            ..Default::default()
        };
    }
    let dir = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => {
            return Growth {
                notes: e.to_string(),
                ..Default::default()
            }
        }
    };
    let src = dir.path().join("main.rs");
    let bin = dir.path().join("growth-bin");
    if let Err(e) = std::fs::write(&src, code) {
        return Growth {
            notes: e.to_string(),
            ..Default::default()
        };
    }
    let build = Command::new("rustc")
        .args(["--edition", "2021", "-O", "-o"])
        .arg(&bin)
        .arg(&src)
        .output();
    match build {
        Ok(o) if o.status.success() => {}
        Ok(o) => {
            return Growth {
                notes: String::from_utf8_lossy(&o.stderr)
                    .trim()
                    .chars()
                    .take(6000)
                    .collect(),
                ..Default::default()
            }
        }
        Err(e) => {
            return Growth {
                notes: format!("rustc: {e}"),
                ..Default::default()
            }
        }
    }
    // starting a process costs a few ms whatever n is: measured once and taken off each run, or the
    // small sizes would look flat and a quadratic loop would fit n log n
    let mut baseline = f64::INFINITY;
    for _ in 0..3 {
        match run_once(&bin, 1) {
            Ok(ms) => baseline = baseline.min(ms),
            Err(e) => {
                return Growth {
                    notes: e,
                    ..Default::default()
                }
            }
        }
    }
    let mut samples = vec![];
    for &n in &sizes {
        let mut best = f64::INFINITY;
        for _ in 0..3 {
            match run_once(&bin, n) {
                Ok(ms) => best = best.min(ms),
                Err(e) => {
                    let notes = if samples.is_empty() {
                        e
                    } else {
                        format!("{e} — stopped there; the fit uses the sizes before it.")
                    };
                    return finish(samples, notes, baseline);
                }
            }
        }
        samples.push(GrowthSample {
            n,
            ms: (best - baseline).max(0.001),
        });
    }
    finish(samples, String::new(), baseline)
}

/// Below this (after taking off the start-up time) a run is start-up noise, not the work: such
/// sizes stay in the samples but out of the fit. Measured on the CI runner: n = 2000 of a
/// quadratic loop came out at 0.001 ms, and that one point turned O(n²) into O(n³).
const MIN_FIT_MS: f64 = 1.0;

fn finish(samples: Vec<GrowthSample>, notes: String, baseline_ms: f64) -> Growth {
    let (fit, tiny): (Vec<&GrowthSample>, Vec<&GrowthSample>) =
        samples.iter().partition(|s| s.ms >= MIN_FIT_MS);
    let pts: Vec<crate::complexity::Sample> = fit
        .iter()
        .map(|s| crate::complexity::Sample {
            n: s.n as f64,
            t: s.ms * 1_000_000.0,
        })
        .collect();
    let est = if pts.len() >= 4 {
        crate::complexity::estimate(&pts)
    } else {
        None
    };
    let ok = est.is_some();
    let left_out = if tiny.is_empty() {
        String::new()
    } else {
        let ns: Vec<String> = tiny.iter().map(|s| format!("n = {}", s.n)).collect();
        format!(
            "{} ran in under {MIN_FIT_MS} ms after start-up — too fast to time, left out of the fit.",
            ns.join(", ")
        )
    };
    let notes = match (ok, notes.is_empty(), left_out.is_empty()) {
        (false, true, true) => "Too few runs to fit a class.".into(),
        (false, true, false) => format!("{left_out} Give larger sizes."),
        (_, _, true) => notes,
        (_, true, false) => left_out,
        (_, false, false) => format!("{notes} {left_out}"),
    };
    Growth {
        ok,
        big_o: est.as_ref().map(|e| e.big_o().to_string()),
        r_squared: est.as_ref().map(|e| e.r_squared),
        confidence: est
            .as_ref()
            .map(|e| format!("{:?}", e.confidence).to_lowercase()),
        ranking: est
            .as_ref()
            .map(|e| {
                e.ranking
                    .iter()
                    .take(3)
                    .map(|(c, r)| (c.big_o().to_string(), *r))
                    .collect()
            })
            .unwrap_or_default(),
        samples,
        baseline_ms,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_objdump_line_blocks() {
        let dump = "0000000000001130 <main::add>:\nmain::add():\n/tmp/a/main.rs:2\n    1130:\tlea    (%rdi,%rsi,1),%eax\n    1133:\tret\n\n0000000000001140 <std::rt::lang_start>:\n/rustc/x/library/std/src/rt.rs:150\n    1140:\tpush   %rax\n0000000000001150 <main::main>:\n/tmp/a/main.rs:5 (discriminator 2)\n    1150:\tcall   1130 <main::add>\n";
        let l = parse_objdump_lines(dump, "/main.rs");
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].line, 2);
        assert_eq!(l[0].instructions, vec!["lea (%rdi,%rsi,1),%eax", "ret"]);
        assert_eq!(l[0].funcs, vec!["main::add"]);
        assert_eq!(l[1].line, 5);
        assert_eq!(l[1].instructions, vec!["call 1130 <main::add>"]);
    }

    #[test]
    fn real_line_asm_debug_and_release() {
        if !tool("rustc") || !tool("objdump") {
            eprintln!("skipped: no rustc/objdump");
            return;
        }
        let code = "fn add(a: u64, b: u64) -> u64 {\n    a ^ b\n}\nfn main() {\n    let n: u64 = std::env::args().count() as u64;\n    println!(\"{}\", add(n, 40));\n}\n";
        let d = line_asm(code, false);
        assert!(d.ok, "{}", d.notes);
        let l2 = d
            .lines
            .iter()
            .find(|l| l.line == 2)
            .expect("line 2 has code in a debug build");
        assert!(l2.funcs.iter().any(|f| f.contains("add")), "{:?}", l2.funcs);
        let r = line_asm(code, true);
        assert!(r.ok, "{}", r.notes);
        assert!(
            r.total < d.total,
            "release {} vs debug {}",
            r.total,
            d.total
        );
        let bad = line_asm("fn main() { let x: u32 = \"no\"; }", false);
        assert!(
            !bad.ok && bad.notes.contains("mismatched types"),
            "{}",
            bad.notes
        );
    }

    #[test]
    fn real_python_bytecode() {
        if !tool("python3") {
            eprintln!("skipped: no python3");
            return;
        }
        let b = python_bytecode("def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n");
        assert!(b.ok, "{}", b.notes);
        let l2 = b
            .lines
            .iter()
            .find(|l| l.line == 2 && l.scope == "add")
            .expect("line 2 in add");
        assert!(
            l2.ops
                .iter()
                .any(|o| o.starts_with("BINARY_OP") || o.starts_with("BINARY_ADD")),
            "{:?}",
            l2.ops
        );
        assert!(b.lines.iter().any(|l| l.line == 4 && l.scope == "<module>"));
        let bad = python_bytecode("def x(:\n");
        assert!(!bad.ok && bad.notes.contains("SyntaxError"));
    }

    #[test]
    fn growth_leaves_runs_faster_than_start_up_out_of_the_fit() {
        // the CI runner's numbers: n = 2000 at 0.001 ms (start-up noise) made a quadratic loop fit O(n³)
        let s = |n: u64, ms: f64| GrowthSample { n, ms };
        let g = finish(
            vec![
                s(2000, 0.001),
                s(4000, 4.106),
                s(8000, 18.518),
                s(12000, 45.266),
                s(16000, 78.315),
            ],
            String::new(),
            2.13,
        );
        assert!(g.ok, "{}", g.notes);
        assert_eq!(g.big_o.as_deref(), Some("O(n²)"), "{g:?}");
        assert_eq!(g.samples.len(), 5, "the fast size stays in the samples");
        assert!(
            g.notes.contains("n = 2000") && g.notes.contains("left out"),
            "{}",
            g.notes
        );
        // too few left to fit
        let few = finish(
            vec![s(1, 0.001), s(2, 0.002), s(3, 2.0), s(4, 4.0), s(5, 6.0)],
            String::new(),
            1.0,
        );
        assert!(!few.ok);
        assert!(few.notes.contains("Give larger sizes"), "{}", few.notes);
    }

    #[test]
    fn real_growth_fits_quadratic() {
        if !tool("rustc") {
            eprintln!("skipped: no rustc");
            return;
        }
        let code = "fn main() {\n    let n: u64 = std::env::args().nth(1).unwrap().parse().unwrap();\n    let mut s = 0u64;\n    for i in 0..n { for j in 0..n { s = s.wrapping_add(std::hint::black_box(i ^ j)); } }\n    println!(\"{s}\");\n}\n";
        let g = measure_growth(code, &[2000, 4000, 8000, 12000, 16000]);
        assert!(g.ok, "{}", g.notes);
        assert_eq!(g.samples.len(), 5);
        assert_eq!(g.big_o.as_deref(), Some("O(n²)"), "{g:?}");
        let few = measure_growth(code, &[1, 2, 3]);
        assert!(!few.ok);
        let bad = measure_growth("fn main() { if std::env::args().nth(1).as_deref() != Some(\"1\") { std::process::exit(3) } }", &[2, 3, 4, 5]);
        assert!(!bad.ok && bad.notes.contains("failed"), "{}", bad.notes);
    }
}
