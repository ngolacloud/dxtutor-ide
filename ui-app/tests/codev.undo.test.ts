import { expect, test } from "vitest";
import { codevUndo } from "../src/app/codev-undo";

/* RF-E07 (docs/v2/RF-DELONIX-PLANO.md F2.6): Ctrl+Z undoes Co-Dev's last block — exactly the text
   from before it — while the human has not typed in the file since. */

test("um passo por alteração, por ficheiro; escrever esquece-o", () => {
  codevUndo.setRel((k) => k.replace(/^proj\//, ""));
  codevUndo.remember("src/a.rs", "v1");
  codevUndo.remember("src/a.rs", "v1"); // two hunks of one change before the reload: one step
  codevUndo.remember("src/a.rs", "v2");
  expect(codevUndo.take("proj/src/a.rs")).toBe("v2");
  expect(codevUndo.take("proj/src/a.rs")).toBe("v1");
  expect(codevUndo.take("proj/src/a.rs")).toBeNull();
  codevUndo.remember("src/b.rs", "b0");
  codevUndo.forget("proj/src/b.rs");
  expect(codevUndo.take("proj/src/b.rs")).toBeNull();
});
