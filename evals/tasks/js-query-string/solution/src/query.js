const decode = (s) => {
  const t = s.replace(/\+/g, " ");
  try { return decodeURIComponent(t); } catch { return t; }
};

/** Parses a URL query string into an object (repeated keys → arrays). */
export function parseQuery(qs) {
  const out = {};
  for (const part of qs.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decode(i < 0 ? part : part.slice(0, i));
    const v = i < 0 ? "" : decode(part.slice(i + 1));
    if (!(k in out)) out[k] = v;
    else if (Array.isArray(out[k])) out[k].push(v);
    else out[k] = [out[k], v];
  }
  return out;
}
