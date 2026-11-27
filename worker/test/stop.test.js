// "Stop showing this response" (TODO #4) + style compat: web/stop.js pure parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../web/stop.js";

const S = globalThis.AgentStop;
const user = (id) => ({ type: "message", id, from: { role: "user" }, text: "q" });
const bot = (id, replyToId) => ({ type: "message", id, replyToId, from: { role: "bot" }, text: "a" });

test("before Stop nothing is hidden", () => {
  const st = S.createState();
  S.onIncoming(st, user("u1"));
  S.onIncoming(st, bot("b1", "u1"));
  assert.equal(S.shouldHide(st, bot("b1", "u1")), false);
});

test("Stop hides later replies to the stopped message and anything until the next send", () => {
  const st = S.createState();
  S.onIncoming(st, user("u1"));
  S.onIncoming(st, bot("b1", "u1")); // progress note already shown
  S.stop(st);
  S.onIncoming(st, bot("b2", "u1"));
  S.onIncoming(st, bot("b3")); // no replyToId, arrives while stopped
  assert.equal(S.shouldHide(st, { id: "b1" }), false, "already shown text stays");
  assert.equal(S.shouldHide(st, { id: "b2" }), true);
  assert.equal(S.shouldHide(st, { id: "b3" }), true);
  S.onUserSend(st);
  S.onIncoming(st, user("u2"));
  S.onIncoming(st, bot("b4", "u2"));
  S.onIncoming(st, bot("b5", "u1")); // late reply to the stopped turn
  assert.equal(S.shouldHide(st, { id: "b4" }), false, "the next turn is shown");
  assert.equal(S.shouldHide(st, { id: "b5" }), true, "late replies to the stopped message stay hidden");
});

test("Stop before the echo of the user message: hides by arrival until the next send", () => {
  const st = S.createState();
  S.stop(st);
  S.onIncoming(st, bot("b1"));
  assert.equal(S.shouldHide(st, { id: "b1" }), true);
});

test("unhide brings everything back", () => {
  const st = S.createState();
  S.onIncoming(st, user("u1"));
  S.stop(st);
  S.onIncoming(st, bot("b1", "u1"));
  S.unhide(st);
  assert.equal(S.shouldHide(st, { id: "b1" }), false);
  S.onIncoming(st, bot("b2", "u1"));
  assert.equal(S.shouldHide(st, { id: "b2" }), false);
});

test("compose runs ours before app.js's middleware; false short-circuits", () => {
  const seen = [];
  const ours = () => (next) => (card) => (card.hide ? false : next(card));
  const app = () => (next) => (card) => { seen.push(card.id); return next(card); };
  const mw = S.compose(ours, app)()((card) => "rendered " + card.id);
  assert.equal(mw({ id: 1 }), "rendered 1");
  assert.equal(mw({ id: 2, hide: true }), false);
  assert.deepEqual(seen, [1]);
  assert.equal(S.compose(ours, undefined), ours);
});

test("compatStyle copies bubbleMaxWidth to the 4.19 options without overriding explicit ones", () => {
  assert.deepEqual(S.compatStyle({ bubbleMaxWidth: 900, accent: "x" }),
    { bubbleMaxWidth: 900, accent: "x", bubbleMessageMaxWidth: 900, bubbleAttachmentMaxWidth: 900 });
  assert.equal(S.compatStyle({ bubbleMaxWidth: 900, bubbleMessageMaxWidth: 500 }).bubbleMessageMaxWidth, 500);
  const o = { accent: "y" };
  assert.equal(S.compatStyle(o), o);
  assert.equal(S.compatStyle(undefined), undefined);
});
