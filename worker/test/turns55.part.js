
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
