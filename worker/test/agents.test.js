// Multi-agent + per-person agent rights (TODO #11 / #20 / #7): worker/src/main.js and web/agents.js helpers.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { agentRegistry, personRules, allowedAgents, pickAgent } from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";
import "../../web/agents.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "secret-github",
  DEFAULT_AGENT_ID: "github",
  DEFAULT_AGENT_NAME: "GitHub Agent",
  DEFAULT_AGENT_INITIALS: "GH",
  DL_SECRET_PLAN: "secret-plan",
  AGENTS: JSON.stringify({
    coach: { name: "VLSI Coach", description: "Study help", initials: "VC", secret: "secret-coach" },
    planner: { name: "Planner", secretName: "DL_SECRET_PLAN" },
    nosecret: { name: "Not configured" },
    "Bad Id!": { name: "x", secret: "s" },
  }),
  ACCESS_CODE: "owner-code",
  OWNER_NAME: "Deepesh",
  ACCESS_CODES: JSON.stringify({
    "ravi-code": { name: "Ravi", agents: ["coach"], defaultAgent: "coach" },
    "asha-code": "Asha",
    "star-code": { name: "Star", agents: ["*"], defaultAgent: "planner" },
  }),
  RATE_LIMIT_PER_MIN: "100",
  API_RATE_LIMIT_PER_MIN: "100",
};

let calls;
beforeEach(() => {
  _resetRateLimiter();
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers && init.headers.Authorization });
    return new Response(JSON.stringify({ token: "tok", expires_in: 3600, conversationId: "conv-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

function req(path, { code = "owner-code", agent, method = "POST", body, origin = ORIGIN } = {}) {
  const headers = { Origin: origin, "CF-Connecting-IP": "1.2.3.4" };
  if (code !== null) headers["X-Access-Code"] = code;
  if (agent) headers["X-Agent"] = agent;
  if (body) headers["Content-Type"] = "application/json";
  return new Request("https://w.example" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

test("registry: default agent first, AGENTS added, entries without a secret or with bad ids skipped", () => {
  const reg = agentRegistry(env);
  assert.deepEqual(reg.map((a) => a.id), ["github", "coach", "planner"]);
  assert.equal(reg[0].secret, "secret-github");
  assert.equal(reg[2].secret, "secret-plan");
  assert.deepEqual(agentRegistry({ DIRECTLINE_SECRET: "s" }).map((a) => a.id), ["default"]);
  assert.deepEqual(agentRegistry({ DIRECTLINE_SECRET: "s", AGENTS: "not json" }).length, 1);
});

test("rules: owner/admin and plain-name codes get every agent; lists restrict; '*' means all", () => {
  const reg = agentRegistry(env);
  const all = (code, person) => allowedAgents(reg, personRules(env, code, person)).map((a) => a.id);
  assert.deepEqual(all("owner-code", { admin: true }), ["github", "coach", "planner"]);
  assert.deepEqual(all("asha-code", { admin: false }), ["github", "coach", "planner"]);
  assert.deepEqual(all("ravi-code", { admin: false }), ["coach"]);
  assert.deepEqual(all("star-code", { admin: false }), ["github", "coach", "planner"]);
  const r = personRules(env, "star-code", { admin: false });
  assert.equal(pickAgent(reg, allowedAgents(reg, r), r, "").agent.id, "planner");
  assert.equal(pickAgent(reg, [], r, "github").error, "agent_not_allowed");
  assert.equal(pickAgent(reg, reg, r, "ghost").error, "unknown_agent");
  assert.equal(pickAgent(reg, reg, r, "../x").error, "bad_agent");
});

test("/agents lists only the agents a code may use, never secrets", async () => {
  let res = await worker.fetch(req("/agents", { code: "ravi-code" }), env);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!/secret-/.test(text));
  const j = JSON.parse(text);
  assert.deepEqual(j.agents, [{ id: "coach", name: "VLSI Coach", description: "Study help", initials: "VC" }]);
  assert.equal(j.default, "coach");
  assert.equal(j.person, "Ravi");
  res = await worker.fetch(req("/agents"), env);
  assert.deepEqual((await res.json()).agents.map((a) => a.id), ["github", "coach", "planner"]);
  assert.equal((await worker.fetch(req("/agents", { code: "nope" }), env)).status, 401);
  assert.equal((await worker.fetch(req("/agents", { origin: "https://evil.example" }), env)).status, 403);
  assert.equal(calls.length, 0);
});

test("/token uses the chosen agent's Direct Line secret and reports the agent", async () => {
  const res = await worker.fetch(req("/token", { agent: "coach" }), env);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.agent, { id: "coach", name: "VLSI Coach", initials: "VC" });
  assert.equal(j.token, "tok");
  assert.equal(calls[0].auth, "Bearer secret-coach");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("no X-Agent header: owner gets the default agent, a restricted user gets their own default", async () => {
  let j = await (await worker.fetch(req("/token"), env)).json();
  assert.equal(j.agent.id, "github");
  assert.equal(calls[0].auth, "Bearer secret-github");
  j = await (await worker.fetch(req("/token", { code: "ravi-code" }), env)).json();
  assert.equal(j.agent.id, "coach");
  assert.equal(calls[1].auth, "Bearer secret-coach");
});

test("a code can't reach an agent it isn't allowed, even by setting the header", async () => {
  const res = await worker.fetch(req("/token", { code: "ravi-code", agent: "github" }), env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "agent_not_allowed" });
  assert.equal((await worker.fetch(req("/token", { agent: "ghost" }), env)).status, 400);
  assert.equal(calls.length, 0);
});

test("/resume and /export reach the conversation's agent", async () => {
  let res = await worker.fetch(req("/resume", { agent: "planner", body: { conversationId: "conv-1" } }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).agent.id, "planner");
  assert.equal(calls[0].auth, "Bearer secret-plan");
  res = await worker.fetch(req("/export", { agent: "coach", body: { conversationId: "conv-1" } }), env);
  assert.equal(res.status, 200);
  assert.ok(calls.slice(1).every((c) => c.auth === "Bearer secret-coach"));
});

test("errors still come from index.js: bad code 401, foreign origin 403, preflight allows X-Agent", async () => {
  assert.equal((await worker.fetch(req("/token", { code: "nope", agent: "coach" }), env)).status, 401);
  assert.equal((await worker.fetch(req("/token", { origin: "https://evil.example" }), env)).status, 403);
  const pre = await worker.fetch(req("/token", { method: "OPTIONS" }), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /X-Access-Code/);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /X-Agent/);
  assert.equal(calls.length, 0);
});

test("single-agent setup behaves exactly as before; AGENTS-only setup still works", async () => {
  const one = { ALLOWED_ORIGINS: ORIGIN, DIRECTLINE_SECRET: "s1", ACCESS_CODE: "c" };
  const j = await (await worker.fetch(req("/token", { code: "c" }), one)).json();
  assert.equal(j.agent.id, "default");
  assert.equal(calls[0].auth, "Bearer s1");
  const only = { ALLOWED_ORIGINS: ORIGIN, ACCESS_CODE: "c", AGENTS: JSON.stringify({ a: { name: "A", secret: "sa" } }) };
  const k = await (await worker.fetch(req("/token", { code: "c" }), only)).json();
  assert.equal(k.agent.id, "a");
  assert.equal(calls[1].auth, "Bearer sa");
  const h = await (await worker.fetch(req("/health", { method: "GET" }), env)).json();
  assert.equal(h.agents, 3);
  assert.equal(h.configured, true);
});

test("history / transcript / artifact routes are untouched by the agent layer", async () => {
  const res = await worker.fetch(req("/history"), env);
  assert.equal(res.status, 200);
});

test("web/agents.js: request routing helpers", () => {
  const A = globalThis.AgentAgents;
  const base = "https://w.example";
  assert.equal(A.pathOf(base + "/token", base), "/token");
  assert.equal(A.pathOf(base + "/artifact/put?x=1", base), "/artifact/put");
  assert.equal(A.pathOf("https://other/token", base), "");
  assert.equal(A.convOf(JSON.stringify({ conversationId: "c1", since: 2 })), "c1");
  assert.equal(A.convOf("{bad"), "");
  const ids = ["github", "coach"];
  const map = { c1: "coach", c2: "removed" };
  assert.equal(A.agentFor("/token", "", map, "coach", ids), "coach", "new chat -> picked agent");
  assert.equal(A.agentFor("/token", "", map, "gone", ids), "github", "picked agent no longer allowed -> first");
  assert.equal(A.agentFor("/resume", "c1", map, "github", ids), "coach", "resume -> the conversation's agent");
  assert.equal(A.agentFor("/log", "c9", map, "coach", ids), "github", "unknown (older) conversation -> first agent");
  assert.equal(A.agentFor("/log", "c2", map, "coach", ids), "github");
  assert.equal(A.agentFor("/token", "", map, "coach", null), "", "no agent list -> no header");
  const m = {};
  for (let i = 0; i < 305; i++) A.remember(m, "c" + i, "github");
  assert.equal(Object.keys(m).length, 300);
  assert.ok(!("c0" in m) && "c304" in m);
});
