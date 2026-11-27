import test from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/template.js";

test("escaping, paths, missing and raw", () => {
  const data = { user: { name: "<b>Jo & \"Ana\"</b>", id: 0 }, html: "<i>ok</i>", n: 3 };
  assert.equal(render("Hi {{ user.name }}!", data), "Hi &lt;b&gt;Jo &amp; &quot;Ana&quot;&lt;/b&gt;!");
  assert.equal(render("{{user.id}}/{{n}}/{{missing}}/{{user.x.y}}", data), "0/3//");
  assert.equal(render("{{{html}}} vs {{html}}", data), "<i>ok</i> vs &lt;i&gt;ok&lt;/i&gt;");
  assert.equal(render("it's {{q}}", { q: "'" }), "it's &#39;");
});
