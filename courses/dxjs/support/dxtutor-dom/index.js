// @dxtutor/dom — part of the dxtutor Dxjs course, not of dxjs. Importing it gives Node a
// standards DOM (happy-dom), installed on globalThis exactly as dxjs's own DOM tests do it
// (packages/dom/test/setup.ts in dxjs 1.3.0, unchanged since 1.2.0), so html`…`, render and mount work under Node.
// In a browser you never need it: the page already has a DOM.
import { Window } from "happy-dom";

const win = new Window({ url: "https://local.test/" });
const g = globalThis;
g.window = win;
g.document = win.document;
g.Node = win.Node;
g.Element = win.Element;
g.HTMLElement = win.HTMLElement;
g.customElements = win.customElements;
g.Event = win.Event;
g.CustomEvent = win.CustomEvent;
g.KeyboardEvent = win.KeyboardEvent;
g.MouseEvent = win.MouseEvent;
g.location = win.location;
g.history = win.history;
g.addEventListener = win.addEventListener.bind(win);
g.removeEventListener = win.removeEventListener.bind(win);
g.dispatchEvent = win.dispatchEvent.bind(win);

/** A fresh empty <div> appended to <body>: a host to render or mount into. */
export function body() {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  return host;
}

/** Dispatch a bubbling event of `type` on `el` (what a click or a keystroke would do). */
export function fire(el, type) {
  el.dispatchEvent(new win.Event(type, { bubbles: true }));
}

/** Type `text` into an <input>: set its value, then fire `input` as the browser does. */
export function typeInto(input, text) {
  input.value = text;
  fire(input, "input");
}
