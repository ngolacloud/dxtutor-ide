use task::RingBuffer;

#[test]
fn drops_the_oldest_and_keeps_order() {
    let mut r = RingBuffer::new(3);
    for i in 1..=5 {
        r.push(i);
    }
    assert_eq!(r.to_vec(), vec![3, 4, 5]);
    assert_eq!(r.len(), 3);
    r.push(6);
    r.push(7);
    r.push(8);
    assert_eq!(r.to_vec(), vec![6, 7, 8]);
}

#[test]
fn capacity_one() {
    let mut r = RingBuffer::new(1);
    r.push("a");
    r.push("b");
    assert_eq!(r.to_vec(), vec!["b"]);
}
