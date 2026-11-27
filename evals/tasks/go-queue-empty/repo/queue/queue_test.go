package queue

import "testing"

func TestLen(t *testing.T) {
	var q Queue[int]
	q.Enqueue(1)
	if q.Len() != 1 {
		t.Fatal(q.Len())
	}
}
