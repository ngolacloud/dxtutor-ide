/* ═════════ feature `welcome` — domain: recent folders (r23 F6) ═════════
   The real history the desktop keeps (`dx-recent`, newest first): name and parent for the list. PURE. */

export interface RecentEntry { path: string; name: string; parent: string }

export function recentEntries(paths: unknown, max = Infinity): RecentEntry[] {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
  return [...new Set(list)].slice(0, max).map((path) => {
    const clean = path.replace(/[\\/]+$/, "");
    const cut = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
    return { path, name: cut >= 0 ? clean.slice(cut + 1) || clean : clean, parent: cut > 0 ? clean.slice(0, cut) : cut === 0 ? "/" : "" };
  });
}

/** The parent folder a clone lands in by default: next to the most recent folder, else the home. */
export function defaultCloneParent(recent: RecentEntry[], home: string | null): string {
  return recent[0]?.parent || home || "";
}
