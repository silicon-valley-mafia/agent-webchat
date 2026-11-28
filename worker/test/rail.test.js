// Session sidebar (TODO #23) and exact time on hover (TODO #36): pure helpers in web/rail.js and web/timestamps.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../web/rail.js";
import "../../web/timestamps.js";

const R = globalThis.AgentRail;
const T = globalThis.AgentTime;

test("rail: snippet makes a one-line title", () => {
  assert.equal(R.snippet("  fix the\n\nlogin   bug  "), "fix the login bug");
  const long = R.snippet("please review the verilog module for the uart transmitter and receiver blocks", 30);
  assert.ok(long.length <= 30 && long.endsWith("…"), long);
  assert.equal(R.snippet(""), "");
});

test("rail: evictions close idle chats first, oldest first, only what doesn't fit", () => {
  const p = [
    { conversationId: "a", working: false, lastAt: 100 },
    { conversationId: "b", working: true, lastAt: 50 },
    { conversationId: "c", working: false, lastAt: 300 },
    { conversationId: "d", working: false, lastAt: 200 },
  ];
  assert.deepEqual(R.evictions(p, 4).map((x) => x.conversationId), ["a"], "4 parked + current = 5 > 4");
  assert.deepEqual(R.evictions(p, 3).map((x) => x.conversationId), ["a", "d"]);
  assert.deepEqual(R.evictions(p, 2).map((x) => x.conversationId), ["a", "d", "c"], "working one survives longest");
  assert.deepEqual(R.evictions(p.slice(0, 2), 4), []);
  assert.ok(R.MAX_LIVE >= 1 && R.MAX_LIVE <= 8);
});

test("rail: sections put the current chat first, then newest; recent excludes live ones", () => {
  const live = [{ conversationId: "x", lastAt: 1 }, { conversationId: "cur", lastAt: 0 }, { conversationId: "y", lastAt: 9 }];
  const recent = [{ conversationId: "y" }, { conversationId: "old1" }, null, { conversationId: "old2" }];
  const s = R.sections(live, recent, "cur");
  assert.deepEqual(s.live.map((x) => x.conversationId), ["cur", "y", "x"]);
  assert.deepEqual(s.recent.map((x) => x.conversationId), ["old1", "old2"]);
});

test("rail: ago and trimMeta", () => {
  const now = 10_000_000;
  assert.equal(R.ago(now - 5000, now), "now");
  assert.equal(R.ago(now - 5 * 60000, now), "5m");
  assert.equal(R.ago(now - 3 * 3600000, now), "3h");
  assert.equal(R.ago(now - 2 * 86400000, now), "2d");
  const m = { a: { at: 3 }, b: { at: 1 }, c: { at: 2 } };
  assert.deepEqual(Object.keys(R.trimMeta(m, 2)).sort(), ["a", "c"], "oldest dropped");
});

test("time: norm ignores Markdown and punctuation", () => {
  assert.equal(T.norm("**Hello**, `world`!"), "helloworld");
  assert.equal(T.norm("run plan <id>"), "runplanid");
});

test("time: match finds the newest unused message from the same side", () => {
  const acts = [
    { id: "1", type: "message", text: "ok", timestamp: "2026-11-27T11:00:00Z", from: { role: "user" } },
    { id: "2", type: "message", text: "**Done** - see [PR](https://x)", timestamp: "2026-11-27T11:00:05Z", from: { role: "bot" } },
    { id: "3", type: "message", text: "ok", timestamp: "2026-11-27T11:01:00Z", from: { role: "user" } },
    { id: "4", type: "typing", timestamp: "2026-11-27T11:01:01Z", from: { role: "bot" } },
    { id: "5", type: "message", text: "pending", from: { role: "user" } },
  ];
  assert.equal(T.match(acts, "Done - see PR", false).id, "2");
  assert.equal(T.match(acts, "ok", true).id, "3", "newest first");
  assert.equal(T.match(acts, "ok", true, { 3: true }).id, "1", "used ones skipped");
  assert.equal(T.match(acts, "ok", false), null, "wrong side");
  assert.equal(T.match(acts, "pending", true), null, "no server timestamp yet");
  assert.equal(T.match(acts, "", true), null);
});

test("time: format gives date, time with seconds and zone", () => {
  const s = T.format("2026-11-27T11:38:08Z", { timeZone: "Asia/Kolkata", locale: "en-GB" });
  assert.match(s, /27 Nov 2026/);
  assert.match(s, /17:08:08/);
  assert.match(s, /GMT\+5:30|IST/);
  assert.equal(T.format("not a date"), "");
});

// TODO #56 / #57 / #58 tests live in gfm.test.js; imported here so the CI test list stays unchanged.
import "./gfm.test.js";
