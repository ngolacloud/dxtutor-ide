/* ═══════════ feature `scm` — domain: searching the Commit Graph (r23 F3, UI-SCM-08) ═══════════
   Tokens `author:` `type:` `file:` `issue:` `branch:` `message:` plus free text (quotes keep spaces:
   `author:"Ana Lima"`). Different keys must all match; the same key repeated matches any of its values
   (`type:feat type:fix`). Case-insensitive substring, except `type:` and `issue:` (exact). PURE. */

import { conventionalOf } from "./conventional";
import { issueKeyIn } from "./trailers";

export const SEARCH_KEYS = ["author", "type", "file", "issue", "branch", "message"] as const;
export type SearchKey = (typeof SEARCH_KEYS)[number];
export interface Query { free: string[]; keys: Partial<Record<SearchKey, string[]>> }
export type SearchMode = "highlight" | "filter";

export interface Searchable { m: string; a: string; files: string[]; branches: string[] }

/** Splits on spaces outside quotes. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\w+:)?"([^"]*)"?|\S+/g)) out.push(m[2] !== undefined ? (m[1] ?? "") + m[2] : m[0]);
  return out.filter((t) => t.trim() !== "");
}

export function parseQuery(text: string): Query {
  const q: Query = { free: [], keys: {} };
  for (const tk of tokens(text)) {
    const i = tk.indexOf(":"), k = i > 0 ? tk.slice(0, i).toLowerCase() : "";
    if ((SEARCH_KEYS as readonly string[]).includes(k) && i < tk.length - 1) (q.keys[k as SearchKey] ??= []).push(tk.slice(i + 1));
    else q.free.push(tk);
  }
  return q;
}

export const isEmptyQuery = (q: Query): boolean => q.free.length === 0 && Object.keys(q.keys).length === 0;

const has = (hay: string, needle: string): boolean => hay.toLowerCase().includes(needle.toLowerCase());

export function matches(q: Query, c: Searchable): boolean {
  const type = conventionalOf(c.m)?.type ?? "", issue = issueKeyIn(c.m) ?? "";
  const test: Record<SearchKey, (v: string) => boolean> = {
    author: (v) => has(c.a, v),
    type: (v) => type === v.toLowerCase(),
    file: (v) => c.files.some((f) => has(f, v)),
    issue: (v) => issue.toUpperCase() === v.toUpperCase(),
    branch: (v) => c.branches.some((b) => has(b, v)),
    message: (v) => has(c.m, v),
  };
  for (const [k, vals] of Object.entries(q.keys) as Array<[SearchKey, string[]]>) if (!vals.some(test[k])) return false;
  return q.free.every((v) => has(c.m, v) || has(c.a, v));
}

/** A token for a value (quoted when it has spaces): what clicking a contributor or a chip adds. */
export const tokenFor = (k: SearchKey, v: string): string => `${k}:${/\s/.test(v) ? `"${v}"` : v}`;
