package queue

// Queue is a FIFO queue of jobs.
type Queue[T any] struct {
	items []T
}

func (q *Queue[T]) Enqueue(v T) { q.items = append(q.items, v) }

func (q *Queue[T]) Dequeue() T {
	v := q.items[0]
	q.items = q.items[1:]
	return v
}

func (q *Queue[T]) Len() int { return len(q.items) }
