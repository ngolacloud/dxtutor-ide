//! The cost of a turn from the provider's real token counts (RF-T04, docs/v2/RF-DELONIX-PLANO.md
//! F4.9). Price per million tokens (Anthropic first-party API, 2026-11 table — the same as
//! `ui-app/src/features/codev/domain/pricing.ts`); cache reads have their own price, cache
//! writes cost 1.25× the input with the 5 min TTL and 2× with the 1 hour TTL (the system
//! prompt breakpoint of the IDE's Co-Dev). Unknown model → no cost (tokens only).

use crate::provider::Usage;

/// `(model, input, output, cache read)` in dollars per million tokens.
pub const PRICES: &[(&str, f64, f64, f64)] = &[
    ("claude-fable-5-2", 8.0, 40.0, 0.2),
    ("claude-opus-5-5", 4.0, 20.0, 0.2),
    ("claude-opus-5", 5.0, 25.0, 0.5),
    ("claude-opus-4-8", 5.0, 25.0, 0.5),
    ("claude-sonnet-5-5", 2.0, 10.0, 0.1),
    ("claude-sonnet-5", 2.0, 10.0, 0.2),
    ("claude-haiku-5-5", 0.1, 0.5, 0.01),
];

/// Cost in dollars, or `None` when the model is not in the table.
pub fn cost_usd(model: &str, u: &Usage) -> Option<f64> {
    let (_, input, output, cache_read) = PRICES.iter().find(|p| p.0 == model)?;
    let m = 1_000_000.0;
    let write_1h = u
        .cache_creation_1h_input_tokens
        .min(u.cache_creation_input_tokens);
    let write_5m = u.cache_creation_input_tokens - write_1h;
    Some(
        (u.input_tokens as f64 * input
            + u.output_tokens as f64 * output
            + u.cache_read_input_tokens as f64 * cache_read
            + write_5m as f64 * input * 1.25
            + write_1h as f64 * input * 2.0)
            / m,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_tokens_give_the_cost_and_unknown_models_none() {
        let u = Usage {
            input_tokens: 10_000,
            output_tokens: 2_000,
            cache_read_input_tokens: 100_000,
            cache_creation_input_tokens: 4_000,
            cache_creation_1h_input_tokens: 0,
        };
        // 10k×4 + 2k×20 + 100k×0.2 + 4k×4×1.25 = 40k + 40k + 20k + 20k = 120k / 1M
        let c = cost_usd("claude-opus-5-5", &u).unwrap();
        assert!((c - 0.12).abs() < 1e-9, "{c}");
        assert_eq!(cost_usd("qwen3", &u), None);
    }

    #[test]
    fn one_hour_cache_writes_cost_twice_the_input() {
        let u = Usage {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 10_000,
            cache_creation_1h_input_tokens: 6_000,
        };
        // 4k × 4 × 1.25 + 6k × 4 × 2 = 20k + 48k = 68k / 1M
        let c = cost_usd("claude-opus-5-5", &u).unwrap();
        assert!((c - 0.068).abs() < 1e-9, "{c}");
    }
}
