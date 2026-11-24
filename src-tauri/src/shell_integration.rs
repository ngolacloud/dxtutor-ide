//! Shell integration for the embedded terminals, the way VS Code does it.
//!
//! The user's shell still loads the user's own rc files; on top of them a small script
//! makes the prompt report, as invisible OSC escape sequences:
//!
//! * `OSC 7 ; file://<host><cwd>` — the working directory after every command, so a split
//!   terminal opens where you are and the tab can show it;
//! * `OSC 633 ; E ; <command>` then `OSC 633 ; D ; <exit code>` — the command that just
//!   finished and how it ended, so a failed command is marked and can be handed to the
//!   Debug assistant with its real output.
//!
//! Supported: bash (`--init-file`) and zsh (`ZDOTDIR`). Other shells run without it, which
//! only loses those markers. Scripts live in the user's cache dir (never a shared /tmp,
//! where another user could plant an rc file).

use std::path::{Path, PathBuf};

/// How to start a shell so it loads the integration script.
pub struct Plan {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

const BASH: &str = r#"# dxtutor shell integration (bash). Loads your ~/.bashrc, then reports cwd and exit codes.
if [ -r "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi
__dx_esc() { local s="${1//\\/\\\\}"; s="${s//;/\\x3b}"; s="${s//$'\n'/\\x0a}"; printf '%s' "$s"; }
# PS0 is expanded by this shell right before each command runs (bash >= 4.4); the array
# subscript is an arithmetic expression, so it sets __dx_ran=1 and expands to nothing. This
# marks "a command ran" even when HISTCONTROL=ignoredups leaves the history unchanged.
__dx_ran=0
PS0='${__dx_ps0[__dx_ran=1]}'"${PS0:-}"
__dx_prompt() {
  local code=$?
  if [ "$__dx_ran" = 1 ]; then
    __dx_ran=0
    local h; h="$(HISTTIMEFORMAT= builtin history 1 2>/dev/null)"
    local cmd; cmd="$(printf '%s' "$h" | sed -E 's/^ *[0-9]+\*? *//')"
    printf '\033]633;E;%s\007\033]633;D;%s\007' "$(__dx_esc "$cmd")" "$code"
  fi
  printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD"
  return $code
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__dx_prompt "${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="__dx_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
"#;

const ZSHENV: &str = r#"# dxtutor shell integration (zsh): load the user's .zshenv from their own ZDOTDIR.
__dx_zdot="$ZDOTDIR"
ZDOTDIR="${DXTUTOR_USER_ZDOTDIR:-$HOME}"
[ -r "$ZDOTDIR/.zshenv" ] && . "$ZDOTDIR/.zshenv"
DXTUTOR_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$__dx_zdot"
"#;

const ZSHRC: &str = r#"# dxtutor shell integration (zsh). Loads your .zshrc, then reports cwd and exit codes.
ZDOTDIR="${DXTUTOR_USER_ZDOTDIR:-$HOME}"
[ -r "$ZDOTDIR/.zprofile" ] && [[ -o login ]] && . "$ZDOTDIR/.zprofile"
[ -r "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"
unset DXTUTOR_USER_ZDOTDIR
autoload -Uz add-zsh-hook
__dx_cmd=""
__dx_preexec() { __dx_cmd="$1"; }
__dx_precmd() {
  local code=$?
  if [[ -n "$__dx_cmd" ]]; then
    local s="${__dx_cmd//\\/\\\\}"; s="${s//;/\\x3b}"; s="${s//$'\n'/\\x0a}"
    printf '\033]633;E;%s\007\033]633;D;%s\007' "$s" "$code"
    __dx_cmd=""
  fi
  printf '\033]7;file://%s%s\007' "${HOST:-localhost}" "$PWD"
}
add-zsh-hook preexec __dx_preexec
add-zsh-hook precmd __dx_precmd
"#;

/// Which integration a shell gets, decided by its program name. Pure.
#[derive(Debug, PartialEq, Eq)]
pub enum Kind {
    Bash,
    Zsh,
    None,
}

pub fn kind_of(shell: &str) -> Kind {
    let name = Path::new(shell)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match name.trim_end_matches(".exe") {
        "bash" => Kind::Bash,
        "zsh" => Kind::Zsh,
        _ => Kind::None,
    }
}

fn cache_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
    Some(base.join("dxtutor").join("shell-integration"))
}

/// Write `content` to `path` only when it differs (several terminals start at once).
fn write_if_changed(path: &Path, content: &str) -> std::io::Result<()> {
    if std::fs::read_to_string(path).ok().as_deref() == Some(content) {
        return Ok(());
    }
    std::fs::write(path, content)
}

/// The arguments/environment that make `shell` load the integration, or None when the
/// shell is not supported or the scripts cannot be written (the terminal then simply
/// starts without markers).
pub fn plan(shell: &str) -> Option<Plan> {
    let kind = kind_of(shell);
    if kind == Kind::None {
        return None;
    }
    let dir = cache_dir()?;
    std::fs::create_dir_all(&dir).ok()?;
    match kind {
        Kind::Bash => {
            let rc = dir.join("bash-init.sh");
            write_if_changed(&rc, BASH).ok()?;
            Some(Plan {
                args: vec![
                    "--init-file".into(),
                    rc.to_string_lossy().into_owned(),
                    "-i".into(),
                ],
                env: vec![],
            })
        }
        Kind::Zsh => {
            let zdir = dir.join("zsh");
            std::fs::create_dir_all(&zdir).ok()?;
            write_if_changed(&zdir.join(".zshenv"), ZSHENV).ok()?;
            write_if_changed(&zdir.join(".zshrc"), ZSHRC).ok()?;
            let user = std::env::var("ZDOTDIR")
                .ok()
                .or_else(|| std::env::var("HOME").ok())
                .unwrap_or_default();
            Some(Plan {
                args: vec!["-i".into()],
                env: vec![
                    ("ZDOTDIR".into(), zdir.to_string_lossy().into_owned()),
                    ("DXTUTOR_USER_ZDOTDIR".into(), user),
                ],
            })
        }
        Kind::None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_of_reads_the_program_name() {
        assert_eq!(kind_of("/usr/bin/bash"), Kind::Bash);
        assert_eq!(kind_of("zsh"), Kind::Zsh);
        assert_eq!(kind_of("/usr/bin/fish"), Kind::None);
        assert_eq!(kind_of("bash.exe"), Kind::Bash);
    }

    /// The bash script must be valid bash and must report cwd + exit code of a command.
    #[test]
    fn bash_script_reports_cwd_and_exit_code() {
        if std::process::Command::new("bash")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let rc = dir.path().join("rc.sh");
        std::fs::write(&rc, BASH).unwrap();
        // Simulate two prompts around a failing command in a non-interactive bash.
        let script = format!(
            // nothing run, a failing command, then the SAME command again (ignoredups leaves
            // the history unchanged: it must still be reported), then an empty Enter
            "set -o history; HISTCONTROL=ignoredups; HOME={home}; . {rc}; __dx_prompt; history -s 'false --flag;x'; __dx_ran=1; false; __dx_prompt; history -s 'false --flag;x'; __dx_ran=1; false; __dx_prompt; __dx_prompt",
            home = dir.path().display(),
            rc = rc.display()
        );
        let out = std::process::Command::new("bash")
            .args(["-c", &script])
            .output()
            .unwrap();
        let s = String::from_utf8_lossy(&out.stdout);
        let marker = "\x1b]633;E;false --flag\\x3bx\x07\x1b]633;D;1\x07";
        assert_eq!(s.matches(marker).count(), 2, "{s:?}");
        assert_eq!(s.matches("\x1b]7;file://").count(), 4, "{s:?}");
    }
}
