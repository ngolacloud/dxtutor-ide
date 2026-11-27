/** Delays `fn` until `wait` ms without calls. Not implemented yet. */
export function debounce(fn, wait, timers = globalThis) {
  return (...args) => fn(...args);
}
