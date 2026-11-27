/** Delays `fn` until `wait` ms without calls; `.cancel()` and `.flush()`. */
export function debounce(fn, wait, timers = globalThis) {
  let handle = null, last = null;
  const run = () => { handle = null; const a = last; last = null; fn(...a); };
  const d = (...args) => {
    last = args;
    if (handle !== null) timers.clearTimeout(handle);
    handle = timers.setTimeout(run, wait);
  };
  d.cancel = () => { if (handle !== null) timers.clearTimeout(handle); handle = null; last = null; };
  d.flush = () => { if (handle === null) return; timers.clearTimeout(handle); run(); };
  return d;
}
