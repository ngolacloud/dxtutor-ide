const positive = (v, name, max = Infinity) => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1 || n > max) throw new RangeError(`${name} must be an integer from 1 to ${max}`);
  return n;
};

export function paginate(items, page, size) {
  const p = positive(page, "page"), s = positive(size, "size", 100);
  const total = items.length;
  return { items: items.slice((p - 1) * s, p * s), page: p, size: s, total, pages: Math.max(1, Math.ceil(total / s)) };
}
