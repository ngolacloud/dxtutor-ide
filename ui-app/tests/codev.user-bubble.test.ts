import { describe, expect, it } from "vitest";
import { userHtml } from "../src/features/codev/ui/chat-view";

describe("bolha do humano (userHtml)", () => {
  it("texto simples fica igual ao escape de sempre", () => {
    expect(userHtml("olá <b>mundo</b> & co")).toBe("olá &lt;b&gt;mundo&lt;/b&gt; &amp; co");
  });
  it("mantém as quebras de linha (a bolha é pre-wrap)", () => {
    expect(userHtml("linha 1\nlinha 2\n\nlinha 4")).toBe("linha 1\nlinha 2\n\nlinha 4");
  });
  it("blocos ``` viram <pre> sem crases, com o conteúdo escapado", () => {
    const t = "This command failed.\n\n$ ls /x\n(exit 2)\n\n```\nls: cannot access '/x'\n<tag>\n```\n\nRelated:";
    expect(userHtml(t)).toBe("This command failed.\n\n$ ls /x\n(exit 2)\n<pre>ls: cannot access &#39;/x&#39;\n&lt;tag&gt;</pre>\nRelated:");
  });
  it("aceita a linguagem no bloco e vários blocos", () => {
    expect(userHtml("a\n```rust\nfn x() {}\n```\nb\n```\ny\n```")).toBe("a<pre>fn x() {}</pre>b<pre>y</pre>");
  });
});
