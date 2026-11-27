// TODO #37b: "➡ Pass on to Coach" - AGENTS "routes" + web/route.js marks messages with channelData.awRoute.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker, { agentRegistry, publicAgent } from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "s",
  DEFAULT_AGENT_ID: "github",
  ACCESS_CODE: "owner-code",
  AGENTS: JSON.stringify({
    spark: { name: "SPARK", initials: "SP", num: 2, secret: "s2", routes: ["coach", "Bad Id!"] },
    coach: { name: "VLSI Coach", initials: "VC", num: 4, secret: "s4" },
  }),
};
beforeEach(() => _resetRateLimiter());

test("registry keeps valid routes; /agents shows routes only for agents that have them", async () => {
  const reg = agentRegistry(env);
  assert.deepEqual(reg.find((a) => a.id === "spark").routes, ["coach"]);
  assert.deepEqual(publicAgent(reg.find((a) => a.id === "coach")), { id: "coach", name: "VLSI Coach", description: "", initials: "VC" });
  const r = await worker.fetch(new Request("https://w.example/agents", { method: "POST", headers: { Origin: ORIGIN, "X-Access-Code": "owner-code", "CF-Connecting-IP": "3.3.3.3" } }), env);
  const j = await r.json();
  assert.deepEqual(j.agents.find((a) => a.id === "spark").routes, ["coach"]);
  assert.equal(j.agents.find((a) => a.id === "github").routes, undefined);
});

function page(cfg) {
  const store = new Map();
  const window = {
    AGENT_WEBCHAT_CONFIG: cfg,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    WebChat: {
      // minimal redux-like store: middlewares in order, the last next() records the action
      createStore(initial, ...mws) {
        const sent = [];
        const api = { getState: () => ({ activities: [] }), dispatch: (a) => chain(a) };
        const chain = mws.map((m) => m(api)).reduceRight((next, mw) => mw(next), (a) => { sent.push(a); return a; });
        return { sent, dispatch: (a) => chain(a), getState: api.getState };
      },
    },
  };
  vm.runInContext(fs.readFileSync(new URL("../../web/route.js", import.meta.url), "utf8"), vm.createContext({ window, Object, JSON, Array, setInterval() {} }), { filename: "route.js" });
  return window;
}
const post = (text, channelData) => ({ type: "DIRECT_LINE/POST_ACTIVITY", meta: {}, payload: { activity: { type: "message", text, channelData } } });

test("web/route.js: messages carry awRoute only while the toggle is on for that chat", () => {
  const w = page({});
  const s = w.WebChat.createStore({}, (api) => (next) => (a) => next(a)); // app.js-like middleware after ours
  w.__agentWebchat = { cur: () => ({ store: s, conversationId: "C1" }) };
  s.dispatch(post("one"));
  assert.equal(s.sent[0].payload.activity.channelData, undefined, "off by default");
  w.AgentRoute.set("C1", "coach");
  s.dispatch(post("two"));
  assert.equal(s.sent[1].payload.activity.channelData.awRoute, "coach");
  s.dispatch(post("three", { awRoute: "other" }));
  assert.equal(s.sent[2].payload.activity.channelData.awRoute, "other", "never overrides");
  s.dispatch({ type: "DIRECT_LINE/POST_ACTIVITY", payload: { activity: { type: "event", name: "startConversation" } } });
  assert.equal(s.sent[3].payload.activity.channelData, undefined, "events untouched");
  w.AgentRoute.set("C1", "");
  s.dispatch(post("four"));
  assert.equal(s.sent[4].payload.activity.channelData, undefined);
});

test("web/route.js: state is per conversation and survives reload (localStorage)", () => {
  const w = page({});
  w.AgentRoute.set("C1", "coach");
  w.AgentRoute.set("C2", "");
  assert.equal(w.AgentRoute.get("C1"), "coach");
  assert.equal(w.AgentRoute.get("C2"), "");
  assert.equal(JSON.parse(w.localStorage.getItem("agentRoute")).C1, "coach");
  assert.equal(w.AgentRoute.convOf({ activities: [{ type: "typing" }, { conversation: { id: "C9" } }] }), "C9");
});

test("web/route.js: routeToggle:false leaves createStore alone", () => {
  const w = page({ routeToggle: false });
  const s = w.WebChat.createStore({});
  w.AgentRoute.set("C1", "coach");
  w.__agentWebchat = { cur: () => ({ store: s, conversationId: "C1" }) };
  s.dispatch(post("x"));
  assert.equal(s.sent[0].payload.activity.channelData, undefined);
});
