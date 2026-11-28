// TODO #56 / #58: GitHub-style Markdown renderer for prompts + History, copy button text (web/gfm.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function load(cfg = {}, extra = {}) {
  const window = { AGENT_WEBCHAT_CONFIG: cfg, ...extra };
  vm.runInContext(fs.readFileSync(new URL("../../web/gfm.js", import.meta.url), "utf8"),
    vm.createContext({ window, String, Array, RegExp, parseInt, setTimeout: () => 0 }), { filename: "gfm.js" });
  return window;
}
const G = load().AgentGfm;
const r = (md) => G.render(md);

test("headings, paragraphs, emphasis, strikethrough, inline code", () => {
  assert.equal(r("# Title"), "<h1>Title</h1>");
  assert.equal(r("### Three ###"), "<h3>Three</h3>");
  assert.equal(r("**bold** and *it* and _it2_ and ~~gone~~"), "<p><strong>bold</strong> and <em>it</em> and <em>it2</em> and <del>gone</del></p>");
  assert.equal(r("use `a < b && *c*` here"), "<p>use <code>a &lt; b &amp;&amp; *c*</code> here</p>");
  assert.equal(r("snake_case_name stays"), "<p>snake_case_name stays</p>");
  assert.equal(r("line 1\nline 2"), "<p>line 1<br>\nline 2</p>", "single newline = line break, like GitHub comments");
  assert.equal(r("a\n\nb"), "<p>a</p>\n<p>b</p>");
  assert.equal(r("**a**\nb"), "<p><strong>a</strong><br>\nb</p>");
});

test("raw HTML and script stay escaped; only http(s)/mailto links", () => {
  assert.equal(r("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal(r('<img src=x onerror="alert(1)">'), "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  assert.ok(!r("[x](javascript:alert(1))").includes("href"), "javascript: link is not a link");
  assert.equal(r("[GitHub](https://github.com \"home\")"),
    '<p><a href="https://github.com" target="_blank" rel="noopener noreferrer nofollow" title="home">GitHub</a></p>');
  assert.ok(!r("![pic](https://evil.example/x.png)").includes("<img"), "images are never loaded");
  assert.ok(r("![pic](https://evil.example/x.png)").includes("\uD83D\uDDBC pic"));
});

test("autolinks: <url>, bare https:// and www.", () => {
  assert.equal(r("see https://example.com/a_b."), '<p>see <a href="https://example.com/a_b" target="_blank" rel="noopener noreferrer nofollow">https://example.com/a_b</a>.</p>');
  assert.ok(r("go www.github.com now").includes('href="https://www.github.com"'));
  assert.ok(r("<https://x.org/?q=1&r=2>").includes('href="https://x.org/?q=1&amp;r=2"'));
});

test("tables with alignment, inline code with a pipe, missing cells", () => {
  const html = r("| Name | Size | Note |\n|:--|--:|:-:|\n| a | 1 | `x\\|y` |\n| b | 22 |");
  assert.equal(html,
    '<table><thead><tr><th align="left">Name</th><th align="right">Size</th><th align="center">Note</th></tr></thead>' +
    '<tbody><tr><td align="left">a</td><td align="right">1</td><td align="center"><code>x|y</code></td></tr>' +
    '<tr><td align="left">b</td><td align="right">22</td><td align="center"></td></tr></tbody></table>');
  assert.equal(r("a | b\n--|--\n1 | 2"), "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  assert.equal(r("not | a table"), "<p>not | a table</p>");
});

test("lists: bullets, ordered with start, nested, task list, loose", () => {
  assert.equal(r("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(r("3. x\n4. y"), '<ol start="3"><li>x</li><li>y</li></ol>');
  assert.equal(r("- a\n  - a1\n  - a2\n- b"), "<ul><li>a\n<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>");
  assert.equal(r("1. one\n   - sub\n2. two"), "<ol><li>one\n<ul><li>sub</li></ul></li><li>two</li></ol>");
  assert.equal(r("- [ ] todo\n- [x] done"),
    '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> todo</li>' +
    '<li class="task-list-item"><input type="checkbox" disabled checked> done</li></ul>');
  assert.equal(r("- a\n\n- b"), "<ul><li><p>a</p></li><li><p>b</p></li></ul>");
  assert.equal(r("- a\n\npara"), "<ul><li>a</li></ul>\n<p>para</p>");
  assert.equal(r("text\n- item"), "<p>text</p>\n<ul><li>item</li></ul>");
});

test("code fences: language, exact content, unclosed fence, ~~~", () => {
  assert.equal(r("```bash\necho \"<hi>\" && ls\n\tx\n```"),
    '<pre data-lang="bash"><code class="language-bash">echo &quot;&lt;hi&gt;&quot; &amp;&amp; ls\n    x\n</code></pre>');
  assert.equal(r("~~~\n# not a heading\n~~~"), "<pre><code># not a heading\n</code></pre>");
  assert.equal(r("```\nopen"), "<pre><code>open\n</code></pre>");
  assert.equal(r("- step\n\n  ```json\n  {\"a\": 1}\n  ```"), '<ul><li><p>step</p>\n<pre data-lang="json"><code class="language-json">{&quot;a&quot;: 1}\n</code></pre></li></ul>');
});

test("blockquote, hr, nested quote content", () => {
  assert.equal(r("> **note**\n> more"), "<blockquote><p><strong>note</strong><br>\nmore</p></blockquote>");
  assert.equal(r("a\n\n---\n\nb"), "<p>a</p>\n<hr>\n<p>b</p>");
  assert.equal(r("> - x\n> - y"), "<blockquote><ul><li>x</li><li>y</li></ul></blockquote>");
});

test("History mode drops <details>/<summary> lines and keeps the transcript header table", () => {
  const md = "# Conversation\n\n| | |\n|---|---|\n| Conversation ID | `abc` |\n\n<details>\n<summary>Activity</summary>\n\nbody\n</details>";
  const html = G.render(md, { history: true });
  assert.ok(html.includes("<td>Conversation ID</td><td><code>abc</code></td>"));
  assert.ok(!html.includes("&lt;details"));
  assert.ok(html.includes('<p class="aw-summary"><strong>Activity</strong></p>'));
});

test("prompts: session header folded, route line as chip, body rendered", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(G.splitPrompt("[session header]\nDeepesh\n[end of header]\n\n[route: coach]\nhi **x**"))),
    { header: "Deepesh", route: "coach", body: "hi **x**" });
  const html = G.renderPrompt("[session header]\nH <1>\n[end of header]\n\n[route: coach]\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.ok(html.startsWith('<details class="aw-hdr"><summary>session header</summary><pre><code>H &lt;1&gt;</code></pre></details>'));
  assert.ok(html.includes('<div class="aw-routechip">\u27a1 route: coach</div>'));
  assert.ok(html.includes("<table>"));
  assert.equal(G.renderPrompt("plain"), "<p>plain</p>");
});

test("#58 codeText: copies exactly the code (tabs, <, &, trailing newline), never the button", () => {
  const code = { textContent: "a\t<b> & c\n" };
  assert.equal(G.codeText({ querySelector: (s) => (s === "code" ? code : null) }), "a\t<b> & c\n");
  const btn = { classList: { contains: (c) => c === "aw-codecopy" }, textContent: "Copy" };
  const txt = { textContent: "x = 1\n" };
  assert.equal(G.codeText({ querySelector: () => null, childNodes: [btn, txt] }), "x = 1\n");
});

test("History renderer swap and off switch", () => {
  const md = { renderMarkdown: (s) => "basic:" + s };
  const on = load({}, { AgentMarkdown: { ...md } });
  assert.equal(on.AgentMarkdown.renderMarkdown("**a**"), '<div class="aw-md"><p><strong>a</strong></p></div>');
  assert.equal(on.AgentMarkdown.renderMarkdownBasic("x"), "basic:x");
  const off = load({ gfmMarkdown: false }, { AgentMarkdown: { ...md } });
  assert.equal(off.AgentMarkdown.renderMarkdown("x"), "basic:x");
  assert.equal(typeof off.AgentGfm.render, "function", "helpers still exported");
});

// TODO #57: posting time next to "... ago" (web/timestamps.js short()).
function loadTime(cfg = {}) {
  const window = { AGENT_WEBCHAT_CONFIG: cfg };
  vm.runInContext(fs.readFileSync(new URL("../../web/timestamps.js", import.meta.url), "utf8"),
    vm.createContext({ window, String, Date, Intl, Object, isNaN }), { filename: "timestamps.js" });
  return window.AgentTime;
}
const T = loadTime();

test("#57 short time: today = time only, other day = weekday date + time, other year adds the year", () => {
  const o = { timeZone: "Asia/Kolkata", locale: "en-GB", now: "2026-11-27T22:00:00Z" };
  assert.equal(T.short("2026-11-27T21:35:00Z", { ...o, timeFormat: "24h" }), "03:05", "03:05 IST on 28 Nov = today in IST");
  assert.equal(T.short("2026-11-27T11:38:08Z", { ...o, timeFormat: "24h" }), "Fri 27 Nov, 17:08");
  assert.match(T.short("2026-11-27T11:38:08Z", { ...o, timeFormat: "12h" }), /^Fri 27 Nov, 0?5:08\s?pm$/i);
  assert.equal(T.short("2025-12-31T06:00:00Z", { ...o, timeFormat: "24h" }), "Wed 31 Dec 2025, 11:30");
  assert.equal(T.short("nope", o), "");
});

test("#57 mode: both is the default; relative / absolute kept", () => {
  assert.equal(T.mode, "both");
  assert.equal(loadTime({ timestampMode: "relative" }).mode, "relative");
  assert.equal(loadTime({ timestampMode: "absolute" }).mode, "absolute");
});

test("#57 match: an attachment-only bubble gets the newest attachment-only message", () => {
  const acts = [
    { id: "1", type: "message", text: "", attachments: [{}], timestamp: "2026-11-27T11:00:00Z", from: { role: "user" } },
    { id: "2", type: "message", text: "hello", timestamp: "2026-11-27T11:00:05Z", from: { role: "user" } },
    { id: "3", type: "message", attachments: [{}], timestamp: "2026-11-27T11:01:00Z", from: { role: "user" } },
  ];
  assert.equal(T.match(acts, "", true).id, "3");
  assert.equal(T.match(acts, " ", true, { 3: true }).id, "1");
  assert.equal(T.match(acts, "", false), null);
});
