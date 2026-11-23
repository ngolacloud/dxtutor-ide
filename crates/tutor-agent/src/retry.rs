//! Política de retry: quando repetir um pedido falhado e quanto esperar.
//!
//! Só se repete **antes do primeiro byte** da resposta (falha de ligação ou estado
//! HTTP de erro). Um stream que já começou não é repetido aqui: o loop (F1) decide.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Repetir este estado HTTP? O cabeçalho `x-should-retry` do servidor manda sobre a
/// regra por omissão (408, 409, 429 e ≥ 500 — inclui o 529 *overloaded*).
pub fn should_retry(status: u16, x_should_retry: Option<&str>) -> bool {
    match x_should_retry.map(str::trim) {
        Some("true") => true,
        Some("false") => false,
        _ => matches!(status, 408 | 409 | 429) || status >= 500,
    }
}

/// Lê `retry-after` em segundos (a forma que a API usa). Datas HTTP são ignoradas.
pub fn parse_retry_after(v: Option<&str>) -> Option<Duration> {
    let s = v?.trim();
    s.parse::<f64>()
        .ok()
        .filter(|x| x.is_finite() && *x >= 0.0)
        .map(Duration::from_secs_f64)
}

/// Espera antes da tentativa `attempt` (0 = primeiro retry): `retry-after` quando o
/// servidor o indica (até 60 s); senão exponencial 0,5 s · 2ⁿ até 8 s, com jitter
/// entre 75 % e 100 % para não sincronizar clientes.
pub fn backoff(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(d) = retry_after {
        return d.min(Duration::from_secs(60));
    }
    let base = (0.5 * 2f64.powi(attempt.min(10) as i32)).min(8.0);
    Duration::from_secs_f64(base * (0.75 + 0.25 * jitter_unit()))
}

/// Número pseudo-aleatório em [0, 1) a partir do relógio — chega para jitter e evita
/// uma dependência de `rand`.
fn jitter_unit() -> f64 {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let x = n.wrapping_mul(2_654_435_761); // dispersão de Knuth
    (x % 10_000) as f64 / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_rule_and_server_override() {
        for s in [408, 409, 429, 500, 502, 503, 529] {
            assert!(should_retry(s, None), "{s} devia repetir");
        }
        for s in [400, 401, 403, 404, 413, 422] {
            assert!(!should_retry(s, None), "{s} não devia repetir");
        }
        assert!(!should_retry(529, Some("false")));
        assert!(should_retry(400, Some("true")));
    }

    #[test]
    fn retry_after_wins_and_is_capped() {
        assert_eq!(
            backoff(3, Some(Duration::from_secs(2))),
            Duration::from_secs(2)
        );
        assert_eq!(
            backoff(0, Some(Duration::from_secs(600))),
            Duration::from_secs(60)
        );
        assert_eq!(
            parse_retry_after(Some("1.5")),
            Some(Duration::from_millis(1500))
        );
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
        assert_eq!(parse_retry_after(Some("-1")), None);
    }

    #[test]
    fn exponential_with_jitter_and_cap() {
        for a in 0..12 {
            let d = backoff(a, None).as_secs_f64();
            let base = (0.5 * 2f64.powi(a.min(10) as i32)).min(8.0);
            assert!(
                d >= base * 0.75 - 1e-9 && d <= base + 1e-9,
                "tentativa {a}: {d}"
            );
        }
    }
}
