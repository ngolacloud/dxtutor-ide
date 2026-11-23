//! Caso de uso «ditado local» — **independente de Tauri**: microfone → texto com
//! [whisper.cpp](https://github.com/ggml-org/whisper.cpp), sem sair da máquina.
//!
//! O motor web do desktop em Linux (WebKitGTK) não tem reconhecimento de voz, por isso a
//! gravação e a transcrição vivem aqui: um gravador do sistema (`pw-record`, `parecord`,
//! `arecord` ou `ffmpeg`) escreve um WAV de 16 kHz mono num ficheiro temporário; ao parar,
//! o `whisper-cli` transcreve-o com um modelo `ggml-*.bin` local.
//!
//! Onde se procura (por esta ordem):
//! - binário: `DXTUTOR_WHISPER_BIN`, `~/.local/share/dxtutor/whisper/whisper.cpp/build/bin/whisper-cli`
//!   (o que o `scripts/setup-whisper.sh` constrói), e no `PATH` `whisper-cli`/`whisper-cpp`;
//! - modelo: `DXTUTOR_WHISPER_MODEL`, ou o melhor `ggml-*.bin` em `~/.local/share/dxtutor/whisper/`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Os gravadores suportados, por ordem de preferência.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Recorder {
    PwRecord,
    Parecord,
    Arecord,
    Ffmpeg,
}

impl Recorder {
    pub const ALL: [Recorder; 4] = [
        Recorder::PwRecord,
        Recorder::Parecord,
        Recorder::Arecord,
        Recorder::Ffmpeg,
    ];

    pub fn program(self) -> &'static str {
        match self {
            Recorder::PwRecord => "pw-record",
            Recorder::Parecord => "parecord",
            Recorder::Arecord => "arecord",
            Recorder::Ffmpeg => "ffmpeg",
        }
    }

    /// O comando que grava WAV 16 kHz mono 16 bits em `out` até receber SIGINT.
    pub fn command(self, out: &Path) -> Command {
        let mut c = Command::new(self.program());
        match self {
            Recorder::PwRecord => {
                c.args(["--rate", "16000", "--channels", "1", "--format", "s16"])
                    .arg(out);
            }
            Recorder::Parecord => {
                c.args([
                    "--rate=16000",
                    "--channels=1",
                    "--format=s16le",
                    "--file-format=wav",
                ])
                .arg(out);
            }
            Recorder::Arecord => {
                c.args(["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav"])
                    .arg(out);
            }
            Recorder::Ffmpeg => {
                let input: &[&str] = if cfg!(target_os = "macos") {
                    &["-f", "avfoundation", "-i", ":0"]
                } else {
                    &["-f", "pulse", "-i", "default"]
                };
                c.args(["-hide_banner", "-loglevel", "error", "-y"])
                    .args(input)
                    .args(["-ar", "16000", "-ac", "1", "-sample_fmt", "s16"])
                    .arg(out);
            }
        }
        c
    }
}

/// O que foi encontrado nesta máquina.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Setup {
    pub binary: Option<PathBuf>,
    pub model: Option<PathBuf>,
    pub recorder: Option<Recorder>,
}

/// O estado para a UI.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Status {
    pub ready: bool,
    pub binary: Option<String>,
    pub model: Option<String>,
    pub recorder: Option<Recorder>,
    /// O que falta, em texto para a UI (vazio quando `ready`).
    pub missing: Vec<String>,
    pub recording: bool,
}

/// `~/.local/share/dxtutor/whisper` — onde o script de instalação deixa o binário e os modelos.
pub fn data_dir(home: &Path) -> PathBuf {
    home.join(".local/share/dxtutor/whisper")
}

fn on_path(name: &str, path_var: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    std::env::split_paths(path_var?)
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

pub fn find_binary(
    env_bin: Option<&str>,
    data: &Path,
    path_var: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    if let Some(p) = env_bin
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
    {
        return p.is_file().then_some(p);
    }
    let built = data.join("whisper.cpp/build/bin/whisper-cli");
    if built.is_file() {
        return Some(built);
    }
    ["whisper-cli", "whisper-cpp"]
        .iter()
        .find_map(|n| on_path(n, path_var))
}

/// Preferência entre modelos: o melhor equilíbrio qualidade/velocidade primeiro.
const MODEL_ORDER: [&str; 9] = [
    "large-v3-turbo-q5_0",
    "large-v3-turbo",
    "small",
    "medium",
    "base",
    "large-v3",
    "small.en",
    "base.en",
    "tiny",
];

pub fn find_model(env_model: Option<&str>, data: &Path) -> Option<PathBuf> {
    if let Some(p) = env_model
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
    {
        return p.is_file().then_some(p);
    }
    let mut found: Vec<PathBuf> = std::fs::read_dir(data)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            n.starts_with("ggml-") && n.ends_with(".bin") && p.is_file()
        })
        .collect();
    let rank = |p: &PathBuf| {
        let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let stem = n.trim_start_matches("ggml-").trim_end_matches(".bin");
        MODEL_ORDER
            .iter()
            .position(|m| *m == stem)
            .unwrap_or(MODEL_ORDER.len())
    };
    found.sort_by_key(|p| (rank(p), p.clone()));
    found.into_iter().next()
}

pub fn find_recorder(path_var: Option<&std::ffi::OsStr>) -> Option<Recorder> {
    if cfg!(windows) {
        return None;
    }
    Recorder::ALL
        .into_iter()
        .find(|r| on_path(r.program(), path_var).is_some())
}

/// Procura tudo a partir do ambiente do processo.
pub fn detect() -> Setup {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let data = data_dir(&home);
    let path = std::env::var_os("PATH");
    Setup {
        binary: find_binary(
            std::env::var("DXTUTOR_WHISPER_BIN").ok().as_deref(),
            &data,
            path.as_deref(),
        ),
        model: find_model(
            std::env::var("DXTUTOR_WHISPER_MODEL").ok().as_deref(),
            &data,
        ),
        recorder: find_recorder(path.as_deref()),
    }
}

pub fn status(s: &Setup) -> Status {
    let mut missing = vec![];
    if s.binary.is_none() {
        missing.push("whisper.cpp (whisper-cli) — corre scripts/setup-whisper.sh".to_string());
    }
    if s.model.is_none() {
        missing.push("um modelo ggml em ~/.local/share/dxtutor/whisper — scripts/setup-whisper.sh descarrega-o".to_string());
    }
    if s.recorder.is_none() {
        missing.push("um gravador de áudio (pw-record, parecord, arecord ou ffmpeg)".to_string());
    }
    Status {
        ready: missing.is_empty(),
        binary: s.binary.as_ref().map(|p| p.display().to_string()),
        model: s.model.as_ref().map(|p| p.display().to_string()),
        recorder: s.recorder,
        missing,
        recording: ACTIVE.lock().map(|a| a.is_some()).unwrap_or(false),
    }
}

/* ───── gravação ───── */

struct Recording {
    child: Child,
    path: PathBuf,
    started: Instant,
}

static ACTIVE: Mutex<Option<Recording>> = Mutex::new(None);

/// Uma gravação mais longa do que isto é parada à força ao terminar (o whisper divide em
/// janelas de 30 s, mas um ditado de 10 minutos é quase de certeza um esquecimento).
pub const MAX_RECORDING: Duration = Duration::from_secs(10 * 60);

fn temp_wav() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "dxtutor-dictation-{}-{nanos}-{}.wav",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Começa a gravar com o gravador encontrado.
pub fn start(s: &Setup) -> Result<(), String> {
    let rec = s
        .recorder
        .ok_or("sem gravador de áudio (pw-record, parecord, arecord ou ffmpeg)")?;
    let out = temp_wav();
    start_with(rec.command(&out), out)
}

/// Começa a gravar com um comando dado (os testes usam um gravador falso).
pub fn start_with(mut cmd: Command, out: PathBuf) -> Result<(), String> {
    let mut active = ACTIVE.lock().map_err(|_| "estado do ditado inválido")?;
    if active.is_some() {
        return Err("já há uma gravação em curso".into());
    }
    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("não consegui arrancar o gravador: {e}"))?;
    *active = Some(Recording {
        child,
        path: out,
        started: Instant::now(),
    });
    Ok(())
}

/// Pára o gravador com SIGINT (os gravadores fecham o WAV como deve ser) e espera por ele.
fn finish(mut r: Recording) -> Result<PathBuf, String> {
    #[cfg(unix)]
    // SAFETY: `kill` só envia um sinal ao pid do filho que lançámos e ainda não esperámos.
    unsafe {
        libc::kill(r.child.id() as libc::pid_t, libc::SIGINT);
    }
    #[cfg(not(unix))]
    let _ = r.child.kill();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match r.child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = r.child.kill();
                let _ = r.child.wait();
                break;
            }
        }
    }
    let too_long = r.started.elapsed() > MAX_RECORDING;
    let size = std::fs::metadata(&r.path).map(|m| m.len()).unwrap_or(0);
    if size <= 44 {
        let mut err = String::new();
        if let Some(mut e) = r.child.stderr.take() {
            use std::io::Read;
            let _ = e.read_to_string(&mut err);
        }
        let _ = std::fs::remove_file(&r.path);
        let why = err.lines().last().unwrap_or("").trim().to_string();
        return Err(if why.is_empty() {
            "a gravação ficou vazia (o microfone está ligado?)".into()
        } else {
            format!("a gravação falhou: {why}")
        });
    }
    if too_long {
        let _ = std::fs::remove_file(&r.path);
        return Err("a gravação passou de 10 minutos e foi descartada".into());
    }
    Ok(r.path)
}

/// Pára e transcreve. `lang`: `pt`, `en`, … ou `auto`.
pub fn stop(s: &Setup, lang: &str) -> Result<String, String> {
    let r = ACTIVE
        .lock()
        .map_err(|_| "estado do ditado inválido")?
        .take()
        .ok_or("não há gravação em curso")?;
    let wav = finish(r)?;
    let out = match (&s.binary, &s.model) {
        (Some(b), Some(m)) => transcribe(b, m, &wav, lang),
        _ => Err("o whisper.cpp não está instalado — corre scripts/setup-whisper.sh".into()),
    };
    let _ = std::fs::remove_file(&wav);
    out
}

/// Pára e deita fora a gravação.
pub fn cancel() {
    if let Ok(mut a) = ACTIVE.lock() {
        if let Some(r) = a.take() {
            if let Ok(p) = finish(r) {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

/// Texto inicial dado ao whisper (`--prompt`) para cada língua: orienta a ortografia, a
/// pontuação e o vocabulário de programação (sem ele, «commit»/«branch»/«lexer» saem
/// estropiados e o português às vezes sai em espanhol).
pub fn initial_prompt(lang: &str) -> Option<&'static str> {
    match lang {
        "pt" => Some(
            "Olá. Vamos rever o código do projecto: corrige o erro, faz commit na branch e corre os testes.",
        ),
        "en" => Some("Hi. Let's review the project code: fix the bug, commit to the branch and run the tests."),
        _ => None,
    }
}

/// A duração de um WAV PCM em segundos, pelo cabeçalho (`None` se não for WAV legível).
pub fn wav_seconds(wav: &Path) -> Option<f64> {
    let bytes = std::fs::read(wav).ok()?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let u32le = |i: usize| {
        bytes
            .get(i..i + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let mut byte_rate = None;
    let mut i = 12;
    while i + 8 <= bytes.len() {
        let size = u32le(i + 4)? as usize;
        match &bytes[i..i + 4] {
            b"fmt " => byte_rate = u32le(i + 16),
            b"data" => {
                // gravadores parados a meio deixam o tamanho a 0/«infinito»: conta o que existe
                let avail = bytes.len() - (i + 8);
                let data = if size == 0 || size > avail {
                    avail
                } else {
                    size
                };
                return byte_rate.filter(|r| *r > 0).map(|r| data as f64 / r as f64);
            }
            _ => {}
        }
        i += 8 + size + (size & 1);
    }
    None
}

/// O contexto de áudio do whisper (`-ac`) para um clip: o whisper codifica sempre uma
/// janela de 30 s (1500 frames); para um ditado curto, limitá-la à duração (50 frames/s
/// e uma margem) corta o tempo do codificador para um terço sem perder qualidade.
/// `0` = janela inteira (clips longos ou duração desconhecida).
pub fn audio_ctx(seconds: Option<f64>) -> u32 {
    match seconds {
        Some(s) if s > 0.0 && s < 28.0 => ((s * 50.0).ceil() as u32 + 128).min(1500),
        _ => 0,
    }
}

/// Corre o `whisper-cli` sobre um WAV e devolve o texto.
pub fn transcribe(binary: &Path, model: &Path, wav: &Path, lang: &str) -> Result<String, String> {
    let lang = match lang.trim() {
        "" => "auto",
        l if l.len() <= 5 && l.chars().all(|c| c.is_ascii_alphabetic()) => l,
        _ => "auto",
    };
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 8))
        .unwrap_or(4);
    let mut cmd = Command::new(binary);
    cmd.arg("-m").arg(model).arg("-f").arg(wav).args([
        "-l",
        lang,
        "-t",
        &threads.to_string(),
        "-nt",
        "-np",
    ]);
    // NB: não usar `-mc 0` — também desliga o `--prompt`, e sem ele o whisper entra em ciclos
    // de repetição (medido: 72% de erro). Os ciclos que escapem saem no `clean_transcript`.
    cmd.args(["-ac", &audio_ctx(wav_seconds(wav)).to_string()]);
    if let Some(p) = initial_prompt(lang) {
        cmd.args(["--prompt", p]);
    }
    let out = cmd
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("não consegui correr o whisper.cpp: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let last = err
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim();
        return Err(format!("o whisper.cpp falhou: {last}"));
    }
    Ok(clean_transcript(&String::from_utf8_lossy(&out.stdout)))
}

/// Junta as linhas da transcrição, tira as marcas de silêncio/ruído do whisper e as frases
/// repetidas em seguida (o whisper às vezes entra em ciclo e repete a mesma frase).
pub fn clean_transcript(stdout: &str) -> String {
    let joined = clean_lines(stdout);
    let mut out: Vec<&str> = vec![];
    for sentence in joined.split_inclusive(['.', '?', '!']) {
        let t = sentence.trim();
        if t.is_empty() || out.last().is_some_and(|p| p.eq_ignore_ascii_case(t)) {
            continue;
        }
        out.push(t);
    }
    out.join(" ")
}

fn clean_lines(stdout: &str) -> String {
    let marker = |w: &str| {
        let w = w.trim();
        (w.starts_with('[') && w.ends_with(']'))
            || (w.starts_with('(') && w.ends_with(')'))
            || (w.starts_with('*') && w.ends_with('*') && w.len() > 1)
    };
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !marker(l))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn exe(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn finds_binary_model_and_recorder() {
        let d = tempfile::tempdir().unwrap();
        let data = data_dir(d.path());
        let bin = d.path().join("bin");
        // nada instalado
        assert_eq!(find_binary(None, &data, Some(bin.as_os_str())), None);
        assert_eq!(find_model(None, &data), None);
        assert_eq!(find_recorder(Some(bin.as_os_str())), None);
        // no PATH
        exe(&bin.join("whisper-cpp"), "true");
        exe(&bin.join("arecord"), "true");
        exe(&bin.join("parecord"), "true");
        assert_eq!(
            find_binary(None, &data, Some(bin.as_os_str())),
            Some(bin.join("whisper-cpp"))
        );
        assert_eq!(
            find_recorder(Some(bin.as_os_str())),
            Some(Recorder::Parecord),
            "parecord antes de arecord"
        );
        // o construído pelo script ganha ao do PATH; a variável ganha a tudo
        exe(&data.join("whisper.cpp/build/bin/whisper-cli"), "true");
        assert_eq!(
            find_binary(None, &data, Some(bin.as_os_str())),
            Some(data.join("whisper.cpp/build/bin/whisper-cli"))
        );
        assert_eq!(
            find_binary(Some(bin.join("arecord").to_str().unwrap()), &data, None),
            Some(bin.join("arecord"))
        );
        assert_eq!(
            find_binary(Some("/nao/existe"), &data, Some(bin.as_os_str())),
            None
        );
        // modelos: o melhor da lista de preferência
        for m in [
            "ggml-tiny.bin",
            "ggml-base.bin",
            "ggml-small.bin",
            "notas.txt",
        ] {
            std::fs::write(data.join(m), b"x").unwrap();
        }
        assert_eq!(find_model(None, &data), Some(data.join("ggml-small.bin")));
        std::fs::write(data.join("ggml-large-v3-turbo-q5_0.bin"), b"x").unwrap();
        assert_eq!(
            find_model(None, &data),
            Some(data.join("ggml-large-v3-turbo-q5_0.bin"))
        );
        let st = status(&Setup {
            binary: None,
            model: find_model(None, &data),
            recorder: Some(Recorder::Arecord),
        });
        assert!(!st.ready);
        assert_eq!(st.missing.len(), 1);
        assert!(st.missing[0].contains("setup-whisper.sh"));
    }

    #[test]
    fn recorder_commands_write_16k_mono_wav() {
        let out = Path::new("/tmp/x.wav");
        let args = |r: Recorder| {
            r.command(out)
                .get_args()
                .map(|a| a.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert_eq!(
            args(Recorder::PwRecord),
            "--rate 16000 --channels 1 --format s16 /tmp/x.wav"
        );
        assert_eq!(
            args(Recorder::Arecord),
            "-q -f S16_LE -r 16000 -c 1 -t wav /tmp/x.wav"
        );
        assert!(args(Recorder::Parecord).contains("--file-format=wav"));
        assert!(args(Recorder::Ffmpeg).contains("-ar 16000 -ac 1"));
    }

    #[test]
    fn transcript_cleanup() {
        assert_eq!(
            clean_transcript(
                "\n Olá, isto é um teste.\n [BLANK_AUDIO]\n (música)\n e mais  uma frase \n"
            ),
            "Olá, isto é um teste. e mais uma frase"
        );
        assert_eq!(clean_transcript("[BLANK_AUDIO]\n"), "");
        assert_eq!(
            clean_transcript("Revê o lexer. Revê o lexer. Revê o lexer. E corre os testes?"),
            "Revê o lexer. E corre os testes?"
        );
    }

    #[test]
    fn audio_context_from_wav_duration() {
        let d = tempfile::tempdir().unwrap();
        let wav = d.path().join("a.wav");
        // cabeçalho WAV 16 kHz mono s16 (byte rate 32000) + 2 s de silêncio
        let data = vec![0u8; 64_000];
        let mut h = b"RIFF".to_vec();
        h.extend((36 + data.len() as u32).to_le_bytes());
        h.extend(b"WAVEfmt ");
        h.extend(16u32.to_le_bytes());
        h.extend([1, 0, 1, 0]);
        h.extend(16_000u32.to_le_bytes());
        h.extend(32_000u32.to_le_bytes());
        h.extend([2, 0, 16, 0]);
        h.extend(b"data");
        h.extend((data.len() as u32).to_le_bytes());
        h.extend(&data);
        std::fs::write(&wav, &h).unwrap();
        assert_eq!(wav_seconds(&wav), Some(2.0));
        assert_eq!(audio_ctx(Some(2.0)), 228);
        assert_eq!(audio_ctx(Some(29.0)), 0, "clips longos: janela inteira");
        assert_eq!(audio_ctx(None), 0);
        std::fs::write(&wav, b"not a wav").unwrap();
        assert_eq!(wav_seconds(&wav), None);
    }

    /// Um só teste para o estado global (uma gravação de cada vez).
    #[test]
    fn record_stop_transcribe_and_cancel_with_fakes() {
        let d = tempfile::tempdir().unwrap();
        // gravador falso: escreve um "WAV" e espera pelo SIGINT
        let rec = d.path().join("rec.sh");
        exe(&rec, "printf 'RIFF....WAVEfmt ................data....0123456789' > \"$1\"; trap 'exit 0' INT; while :; do sleep 0.05; done");
        // whisper falso: mostra os argumentos que interessam e uma marca de silêncio
        let whisper = d.path().join("whisper-cli");
        exe(&whisper, "echo \"[BLANK_AUDIO]\"; for a in \"$@\"; do last=\"$a\"; done; echo \" ditado ok  $5 $6\"");
        let model = d.path().join("ggml-base.bin");
        std::fs::write(&model, b"x").unwrap();
        let setup = Setup {
            binary: Some(whisper),
            model: Some(model),
            recorder: Some(Recorder::Arecord),
        };

        let out = d.path().join("a.wav");
        let mut c = Command::new(&rec);
        c.arg(&out);
        start_with(c, out.clone()).unwrap();
        assert!(status(&setup).recording);
        let mut c2 = Command::new(&rec);
        c2.arg(d.path().join("b.wav"));
        assert!(start_with(c2, d.path().join("b.wav"))
            .unwrap_err()
            .contains("em curso"));
        std::thread::sleep(Duration::from_millis(150));
        let text = stop(&setup, "pt").unwrap();
        assert_eq!(text, "ditado ok -l pt");
        assert!(!out.exists(), "o WAV temporário é apagado");
        assert!(!status(&setup).recording);
        assert!(stop(&setup, "pt").unwrap_err().contains("não há gravação"));

        // cancelar deita fora
        let mut c3 = Command::new(&rec);
        c3.arg(d.path().join("c.wav"));
        start_with(c3, d.path().join("c.wav")).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        cancel();
        assert!(!d.path().join("c.wav").exists());
        assert!(!status(&setup).recording);

        // gravação vazia → erro claro
        let mut c4 = Command::new("sh");
        c4.args(["-c", "trap 'exit 0' INT; while :; do sleep 0.05; done"]);
        start_with(c4, d.path().join("vazio.wav")).unwrap();
        assert!(stop(&setup, "auto").unwrap_err().contains("vazia"));
    }

    /// Com o whisper.cpp instalado (`scripts/setup-whisper.sh`): transcreve a amostra que
    /// vem com o whisper.cpp e grava 1 s do microfone com o gravador do sistema.
    /// `cargo test -p dxtutor-ide --lib dictation -- --ignored`
    #[test]
    #[ignore = "precisa do whisper.cpp e de um modelo instalados"]
    fn real_whisper_and_recorder() {
        let s = detect();
        let (bin, model) = (
            s.binary.clone().expect("whisper-cli"),
            s.model.clone().expect("modelo"),
        );
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let sample = data_dir(&home).join("whisper.cpp/samples/jfk.wav");
        let text = transcribe(&bin, &model, &sample, "en").unwrap();
        assert!(
            text.to_lowercase()
                .contains("ask not what your country can do for you"),
            "{text}"
        );
        // gravação real (sem voz: só prova que o WAV fica bem fechado e o whisper o lê)
        start(&s).unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        match stop(&s, "auto") {
            Ok(t) => eprintln!("transcrição do silêncio: {t:?}"),
            Err(e) => assert!(e.contains("vazia"), "{e}"),
        }
    }
}
