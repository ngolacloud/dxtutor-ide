/// A token-bucket rate limiter.
pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    rate: f64,
    last: Option<u64>,
}

impl TokenBucket {
    pub fn new(capacity: u32, refill_per_sec: f64) -> Self {
        TokenBucket { capacity: capacity as f64, tokens: capacity as f64, rate: refill_per_sec, last: None }
    }

    /// Takes a token at `now_ms` (milliseconds since any fixed origin).
    pub fn allow(&mut self, now_ms: u64) -> bool {
        if let Some(last) = self.last {
            let dt = now_ms.saturating_sub(last) as f64 / 1000.0;
            self.tokens = (self.tokens + dt * self.rate).min(self.capacity);
        }
        self.last = Some(now_ms);
        if self.tokens >= 1.0 - 1e-9 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
