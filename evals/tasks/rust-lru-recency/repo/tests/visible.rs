use task::LruCache;

#[test]
fn evicts_when_full() {
    let mut c = LruCache::new(2);
    c.put("a", 1);
    c.put("b", 2);
    c.put("c", 3);
    assert_eq!(c.get(&"a"), None);
    assert_eq!(c.len(), 2);
}
