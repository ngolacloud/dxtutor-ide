package queue

import "testing"

func TestAcceptanceFifoAndEmpty(t *testing.T) {
	var q Queue[string]
	if v, ok := q.Dequeue(); ok || v != "" {
		t.Fatalf("empty: %q %v", v, ok)
	}
	q.Enqueue("a")
	q.Enqueue("b")
	if v, ok := q.Dequeue(); !ok || v != "a" {
		t.Fatalf("%q %v", v, ok)
	}
	q.Enqueue("c")
	for _, want := range []string{"b", "c"} {
		if v, ok := q.Dequeue(); !ok || v != want {
			t.Fatalf("want %q got %q %v", want, v, ok)
		}
	}
	if q.Len() != 0 {
		t.Fatal(q.Len())
	}
}

func TestAcceptanceBoundedMemory(t *testing.T) {
	var q Queue[int]
	for i := 0; i < 100000; i++ {
		q.Enqueue(i)
		q.Enqueue(i)
		q.Dequeue()
		q.Dequeue()
	}
	if c := q.capacity(); c > 1024 {
		t.Fatalf("backing array grew to %d for an empty queue", c)
	}
}
