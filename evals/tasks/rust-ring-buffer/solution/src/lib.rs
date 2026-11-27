/// A fixed-size buffer of the last `capacity` samples.
pub struct RingBuffer<T> {
    items: Vec<T>,
    capacity: usize,
    next: usize,
}

impl<T: Clone> RingBuffer<T> {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0);
        RingBuffer { items: Vec::with_capacity(capacity), capacity, next: 0 }
    }

    pub fn push(&mut self, v: T) {
        if self.items.len() < self.capacity {
            self.items.push(v);
        } else {
            self.items[self.next] = v;
        }
        self.next = (self.next + 1) % self.capacity;
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The samples, oldest first.
    pub fn to_vec(&self) -> Vec<T> {
        if self.items.len() < self.capacity {
            return self.items.clone();
        }
        let mut v = self.items[self.next..].to_vec();
        v.extend_from_slice(&self.items[..self.next]);
        v
    }
}
