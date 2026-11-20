/* ═══════════ feature `visualizer` — catálogo de exemplos (ADR-0002, Fase 2) ═══════════
   PURO: os programas de demonstração `[título, fonte]` que o overlay oferece e que a
   paleta de comandos (`boot7`) regista. Fontes verbatim do monólito. */

import type { SampleCatalog } from "./types";

export const VZS: SampleCatalog = {
  sum: ["Slices and the stack", `fn sum_list(numbers: &[i64]) -> i64 {
    let mut total = 0;
    for n in numbers {
        total = total + n;
    }
    total
}

fn main() {
    let values = [4, 8, 15, 16, 23];
    let result = sum_list(&values);
    println!("sum = {}", result);
}
`],
  grow: ["How a Vec grows", `fn main() {
    let mut v = Vec::new();
    for i in 0..6 {
        v.push(i * 10);
    }
    let mut w = Vec::with_capacity(6);
    for i in 0..6 {
        w.push(i * 10);
    }
    println!("v cap = {}, w cap = {}", v.capacity(), w.capacity());
}
`],
  own: ["Ownership: move, borrow, clone, drop", `fn shout(s: String) -> String {
    let mut loud = s;
    loud.push_str("!");
    loud
}

fn count(s: &String) -> usize {
    s.len()
}

fn main() {
    let a = String::from("hello");
    let n = count(&a);
    let b = a.clone();
    let c = shout(a);
    println!("{} {} {}", n, b, c);
}
`],
  rec: ["Recursion and stack frames", `fn factorial(n: u64) -> u64 {
    if n == 0 {
        return 1;
    }
    n * factorial(n - 1)
}

fn main() {
    let r = factorial(5);
    println!("5! = {}", r);
}
`],
  bounds: ["Bounds checks and panics", `fn main() {
    let v = vec![1, 2, 3];
    let mut i = 0;
    while i <= v.len() {
        println!("{}", v[i]);
        i += 1;
    }
}
`],
  ovf: ["Integer overflow", `fn main() {
    let mut level: u8 = 250;
    let wrapped = 300 as u8;
    println!("300 as u8 = {}", wrapped);
    for _ in 0..10 {
        level += 1;
    }
    println!("{}", level);
}
`],
  str: ["Strings: rodata, heap and UTF-8", `fn main() {
    let greeting = "olá";
    let mut name = String::new();
    name.push_str("Ana");
    let msg = format!("{}, {}!", greeting, name);
    println!("{}", msg);
    println!("{:?} is {} bytes", greeting, greeting.len());
}
`],
  moved: ["A use after move (compile error)", `fn consume(v: Vec<i32>) -> usize {
    v.len()
}

fn main() {
    let data = vec![1, 2, 3];
    let n = consume(data);
    println!("{} {}", n, data.len());
}
`],
};
