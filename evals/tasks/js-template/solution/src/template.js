const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const get = (data, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), data);
const text = (v) => (v == null ? "" : String(v));

/** Fills {{key}} (escaped) and {{{key}}} (raw) placeholders; dotted paths; missing → "". */
export function render(template, data) {
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, k) => text(get(data, k)))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => escape(text(get(data, k))));
}
