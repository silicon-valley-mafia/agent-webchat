// End-of-turn detection (TODO #42) and the activity trace: web/turns.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../web/turns.js";

const T = globalThis.AgentTurn;
const bot = (extra = {}) => ({ type: "message", from: { role: "bot" }, text: "hi", ...extra });

test("final reply: inputHint acceptingInput / expectingInput", () => {
  const s = {};
  assert.equal(T.kind(bot({ inputHint: "acceptingInput" }), s), "final");
  assert.equal(T.kind(bot({ inputHint: "expectingInput" }), {}), "final");
  assert.equal(s.awHints, true, "the conversation is marked as one whose agent sends hints");
});

test("progress notes: ignoringInput, streamType informative/streaming", () => {
  assert.equal(T.kind(bot({ inputHint: "ignoringInput" }), {}), "interim");
  assert.equal(T.kind(bot({ channelData: { streamType: "informative" } }), {}), "interim");
  assert.equal(T.kind(bot({ channelData: { streamType: "streaming" }, inputHint: "acceptingInput" }), {}), "interim");
});

test("no hint: unknown (old behaviour) until the agent has shown hints, then interim", () => {
  const s = {};
  assert.equal(T.kind(bot(), s), "unknown", "agent that never sends hints is never stuck in 'working'");
  assert.equal(T.kind(bot({ inputHint: "acceptingInput" }), s), "final");
  assert.equal(T.kind(bot(), s), "interim", "Microsoft's example: progress notes carry no inputHint");
  assert.equal(T.kind(bot({ channelData: { streamType: "final" }, inputHint: "acceptingInput" }), s), "final");
  assert.equal(T.kind(null, s), "unknown");
});

test("trace keeps metadata only (never the text), capped at 100", () => {
  const mw = T.traceMiddleware()((a) => a);
  mw({ type: "DIRECT_LINE/INCOMING_ACTIVITY", payload: { activity: bot({ text: "secret plans", inputHint: "acceptingInput", replyToId: "u1",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive" }], channelData: { streamType: "informative", streamId: "x", streamSequence: 2 } }) } });
  mw({ type: "WEB_CHAT/SEND_MESSAGE", payload: { text: "ignored" } });
  const t = T.trace();
  const e = t.at(-1);
  assert.equal(e.inputHint, "acceptingInput");
  assert.equal(e.streamType, "informative");
  assert.equal(e.streamSequence, 2);
  assert.equal(e.replyToId, "u1");
  assert.equal(e.textLength, 12);
  assert.equal(e.attachments, "application/vnd.microsoft.card.adaptive");
  assert.ok(!JSON.stringify(t).includes("secret plans"));
  for (let i = 0; i < 150; i++) T.record(bot({ type: "typing" }));
  assert.equal(T.trace().length, 100);
  assert.ok(Object.keys(T.summary()).some((k) => k.startsWith("typing")));
});

test("install wraps WebChat.createStore once and keeps app middleware", () => {
  const seen = [];
  const W = { createStore: (initial, ...mws) => ({ mws: mws.length, run: (a) => mws.map((m) => m({})).reduceRight((n, m) => m(n), (x) => seen.push(x.type))(a) }) };
  assert.equal(T.install(W), true);
  assert.equal(T.install(W), false, "second install is a no-op");
  const st = W.createStore({}, () => (n) => (a) => n(a));
  assert.equal(st.mws, 2);
  st.run({ type: "DIRECT_LINE/INCOMING_ACTIVITY", payload: { activity: bot({ inputHint: "expectingInput" }) } });
  assert.deepEqual(seen, ["DIRECT_LINE/INCOMING_ACTIVITY"]);
  assert.equal(T.trace().at(-1).inputHint, "expectingInput");
});

// ---------------- TODO #55: every Microsoft-standard end-of-turn / streaming signal ----------------
const typing = (extra = {}) => ({ type: "typing", from: { role: "bot" }, ...extra });

test("#55 bug fix: streamType final ends the turn even without inputHint, after hints were seen", () => {
  const s = {};
  assert.equal(T.kind(bot({ inputHint: "acceptingInput" }), s), "final");
  assert.equal(T.kind(bot(), s), "interim", "plain note after hints = progress (#42 rule kept)");
  assert.equal(T.kind(bot({ channelData: { streamType: "final", streamId: "s1" } }), s), "final", "was interim before #55 (120 s stuck)");
});

test("#55 stream info is read from entities[type=streaminfo] too", () => {
  const s = {};
  const e = (streamType, streamId) => ({ entities: [{ type: "other" }, { type: "streaminfo", streamType, streamId }] });
  assert.equal(T.kind(bot(e("streaming", "x")), s), "interim");
  assert.equal(T.kind(bot(e("final", "x")), s), "final");
  assert.deepEqual(T.streamInfo(bot(e("informative", "y"))), { type: "informative", id: "y" });
  assert.deepEqual(T.streamInfo(bot()), { type: "", id: "" });
});

test("#55 an open stream keeps hint-less messages interim until its final arrives", () => {
  const s = {};
  assert.equal(T.kind(bot({ channelData: { streamType: "streaming", streamId: "a" } }), s), "interim");
  assert.equal(T.kind(bot(), s), "interim", "stream a still open");
  assert.equal(T.kind(bot({ channelData: { streamType: "final", streamId: "a" } }), s), "final");
  assert.deepEqual(s.awStreams, {});
  const s2 = {};
  T.kind(bot({ channelData: { streamType: "streaming", streamId: "b" } }), s2);
  assert.equal(T.kind(bot({ channelData: { streamType: "final" } }), s2), "final", "final without id closes all");
  assert.deepEqual(s2.awStreams, {});
  assert.equal(T.kind(bot(), {}), "unknown", "agents that never stream or hint: old behaviour");
});

test("#55 typing: informative / streaming typing is interim; plain typing stays 'typing'", () => {
  const s = {};
  assert.equal(T.kind(typing({ channelData: { streamType: "informative", streamId: "t1" } }), s), "interim");
  assert.equal(s.awStreams.t1, true);
  assert.equal(T.kind(typing(), {}), "typing");
  assert.equal(T.kind(typing({ inputHint: "acceptingInput" }), {}), "typing", "typing never ends a turn");
});

test("#55 endOfConversation ends the turn", () => {
  assert.equal(T.kind({ type: "endOfConversation", from: { role: "bot" } }, {}), "end");
});

test("#55 trace records stream info from entities", () => {
  T.record(bot({ entities: [{ type: "streaminfo", streamType: "streaming", streamId: "z" }] }));
  const e = T.trace().at(-1);
  assert.equal(e.streamType, "streaming");
  assert.equal(e.streamId, "z");
});
