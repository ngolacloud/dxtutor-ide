// jsdom não implementa estas APIs de browser; os módulos reais chamam-nas em
// caminhos que não fazem parte do comportamento a caracterizar (scroll, resize).
// Stubs no-op aqui, nunca no código-fonte.
if (!("scrollIntoView" in Element.prototype)) {
  Element.prototype.scrollIntoView = function () {};
}
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window.matchMedia === "undefined") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as any;
}
