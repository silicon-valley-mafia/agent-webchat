
// ---------- #37b fix 2026-11-28: the agent's AI never sees channelData, so the route is also a visible text line ----------
import fs37 from "node:fs";
import vm37 from "node:vm";

test("#37b fix: [route: coach] line in the text; Copy / Reuse strip it", () => {
  const ctx = { console, AGENT_WEBCHAT_CONFIG: { routeToggle: false } };
  ctx.window = ctx;
  vm37.createContext(ctx);
  vm37.runInContext(fs37.readFileSync(new URL("../../web/route.js", import.meta.url), "utf8"), ctx);
  const R = ctx.AgentRoute;
  const a = { type: "message", text: "hello" };
  const both = JSON.parse(JSON.stringify(R.tag(a, "coach", "both")));
  assert.equal(both.text, "[route: coach]\nhello");
  assert.equal(both.channelData.awRoute, "coach");
  assert.equal(R.tag({ type: "message" }, "coach", "both").text, "[route: coach]", "attachment-only message");
  assert.equal(R.tag(a, "coach", "channelData").text, "hello");
  assert.equal(R.tag(a, "coach").text, "hello", "pure call without a mode = channelData only (as before)");
  assert.equal(R.tag({ type: "message", text: "x", channelData: { awRoute: "coach" } }, "coach", "both").text, "x", "never twice");
  const c = { console, AGENT_WEBCHAT_CONFIG: { copyPrompt: false } };
  c.window = c;
  vm37.createContext(c);
  vm37.runInContext(fs37.readFileSync(new URL("../../web/copyprompt.js", import.meta.url), "utf8"), c);
  const strip = c.AgentCopyPrompt.stripHeader;
  assert.equal(strip("[route: coach]\nhello"), "hello");
  assert.equal(strip("[session header]\nH\n[end of header]\n\n[route: coach]\nhello"), "hello");
  assert.equal(strip("plain"), "plain");
});
