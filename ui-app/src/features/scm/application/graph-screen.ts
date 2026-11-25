/* ═══════════ feature `scm` — application: the Commit Graph screen (r23 F3, UI-SCM-08) ═══════════
   The state the graph reads beside the commit DAG (which the residue owns as `GIT`): the refs snapshot for the
   sidebar (one read in flight at a time; refreshed when the repository changes), the selected commit and its
   files (read lazily from `git show`, cached by hash). In the browser — no repository — it reads nothing.
   No DOM, no window. */

import { filesOfShow, type RefsSnapshot } from "../domain/refs";
import type { SearchMode } from "../domain/search";
import type { GitRefsPort } from "./extras-ports";

export interface GraphScreenState {
  refs: RefsSnapshot | null;
  loading: boolean;
  error: string | null;
  /** files per commit hash; `null` while reading */
  files: Record<string, string[] | null>;
  /** the search box (`author:` `type:` `file:` `issue:` `branch:` `message:` and free text) */
  query: string;
  /** highlight: every commit, the others dimmed · filter: only the matches */
  mode: SearchMode;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeGraphScreen(deps: { git: GitRefsPort; root: () => string | null }) {
  const { git, root } = deps;
  const st: GraphScreenState = { refs: null, loading: false, error: null, files: {}, query: "", mode: "highlight" };
  let forRoot: string | null = null, inFlight: Promise<void> | null = null, again = false;
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function load(): Promise<void> {
    const r = root();
    if (!r) { if (st.refs || forRoot) { st.refs = null; st.files = {}; forRoot = null; emit(); } return; }
    if (inFlight) { again = true; return inFlight; }
    if (r !== forRoot) { st.refs = null; st.files = {}; }
    st.loading = true; emit();
    inFlight = (async () => {
      try { st.refs = await git.refs(r); st.error = null; forRoot = r; }
      catch (e) { st.error = msg(e); }
      finally { st.loading = false; inFlight = null; emit(); }
      if (again) { again = false; await load(); }
    })();
    return inFlight;
  }

  async function filesOf(hash: string): Promise<void> {
    const r = root();
    if (!r || hash in st.files) return;
    st.files[hash] = null; emit();
    try { st.files[hash] = filesOfShow(await git.show(r, hash)); }
    catch { st.files[hash] = []; }
    emit();
  }

  return {
    state: (): GraphScreenState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    load,
    filesOf,
    setQuery: (q: string): void => { if (q !== st.query) { st.query = q; emit(); } },
    setMode: (m: SearchMode): void => { if (m !== st.mode) { st.mode = m; emit(); } },
    /** adds a token (a contributor, a chip) unless it is already there */
    addToken: (tk: string): void => { if (!st.query.split(/\s+/).includes(tk)) { st.query = (st.query.trim() + " " + tk).trim(); emit(); } },
    /** the repository changed (commit, checkout, fetch…): read the refs again and forget the file lists of moved refs */
    invalidate: (): void => { void load(); },
  };
}

export type GraphScreen = ReturnType<typeof makeGraphScreen>;
