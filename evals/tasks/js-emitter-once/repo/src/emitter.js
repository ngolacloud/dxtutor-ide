export class Emitter {
  constructor() { this.map = new Map(); }
  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, []);
    this.map.get(event).push(fn);
    return this;
  }
  off(event, fn) {
    const l = this.map.get(event) || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
    return this;
  }
  emit(event, ...args) {
    const l = this.map.get(event) || [];
    for (let i = 0; i < l.length; i++) l[i](...args);
  }
}
