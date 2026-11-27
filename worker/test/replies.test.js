// Batch A step 0: the per-reply tools moved from web/app.js to web/replies.js (no behaviour change).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../web/replies.js", import.meta.url), "utf8");

function load() {
  const session = new Map();
  const window = {};
  const ctx = vm.createContext({
    window,
    sessionStorage: { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)) },
    document: { createElement: () => ({}), body: { appendChild() {} } },
    navigator: {},
    setTimeout, clearTimeout,
  });
  vm.runInContext(src, ctx, { filename: "replies.js" });
  return { window, session };
}

function make(current) {
  const { window, session } = load();
  const jsonGet = (store, key, d) => { try { return JSON.parse(store.getItem(key) || "null") || d; } catch (e) { return d; } };
  const R = window.AgentReplies({
    U: null, K: { collapse: "agentCollapse:" }, el: {}, jsonGet, PREVIEW_PX: 140, KEEP_EXPANDED: 3,
    current: () => current.s, button: () => ({}),
  });
  return { R, session };
}

test("replies.js exposes the same functions app.js used before the split", () => {
  const { R } = make({ s: null });
  for (const k of ["rememberReply", "decorate", "scheduleDecorate", "setAll", "copyText"]) assert.equal(typeof R[k], "function", k);
});

test("rememberReply keeps one entry per activity id and updates its text", () => {
  const { R } = make({ s: null });
  const s = { replies: [], replyIndex: {} };
  R.rememberReply(s, { id: "a1", text: "one", timestamp: "t" });
  R.rememberReply(s, { id: "a1", text: "one, edited" });
  R.rememberReply(s, { id: "a2", text: "two" });
  assert.equal(s.replies.length, 2);
  assert.equal(s.replyIndex.a1.text, "one, edited");
});

test("decorate only touches the chat on screen (ctx.current)", () => {
  const holder = { s: null };
  const { R } = make(holder);
  let queried = 0;
  const s = { mount: { querySelectorAll: () => { queried++; return []; } }, replies: [], replyIndex: {}, conversationId: "c" };
  R.decorate(s);
  assert.equal(queried, 0, "not current -> no DOM work");
  holder.s = s;
  R.decorate(s);
  assert.equal(queried, 1);
});

test("setAll stores the state for every decorated reply in sessionStorage", () => {
  const holder = { s: null };
  const { R, session } = make(holder);
  const b = { __awId: "a1" };
  const s = { mount: { querySelectorAll: () => [b] }, replies: [], replyIndex: {}, conversationId: "c9" };
  R.setAll(s, "collapsed");
  assert.deepEqual(JSON.parse(session.get("agentCollapse:c9")), { a1: "collapsed" });
});
