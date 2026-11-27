/// A token-bucket rate limiter.
pub struct TokenBucket {
    // TODO
}

impl TokenBucket {
    pub fn new(capacity: u32, refill_per_sec: f64) -> Self {
        let _ = (capacity, refill_per_sec);
        todo!()
    }

    /// Takes a token at `now_ms` (milliseconds since any fixed origin).
    pub fn allow(&mut self, now_ms: u64) -> bool {
        let _ = now_ms;
        todo!()
    }
}
