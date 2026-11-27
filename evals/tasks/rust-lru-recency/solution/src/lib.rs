use std::collections::HashMap;
use std::hash::Hash;

/// A small least-recently-used cache.
pub struct LruCache<K, V> {
    capacity: usize,
    map: HashMap<K, V>,
    order: Vec<K>, // oldest first
}

impl<K: Eq + Hash + Clone, V> LruCache<K, V> {
    pub fn new(capacity: usize) -> Self {
        LruCache { capacity, map: HashMap::new(), order: vec![] }
    }

    fn touch(&mut self, k: &K) {
        if let Some(i) = self.order.iter().position(|x| x == k) {
            let key = self.order.remove(i);
            self.order.push(key);
        }
    }

    pub fn get(&mut self, k: &K) -> Option<&V> {
        if self.map.contains_key(k) {
            self.touch(k);
        }
        self.map.get(k)
    }

    pub fn put(&mut self, k: K, v: V) {
        if self.map.contains_key(&k) {
            self.touch(&k);
        } else {
            if self.map.len() == self.capacity {
                let old = self.order.remove(0);
                self.map.remove(&old);
            }
            self.order.push(k.clone());
        }
        self.map.insert(k, v);
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}
