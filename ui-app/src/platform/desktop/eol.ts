/* ═════════ desktop — the file's line ending survives the editor (RF-E06, F2.5) ═════════
   The editor is a <textarea>, whose value always uses LF: typing one key in a CRLF file would
   save it back as LF (every line changed). Before writing, the content goes back to the line
   ending the file has on disk; a difference made only of line endings is no change at all.
   PURE. */

/** The content to write for a file whose disk content is `disk` (or `undefined`: new file). */
export function withDiskEol(disk: string | undefined, next: string): string {
  if (disk === undefined || !disk.includes("\r\n") || next.includes("\r")) return next;
  return next.replace(/\n/g, "\r\n");
}

/** Whether `next` (from the editor) really differs from `disk`, beyond line endings. */
export function changedFromDisk(disk: string | undefined, next: string): boolean {
  if (disk === undefined) return true;
  return withDiskEol(disk, next) !== disk;
}
