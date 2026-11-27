
// ---------- Logs 2026-11-28: card clicks (Retry / Deny / submits) are written instead of empty messages ----------
import { clickLabel, messageFile as messageFile62, renderTranscript as renderTranscript62 } from "../src/index.js";

test("logs: Retry / Deny clicks and card submits show in the transcript", () => {
  const u = (value, text) => ({ type: "message", from: { role: "user", id: "dl_x" }, timestamp: "2026-11-27T22:15:24Z", text, value });
  assert.equal(clickLabel(u({ decision: "retry", _dracarys_request_type: "connector_consent" })), "(clicked: Retry)");
  assert.equal(clickLabel(u({ decision: "deny" })), "(clicked: Deny)");
  assert.equal(clickLabel(u({ foo: 1 })), '(card submitted: {"foo":1})');
  assert.equal(clickLabel(u({})), "(card submitted)");
  assert.equal(clickLabel(u(undefined, "hi")), "");
  assert.ok(clickLabel(u({ big: "x".repeat(900) })).length < 530, "capped");
  const f = messageFile62(u({ decision: "retry" }), 16, 330, { name: "Deepesh" });
  assert.match(f.content, /\(clicked: Retry\)/);
  assert.match(f.name, /^0016-\d{6}-user\.md$/);
  const t = messageFile62(u({ decision: "retry" }, "typed text"), 1, 330, { name: "Deepesh" });
  assert.match(t.content, /typed text/);
  assert.ok(!t.content.includes("clicked"), "text wins over the click label");
  const md = renderTranscript62("conv-1", [u({ decision: "deny" })], 330, { name: "Deepesh" });
  assert.match(md, /\(clicked: Deny\)/);
});
