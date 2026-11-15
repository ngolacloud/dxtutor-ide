// v7 icon system ported to ui-next: 16×16 line icons, stroke=currentColor. Paths are
// the exact v7 set (desktop/ui) so the two UIs render the same glyphs. `.fill` paths
// inside become solid via CSS (.ico .fill). No emoji anywhere in the frontend.

const PATHS: Record<string, string> = {
  account: "<circle cx=\"8\" cy=\"5.5\" r=\"2.6\"/><path d=\"M3.4 13.2c.6-2.6 2.4-3.9 4.6-3.9s4 1.3 4.6 3.9\"/>",
  book: "<path d=\"M3 3.2h4.5a1.5 1.5 0 0 1 1.5 1.5v8.1a1.2 1.2 0 0 0-1.2-1.2H3z\"/><path d=\"M13 3.2H8.5A1.5 1.5 0 0 0 7 4.7v8.1a1.2 1.2 0 0 1 1.2-1.2H13z\"/>",
  bug: "<path d=\"M5.5 5.5a2.5 2.5 0 0 1 5 0\"/><rect x=\"4.5\" y=\"5.5\" width=\"7\" height=\"8\" rx=\"3.5\"/><path d=\"M8 8v5M2 8.5h2.5M11.5 8.5H14M2.5 12l2-1M13.5 12l-2-1M2.5 5l2 1.2M13.5 5l-2 1.2\"/>",
  chev: "<path d=\"M6 4l4 4-4 4\"/>",
  close: "<path d=\"M4 4l8 8M12 4l-8 8\"/>",
  collapse: "<path d=\"M9 2.5 6.5 5H8.5V8\"/><path d=\"M5 11H3M7 5.5l4-4M11 11.5 9 9.5M11 9.5H9V11.5M2.5 7 5 9.5V11\"/>",
  container: "<rect x=\"2.2\" y=\"5\" width=\"4.4\" height=\"4.4\" rx=\".4\"/><rect x=\"6.8\" y=\"5\" width=\"4.4\" height=\"4.4\" rx=\".4\"/><path d=\"M11.4 5h2.4v4.4h-2.4M2.2 9.4h11.6v1.4c0 .6-.4 1-1 1H3.2c-.6 0-1-.4-1-1z\"/>",
  cube: "<path d=\"M8 1.9l5.4 3v6.2L8 14.1l-5.4-3V4.9z\"/><path d=\"M8 7.9l5.4-3M8 7.9v6.2M8 7.9L2.6 4.9\"/>",
  debug: "<circle cx=\"8\" cy=\"8.8\" r=\"3.4\"/><path d=\"M8 5.4V3.2M5.2 6.4 3.8 5M10.8 6.4 12.2 5M4.6 8.8H2.6M13.4 8.8h-2M5.4 11.2 4 12.6M10.6 11.2 12 12.6\"/>",
  explorer: "<rect x=\"5.2\" y=\"2.3\" width=\"7\" height=\"9.3\" rx=\"1\"/><path d=\"M5.2 4.6H3.8a1 1 0 0 0-1 1v7.1a1 1 0 0 0 1 1h5.9a1 1 0 0 0 1-1v-1.1\"/>",
  extensions: "<rect x=\"2.4\" y=\"2.4\" width=\"4.4\" height=\"4.4\" rx=\".6\"/><rect x=\"9.2\" y=\"2.4\" width=\"4.4\" height=\"4.4\" rx=\".6\"/><rect x=\"2.4\" y=\"9.2\" width=\"4.4\" height=\"4.4\" rx=\".6\"/><path d=\"M11.4 9.2v2.2M11.4 11.4v2.2M9.2 11.4h2.2M11.4 11.4h2.2\"/>",
  file: "<path d=\"M4 2.3h5.1L12 5.2v8a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.9A.6.6 0 0 1 4 2.3z\"/><path d=\"M9 2.4V5.5h2.9\"/>",
  folder: "<path class=\"fill\" d=\"M1.6 4.3c0-.6.4-1 1-1h3.1a1 1 0 0 1 .7.3l.9.9a1 1 0 0 0 .7.3h5.4c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1h-13c-.6 0-1-.4-1-1z\"/>",
  folderOpen: "<path class=\"fill\" d=\"M1.6 4.3c0-.6.4-1 1-1h3.1a1 1 0 0 1 .7.3l.9.9a1 1 0 0 0 .7.3h5.4c.6 0 1 .4 1 1v.9H4.4a1 1 0 0 0-.95.68L1.6 12.5z\"/>",
  gauge: "<path d=\"M2.6 11.8a5.6 5.6 0 1 1 10.8 0\"/><path d=\"M8 11.3l2.8-4\"/><circle cx=\"8\" cy=\"11.5\" r=\".9\"/>",
  graph: "<circle cx=\"4\" cy=\"4\" r=\"1.6\"/><circle cx=\"4\" cy=\"12\" r=\"1.6\"/><circle cx=\"12\" cy=\"8\" r=\"1.6\"/><path d=\"M4 5.6v4.8M5.4 4.8l5.2 2.5M5.4 11.2l5.2-2.5\"/>",
  history: "<circle cx=\"8\" cy=\"8\" r=\"5.8\"/><path d=\"M8 4.7V8l2.3 1.6\"/>",
  image: "<rect x=\"2.5\" y=\"3\" width=\"11\" height=\"10\" rx=\"1\"/><circle cx=\"5.8\" cy=\"6.3\" r=\"1.1\"/><path d=\"M2.5 11l3.2-3 2.3 2 2.4-2.6 3.1 3.6\"/>",
  plus: "<path d=\"M8 3v10M3 8h10\"/>",
  popout: "<path d=\"M9 2.5h4.5V7\"/><path d=\"M13.5 2.5 8 8\"/><path d=\"M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7\"/>",
  python: "<path d=\"M8 1.8c-2.4 0-2.9 1-2.9 2.3V6H8v.7H3.6c-1.3 0-2 .9-2 2.8s.7 2.8 2 2.8h1V10c0-1.4.9-2.3 2.3-2.3\"/><circle cx=\"6.3\" cy=\"4\" r=\".5\" class=\"fill\"/>",
  refresh: "<path d=\"M12.5 7a4.6 4.6 0 1 0-.7 3.4\"/><path d=\"M12.6 3.2v2.9H9.7\"/>",
  remote: "<rect x=\"2\" y=\"3\" width=\"12\" height=\"8\" rx=\"1.2\"/><path d=\"M6 13.6h4M8 11v2.6\"/>",
  review: "<path d=\"M3.5 2.5h6l3 3v8h-9z\"/><path d=\"M5.8 9l1.5 1.5 3-3.2\"/>",
  run: "<path d=\"M5 3.4v9.2l7-4.6z\"/>",
  rust: "<path class=\"fill\" d=\"M8 2.2 9 3.9l1.9-.5-.3 2 1.8.9-1.3 1.5 1 1.7-2 .2-.6 1.9-1.6-1.2-1.6 1.2-.6-1.9-2-.2 1-1.7L2 7.3l1.8-.9-.3-2 1.9.5z\"/><circle cx=\"8\" cy=\"8\" r=\"1.5\" style=\"fill:var(--bg-side)\"/>",
  scm: "<circle cx=\"4.5\" cy=\"3.6\" r=\"1.7\"/><circle cx=\"4.5\" cy=\"12.4\" r=\"1.7\"/><circle cx=\"11.5\" cy=\"6\" r=\"1.7\"/><path d=\"M4.5 5.3v5.4\"/><path d=\"M11.5 7.7a4 4 0 0 1-4 4h-1.3\"/>",
  search: "<circle cx=\"7\" cy=\"7\" r=\"4.1\"/><path d=\"M10 10l3.6 3.6\"/>",
  settings: "<circle cx=\"8\" cy=\"8\" r=\"2.1\"/><path d=\"M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3\"/>",
  sparkle: "<path d=\"M8 1.8l1.4 4L13.4 7l-4 1.2L8 12.2 6.6 8.2 2.6 7l4-1.2z\" class=\"fill\"/>",
  test: "<path d=\"M6.3 2v3.8L3.4 11a1.1 1.1 0 0 0 1 1.7h7.2a1.1 1.1 0 0 0 1-1.7L9.7 5.8V2\"/><path d=\"M5.4 2h5.2M4.7 9.3h6.6\"/>",
};

export type IconName = keyof typeof PATHS;

/** Return an <svg> string for the named icon (v7 helper, verbatim shape). */
export function svg(name: string, cls = ''): string {
  const p = PATHS[name] ?? PATHS.file;
  return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 16 16">${p}</svg>`;
}

/** Pick the file-type icon by extension (matches v7's colouring via CSS classes). */
export function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const byExt: Record<string, string> = { rs: 'rust', py: 'python', toml: 'settings', lock: 'settings' };
  const n = byExt[ext] ?? 'file';
  return svg(n, n === 'rust' ? 'ic-rust' : n === 'python' ? 'ic-py' : '');
}
