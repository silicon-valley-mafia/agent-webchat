// Tests for web/ui.js (pure UI helpers used by web/app.js), run in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../web/ui.js";

const U = globalThis.AgentUI;

test("escapeAngles: placeholders survive, code and autolinks untouched (#24a)", () => {
  assert.equal(U.escapeAngles('say "run plan <id>" now'), 'say "run plan &lt;id>" now');
  assert.equal(U.escapeAngles("List<String> and a <= b"), "List&lt;String> and a &lt;= b");
  assert.equal(U.escapeAngles("use `run plan <id>` here"), "use `run plan <id>` here");
  assert.equal(U.escapeAngles("x ``a ` <b>`` y <c>"), "x ``a ` <b>`` y &lt;c>");
  assert.equal(U.escapeAngles("see <https://example.com/a?b=1>"), "see <https://example.com/a?b=1>");
  assert.equal(U.escapeAngles("```verilog\nif (a <= b) q <= d;\n```\nafter <x>"), "```verilog\nif (a <= b) q <= d;\n```\nafter &lt;x>");
  assert.equal(U.escapeAngles("~~~\n<keep>\n~~~"), "~~~\n<keep>\n~~~");
  assert.equal(U.escapeAngles("escaped \\<x> stays"), "escaped \\<x> stays");
  assert.equal(U.escapeAngles("> quote stays"), "> quote stays");
  assert.equal(U.escapeAngles("unclosed `tick <y>"), "unclosed `tick &lt;y>");
  assert.equal(U.escapeAngles("no brackets"), "no brackets");
  assert.equal(U.escapeAngles(undefined), undefined);
});

test("letterKey: ignores markdown syntax, link targets, digits and fence info", () => {
  const md = "## Done\n\n1. **Added** [commit 016cce9](https://github.com/x/y/commit/016cce9)\n```js\nx = 1\n```";
  assert.equal(U.letterKey(md), "doneaddedcommitccex");
  assert.equal(U.letterKey("Done\nAdded commit 016cce9\nx = 1"), "doneaddedcommitccex");
  assert.equal(U.letterKey("Größe ändern"), "größeändern");
  assert.equal(U.letterKey("a".repeat(1000)).length, 400);
});

test("matchReply: finds the reply for a rendered bubble, skips used, needs enough overlap", () => {
  const replies = [
    { id: "a", key: U.letterKey("Hello there, the TODO item **#16** was added to the list.") },
    { id: "b", key: U.letterKey("Hello there, the TODO item **#17** was added with copy buttons.") },
    { id: "c", key: U.letterKey("ok") },
  ];
  assert.equal(U.matchReply("Hello there, the TODO item #17 was added with copy buttons.", replies), "b");
  assert.equal(U.matchReply("Hello there, the TODO item #16 was added to the list.", replies), "a");
  assert.equal(U.matchReply("Hello there, the TODO item #16 was added to the list.", replies, { a: true }), "b");
  assert.equal(U.matchReply("ok", replies), "c");
  assert.equal(U.matchReply("Something else entirely", replies), null);
  assert.equal(U.matchReply("1234", replies), null);
});

test("collapsePlan: latest N expanded, older long ones collapsed, manual wins (#19)", () => {
  const ids = ["r1", "r2", "r3", "r4", "r5"];
  const long = { r1: true, r2: true, r3: true, r4: true, r5: true };
  assert.deepEqual(U.collapsePlan(ids, 3, {}, long), { r1: "collapsed", r2: "collapsed", r3: "expanded", r4: "expanded", r5: "expanded" });
  assert.deepEqual(U.collapsePlan(ids, 3, { r1: "expanded", r5: "hidden" }, { ...long, r2: false }),
    { r1: "expanded", r2: "expanded", r3: "expanded", r4: "expanded", r5: "hidden" });
  assert.deepEqual(U.collapsePlan([], 3, {}, {}), {});
});

test("isDuplicate: same text within the window only (#13)", () => {
  const last = { text: "Add TODO #12 ", at: 1000 };
  assert.equal(U.isDuplicate("add todo #12", last, 5000, 30000), true);
  assert.equal(U.isDuplicate("add todo #12", last, 40000, 30000), false);
  assert.equal(U.isDuplicate("add todo #13", last, 5000, 30000), false);
  assert.equal(U.isDuplicate("", last, 5000), false);
  assert.equal(U.isDuplicate("x", null, 5000), false);
});

test("stripMarkdown: readable plain text", () => {
  const md = "# Title\n\n**Bold** and `code` and [link](https://x.y)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n> quoted";
  assert.equal(U.stripMarkdown(md), "Title\n\nBold and code and link (https://x.y)\n\n| a | b |\n\n| 1 | 2 |\nquoted");
});

test("dayIn: per-day folder in a time zone", () => {
  const d = new Date("2026-11-26T20:10:05Z");
  assert.equal(U.dayIn(d, "Asia/Kolkata"), "2026-11-27");
  assert.equal(U.dayIn(d, "UTC"), "2026-11-26");
  assert.equal(U.dayIn(d, "Not/AZone"), "2026-11-26");
});
