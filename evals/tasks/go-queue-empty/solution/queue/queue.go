package queue

// Queue is a FIFO queue of jobs.
type Queue[T any] struct {
	items []T
	head  int
}

func (q *Queue[T]) Enqueue(v T) {
	if q.head > 0 && q.head == len(q.items) {
		q.items = q.items[:0]
		q.head = 0
	} else if q.head > 64 && q.head*2 >= len(q.items) {
		n := copy(q.items, q.items[q.head:])
		var zero T
		for i := n; i < len(q.items); i++ {
			q.items[i] = zero
		}
		q.items = q.items[:n]
		q.head = 0
	}
	q.items = append(q.items, v)
}

func (q *Queue[T]) Dequeue() (T, bool) {
	var zero T
	if q.head >= len(q.items) {
		return zero, false
	}
	v := q.items[q.head]
	q.items[q.head] = zero
	q.head++
	return v, true
}

func (q *Queue[T]) Len() int { return len(q.items) - q.head }

func (q *Queue[T]) capacity() int { return cap(q.items) }
