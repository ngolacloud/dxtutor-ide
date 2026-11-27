package retry

import "time"

type Backoff struct{}

func NewBackoff(base, max time.Duration, jitter float64, rnd func() float64) *Backoff {
	panic("not implemented")
}

func (b *Backoff) Next(attempt int) time.Duration {
	panic("not implemented")
}
