/** Parses a URL query string into an object. */
export function parseQuery(qs) {
  const out = {};
  for (const part of qs.replace(/^\?/, "").split("&")) {
    const [k, v] = part.split("=");
    out[k] = v;
  }
  return out;
}
