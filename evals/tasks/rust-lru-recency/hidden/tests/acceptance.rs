use task::LruCache;

#[test]
fn get_refreshes_recency() {
    let mut c = LruCache::new(2);
    c.put("a", 1);
    c.put("b", 2);
    assert_eq!(c.get(&"a"), Some(&1));
    c.put("c", 3);
    assert_eq!(c.get(&"b"), None, "b was the least recently used");
    assert_eq!(c.get(&"a"), Some(&1));
    assert_eq!(c.get(&"c"), Some(&3));
}

#[test]
fn put_existing_updates_and_refreshes() {
    let mut c = LruCache::new(2);
    c.put("a", 1);
    c.put("b", 2);
    c.put("a", 10);
    c.put("c", 3);
    assert_eq!(c.get(&"a"), Some(&10));
    assert_eq!(c.get(&"b"), None);
    assert_eq!(c.len(), 2);
}
