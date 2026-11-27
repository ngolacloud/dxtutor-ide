const parse = (s) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s).trim());
  if (!m) throw new TypeError(`not a version: ${s}`);
  return m.slice(1).map(Number);
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function comparator(c, v) {
  if (c === "*") return true;
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(c);
  const op = m[1] || "=", t = parse(m[2]), d = cmp(v, t);
  switch (op) {
    case "=": return d === 0;
    case ">": return d > 0;
    case ">=": return d >= 0;
    case "<": return d < 0;
    case "<=": return d <= 0;
    case "~": return d >= 0 && v[0] === t[0] && v[1] === t[1];
    case "^": return d >= 0 && v[0] === t[0] && (t[0] !== 0 || v[1] === t[1]);
  }
}

export function satisfies(version, range) {
  const v = parse(version);
  const alts = String(range).split("||").map((a) => a.trim().split(/\s+/).filter(Boolean));
  if (alts.some((a) => a.length === 0)) throw new TypeError(`bad range: ${range}`);
  let ok = false;
  for (const a of alts) {
    const all = a.map((c) => comparator(c, v)).every(Boolean);
    ok = ok || all;
  }
  return ok;
}
