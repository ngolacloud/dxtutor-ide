import { expect, test } from "vitest";
import { changedFromDisk, withDiskEol } from "../src/platform/desktop/eol";

/* RF-E06 (docs/v2/RF-DELONIX-PLANO.md F2.5): the editor's textarea always gives LF; the
   autosave must not turn a CRLF file into LF, nor write a file whose only "change" is that. */

test("um ficheiro CRLF continua CRLF depois de uma tecla no editor", () => {
  const disk = "a\r\nb\r\nc\r\n";
  expect(withDiskEol(disk, "a\nB\nc\n")).toBe("a\r\nB\r\nc\r\n");
  expect(changedFromDisk(disk, "a\nB\nc\n")).toBe(true);
});

test("só os fins de linha diferentes não é mudança; LF e ficheiros novos ficam como estão", () => {
  expect(changedFromDisk("a\r\nb\r\n", "a\nb\n")).toBe(false);
  expect(withDiskEol("a\nb\n", "a\nX\n")).toBe("a\nX\n");
  expect(withDiskEol(undefined, "new\n")).toBe("new\n");
  expect(changedFromDisk(undefined, "")).toBe(true);
  // content that already carries CR (pasted, or from the backend) is not doubled
  expect(withDiskEol("a\r\n", "a\r\nb\r\n")).toBe("a\r\nb\r\n");
});
