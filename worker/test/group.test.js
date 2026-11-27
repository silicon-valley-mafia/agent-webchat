// Experimental group chat (TODO #43): pure helpers in web/group.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../web/group.js";

const G = globalThis.AgentGroup;
const m = (id, extra = {}) => ({ agent: { id, name: id.toUpperCase() }, ...extra });

test("targets: all live members, or only the chosen agent", () => {
  const ms = [m("github"), m("coach"), m("relay", { failed: "403" })];
  assert.deepEqual(G.targets(ms, "all").map((x) => x.agent.id), ["github", "coach"], "failed members are skipped");
  assert.deepEqual(G.targets(ms).map((x) => x.agent.id), ["github", "coach"]);
  assert.deepEqual(G.targets(ms, "coach").map((x) => x.agent.id), ["coach"]);
  assert.deepEqual(G.targets(ms, "relay"), [], "a failed agent gets nothing");
  assert.deepEqual(G.targets(null, "all"), []);
});

test("toggle: add / remove, never more than max", () => {
  let p = [];
  p = G.toggle(p, "a", 2); p = G.toggle(p, "b", 2); p = G.toggle(p, "c", 2);
  assert.deepEqual(p, ["a", "b"], "third agent refused at max 2");
  p = G.toggle(p, "a", 2);
  assert.deepEqual(p, ["b"]);
  const orig = ["x"]; G.toggle(orig, "y", 4);
  assert.deepEqual(orig, ["x"], "input not mutated");
  assert.ok(G.MAX >= 2 && G.MAX <= 6);
});

test("settleAfter: progress notes keep working (grace), final/unknown close after the quiet period", () => {
  assert.equal(G.settleAfter("final"), 3000);
  assert.equal(G.settleAfter("unknown"), 3000);
  assert.equal(G.settleAfter("interim"), 120000);
});

test("markdown: prompts with each agent's replies under them", () => {
  const g = {
    id: "gabc", at: Date.UTC(2026, 10, 27, 11, 0, 0),
    prompts: [{ at: Date.UTC(2026, 10, 27, 11, 1, 0), text: "hello", to: "all" }, { at: Date.UTC(2026, 10, 27, 11, 2, 0), text: "only you", to: "coach" }],
    members: [
      m("github", { conversationId: "c1", log: [{ prompt: 0, text: "hi from gh", ms: 1500 }] }),
      m("coach", { conversationId: "c2", log: [{ prompt: 0, text: "hi from coach", ms: 2500 }, { prompt: 1, text: "", attachments: 1, ms: null }] })
    ]
  };
  const md = G.markdown(g);
  assert.match(md, /^# Group chat gabc/);
  assert.match(md, /GITHUB \(`c1`\), COACH \(`c2`\)/);
  assert.match(md, /## 1\. You \(\d\d:\d\d:\d\d\)\n\nhello/);
  assert.match(md, /### GITHUB \(first reply after 1\.5 s\)\n\nhi from gh/);
  assert.match(md, /## 2\. You \(\d\d:\d\d:\d\d, to coach\)/);
  assert.match(md, /_\(no text: 1 attachment\(s\)\)_/);
  assert.ok(md.indexOf("hi from gh") < md.indexOf("hi from coach"), "agents in column order");
  assert.ok(md.lastIndexOf("GITHUB") < md.indexOf("## 2."), "github has no reply to prompt 2, so no heading");
});
