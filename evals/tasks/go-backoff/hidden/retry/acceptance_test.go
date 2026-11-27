package retry_test

import (
	"testing"
	"time"

	. "example.com/task/retry"
)

func TestAcceptanceNoJitter(t *testing.T) {
	b := NewBackoff(100*time.Millisecond, 2*time.Second, 0, func() float64 { return 0.99 })
	want := []time.Duration{100, 200, 400, 800, 1600, 2000, 2000}
	for i, w := range want {
		if got := b.Next(i); got != w*time.Millisecond {
			t.Fatalf("attempt %d: %v", i, got)
		}
	}
	if b.Next(-3) != 100*time.Millisecond || b.Next(1000) != 2*time.Second {
		t.Fatal("negative or huge attempt")
	}
}

func TestAcceptanceJitter(t *testing.T) {
	low := NewBackoff(time.Second, time.Minute, 0.5, func() float64 { return 0 })
	high := NewBackoff(time.Second, 3*time.Second, 0.5, func() float64 { return 0.999999 })
	if got := low.Next(1); got != time.Second {
		t.Fatalf("low %v", got)
	}
	if got := high.Next(2); got != 3*time.Second {
		t.Fatalf("capped %v", got)
	}
}
