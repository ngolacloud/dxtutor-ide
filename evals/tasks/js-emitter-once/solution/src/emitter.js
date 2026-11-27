export class Emitter {
  constructor() { this.map = new Map(); }
  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, []);
    this.map.get(event).push({ fn, once: false });
    return this;
  }
  once(event, fn) {
    this.on(event, fn);
    const l = this.map.get(event);
    l[l.length - 1].once = true;
    return this;
  }
  off(event, fn) {
    const l = this.map.get(event) || [];
    const i = l.findIndex((x) => x.fn === fn);
    if (i >= 0) l[i].removed = true, l.splice(i, 1);
    return this;
  }
  emit(event, ...args) {
    const snapshot = [...(this.map.get(event) || [])];
    for (const x of snapshot) {
      if (x.removed) continue;
      if (x.once) this.off(event, x.fn);
      x.fn(...args);
    }
  }
}
