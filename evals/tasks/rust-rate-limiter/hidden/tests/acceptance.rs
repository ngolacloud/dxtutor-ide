use task::TokenBucket;

#[test]
fn starts_full_then_refuses() {
    let mut b = TokenBucket::new(3, 1.0);
    assert!(b.allow(0));
    assert!(b.allow(0));
    assert!(b.allow(0));
    assert!(!b.allow(0));
}

#[test]
fn refills_continuously_up_to_capacity() {
    let mut b = TokenBucket::new(2, 2.0); // one token every 500 ms
    assert!(b.allow(0));
    assert!(b.allow(0));
    assert!(!b.allow(100));
    assert!(b.allow(600));
    assert!(!b.allow(700));
    assert!(b.allow(10_000));
    assert!(b.allow(10_000));
    assert!(!b.allow(10_000), "never more than the capacity");
}

#[test]
fn fractions_accumulate() {
    let mut b = TokenBucket::new(1, 0.5); // a token every 2 s
    assert!(b.allow(0));
    assert!(!b.allow(1000));
    assert!(!b.allow(1999));
    assert!(b.allow(2000));
}
