/* ═══════════ feature `protect` — domain: the secret scan's report (r23 F4a, X03) ═══════════
   A commit the backend blocked fails with `SECRET_SCAN_BLOCKED:{report}` (tutor_protect::scan): the
   findings with masked previews, never a secret. These rules read it back from an error's text and
   word it for the approval dialog and a refusal. PURE: no DOM, no window, no Tauri. */

export const BLOCKED = "SECRET_SCAN_BLOCKED:";

export interface Finding { file: string; line: number; rule: string; preview: string }
export interface ScanReport { tool: string; files: number; findings: Finding[] }

/** The report inside an error's text (`git commit: SECRET_SCAN_BLOCKED:{…}`), or null. */
export function parseBlocked(text: string): ScanReport | null {
  const i = text.indexOf(BLOCKED);
  if (i < 0) return null;
  const json = text.slice(i + BLOCKED.length);
  const end = json.lastIndexOf("}");
  try {
    const r = JSON.parse(json.slice(0, end + 1)) as ScanReport;
    return Array.isArray(r.findings) ? r : null;
  } catch {
    return null;
  }
}

/** `file:line (rule)` for each finding (a whole file: `file (rule)`), at most `max`, then «+n more». */
export function findingLines(r: ScanReport, max = 8): string[] {
  const lines = r.findings.slice(0, max).map((f) => `${f.file}${f.line ? `:${f.line}` : ""} (${f.rule})${f.preview ? ` — ${f.preview}` : ""}`);
  if (r.findings.length > max) lines.push(`+${r.findings.length - max}`);
  return lines;
}

/** The distinct files with findings. */
export const filesOf = (r: ScanReport): string[] => [...new Set(r.findings.map((f) => f.file))];
