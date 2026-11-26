//! The branch of an issue (Multi Co-Dev, phase 3): the worktree of a Co-Dev session checks out the
//! issue's branch — the one recorded on the issue, or, when none is, the name the Project gives it
//! (`feature/<key>-<title>`, `fix/<key>-<title>` for a bug). The same rule as the UI's «Create
//! branch» (`features/project/domain/board.ts::branchName`): the title without accents, lower case,
//! runs of other characters as one `-`, at most 40 characters. PURE.

/// What a Latin letter with an accent is without it (the NFD base the UI keeps); `None`: a
/// character with no plain base (it becomes a separator).
fn fold(c: char) -> Option<char> {
    const LATIN1: &str = "AAAAAA-CEEEEIIII-NOOOOO--UUUUY--aaaaaa-ceeeeiiii-nooooo--uuuuy-y";
    const EXT_A: &str = concat!(
        "AaAaAaCcCcCcCcDd",
        "--EeEeEeEeEeGgGg",
        "GgGgHh--IiIiIiIi",
        "I---JjKk-LlLlLl-",
        "---NnNnNn---OoOo",
        "Oo--RrRrRrSsSsSs",
        "SsTtTt--UuUuUuUu",
        "UuUuWwYyYZzZzZz-",
    );
    let n = c as u32;
    let base = match n {
        0xC0..=0xFF => LATIN1.as_bytes()[(n - 0xC0) as usize] as char,
        0x100..=0x17F => EXT_A.as_bytes()[(n - 0x100) as usize] as char,
        _ => return Some(c),
    };
    (base != '-').then_some(base)
}

/// The branch the Project names for an issue: `feature/dx-12-pay-by-card`, `fix/dx-3-…` for a bug.
pub fn branch_name(key: &str, title: &str, kind: &str) -> String {
    let mut slug = String::new();
    let mut gap = false;
    for c in title.chars() {
        // the combining accents NFD leaves on their own are dropped, like the UI does
        if ('\u{300}'..='\u{36f}').contains(&c) {
            continue;
        }
        match fold(c).map(|b| b.to_ascii_lowercase()) {
            Some(b) if b.is_ascii_lowercase() || b.is_ascii_digit() => {
                if gap && !slug.is_empty() {
                    slug.push('-');
                }
                gap = false;
                slug.push(b);
            }
            _ => gap = true,
        }
    }
    let slug: String = slug.chars().take(40).collect();
    let slug = slug.trim_end_matches('-');
    let prefix = if kind == "bug" { "fix" } else { "feature" };
    let key = key.trim().to_lowercase();
    if slug.is_empty() {
        format!("{prefix}/{key}")
    } else {
        format!("{prefix}/{key}-{slug}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same names as the UI's `branchName` (tests/project.*.test.ts) for the same issues.
    #[test]
    fn the_branch_name_is_the_uis() {
        assert_eq!(
            branch_name("DX-12", "Pagar com cartão", "story"),
            "feature/dx-12-pagar-com-cartao"
        );
        assert_eq!(
            branch_name("DX-3", "  Corrigir o cálculo do IVA (Angola)! ", "bug"),
            "fix/dx-3-corrigir-o-calculo-do-iva-angola"
        );
        assert_eq!(branch_name("DX-4", "???", "task"), "feature/dx-4");
        assert_eq!(
            branch_name("DX-5", "Ação — Über straße Œuvre", "story"),
            "feature/dx-5-acao-uber-stra-e-uvre"
        );
        // at most 40 characters of title, never ending in a separator
        let long = branch_name(
            "DX-6",
            "a very long title that goes on and on beyond the limit",
            "story",
        );
        assert_eq!(
            long,
            "feature/dx-6-a-very-long-title-that-goes-on-and-on-be"
        );
        assert_eq!(
            branch_name(
                "DX-7",
                "abcdefghij abcdefghij abcdefghij abcdef gh",
                "story"
            ),
            "feature/dx-7-abcdefghij-abcdefghij-abcdefghij-abcdef"
        );
    }
}
