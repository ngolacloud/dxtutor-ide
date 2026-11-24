/* ═════════ feature `scm` — domain: trailers of a commit made with Co-Dev (RF-T02) ═════════
   docs/v2/RF-DELONIX-PLANO.md F4.8: a commit Co-Dev helped with carries the model that helped
   and the issue it belongs to; the author is always the human (the repository's git identity,
   enforced by the backend). PURE. */

/** The issue key cited in a commit message (`feat: paginate (DX-12)` → `DX-12`). */
export function issueKeyIn(message: string): string | null {
  return message.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] ?? null;
}

/** The trailer lines (one paragraph, at the end): `Assisted-by: <model> (dxtutor Co-Dev)` and
 *  `Issue: <key>`. `model`: the Co-Dev model, or `null` when the commit is the human's alone. */
export function assistTrailers(message: string, model: string | null): string[] {
  if (!model) return [];
  const out = [`Assisted-by: ${model} (dxtutor Co-Dev)`];
  const key = issueKeyIn(message);
  if (key) out.push(`Issue: ${key}`);
  return out;
}
