package retry

import (
	"math"
	"time"
)

type Backoff struct {
	base, max time.Duration
	jitter    float64
	rnd       func() float64
}

func NewBackoff(base, max time.Duration, jitter float64, rnd func() float64) *Backoff {
	return &Backoff{base: base, max: max, jitter: jitter, rnd: rnd}
}

func (b *Backoff) Next(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	d := float64(b.base) * math.Pow(2, float64(attempt))
	if d > float64(b.max) || math.IsInf(d, 0) {
		d = float64(b.max)
	}
	if b.jitter > 0 {
		d = d * (1 - b.jitter + 2*b.jitter*b.rnd())
	}
	if d > float64(b.max) {
		d = float64(b.max)
	}
	return time.Duration(d)
}
