use task::RingBuffer;

#[test]
fn keeps_order_until_full() {
    let mut r = RingBuffer::new(3);
    r.push(1);
    r.push(2);
    assert_eq!(r.to_vec(), vec![1, 2]);
}
