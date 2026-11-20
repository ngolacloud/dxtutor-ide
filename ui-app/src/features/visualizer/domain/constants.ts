/* ═══════════ feature `visualizer` — constantes de memória (ADR-0002, Fase 2) ═══════════
   PUROS: tamanho em bytes de cada tipo escalar (`VZSZ`), o intervalo de cada inteiro
   (`VZR`, para verificar overflow) e a formatação de um endereço (`hex`). Partilhados
   por `hints` (infere usize), `narrate` (mostra endereços) e `interpreter`. */

export const VZSZ: Record<string, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, i64: 8, u64: 8, f64: 8, isize: 8, usize: 8, i128: 16, u128: 16, bool: 1, char: 4 };

export const VZR: Record<string, [number, number]> = { i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535], i32: [-2147483648, 2147483647], u32: [0, 4294967295], i64: [-(2 ** 63), 2 ** 63 - 1], u64: [0, 2 ** 64 - 1], isize: [-(2 ** 63), 2 ** 63 - 1], usize: [0, 2 ** 64 - 1] };

export const hex = (n: number): string => "0x" + Math.floor(n).toString(16).padStart(12, "0");
