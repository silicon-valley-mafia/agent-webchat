// Per-agent transcript folders (TODO #44): logs/<num>/<day>/<HHMM>-<person>--<conversation>, logs/<num>/AGENT.md.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { agentRegistry, folderNum } from "../src/main.js";
import { _resetRateLimiter, parseSession, sessionFolder, sessionHeader, agentNote, agentNum, SESSION_RE } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const CONTENTS = "https://api.github.com/repos/silicon-valley-mafia/agent-webchat-logs/contents/";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "secret-github",
  DEFAULT_AGENT_ID: "github",
  DEFAULT_AGENT_NAME: "GitHub Agent",
  AGENTS: JSON.stringify({
    coach: { name: "VLSI Coach", secret: "secret-coach", num: 2 },
    planner: { name: "Planner", secret: "secret-plan" },
  }),
  ACCESS_CODE: "owner-code",
  OWNER_NAME: "Deepesh",
  ACCESS_CODES: JSON.stringify({ "ravi-code": { name: "Ravi", agents: ["coach"] } }),
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
  RATE_LIMIT_PER_MIN: "100",
  API_RATE_LIMIT_PER_MIN: "100",
};
const ACTS = [
  { id: "1", type: "message", text: "hi", timestamp: "2026-11-27T11:30:05Z", from: { id: "dl_abc", role: "user" } },
  { id: "2", type: "message", text: "hello", timestamp: "2026-11-27T11:30:09Z", from: { id: "bot", name: "VLSI Coach", role: "bot" } },
];

let puts, dlAuth, tree;
beforeEach(() => {
  _resetRateLimiter();
  puts = [];
  dlAuth = [];
  tree = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes("/v3/directline/conversations/")) {
      dlAuth.push(init.headers.Authorization);
      return Response.json({ activities: url.includes("watermark=") ? [] : ACTS, watermark: "2" });
    }
    if (url.startsWith(CONTENTS)) {
      const body = JSON.parse(init.body);
      puts.push({ path: decodeURIComponent(url.slice(CONTENTS.length)), message: body.message, text: new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))) });
      return new Response("{}", { status: 201 });
    }
    if (url.includes("/git/trees/")) return Response.json({ tree });
    if (url.includes("/graphql")) return Response.json({ data: { repository: { object: { entries: [{ name: "0000-session.md", type: "blob", object: { text: "# H\n" } }] } } } });
    throw new Error("unexpected fetch " + url);
  };
});

function req(path, body, { code = "owner-code", agent } = {}) {
  const headers = { Origin: ORIGIN, "X-Access-Code": code, "CF-Connecting-IP": "1.2.3.4", "Content-Type": "application/json" };
  if (agent) headers["X-Agent"] = agent;
  return new Request("https://w.example" + path, { method: "POST", headers, body: JSON.stringify(body || {}) });
}

test("registry numbers: default 1, explicit num kept, missing num = lowest free, duplicates fixed", () => {
  const nums = (e) => Object.fromEntries(agentRegistry(e).map((a) => [a.id, a.num]));
  assert.deepEqual(nums(env), { github: 1, coach: 2, planner: 3 });
  assert.deepEqual(nums({ ...env, AGENTS: JSON.stringify({ a: { secret: "x", num: 5 }, b: { secret: "y" }, c: { secret: "z", num: 1 } }) }), { github: 1, a: 5, b: 2, c: 3 });
  assert.deepEqual(nums({ DIRECTLINE_SECRET: "s", DEFAULT_AGENT_NUM: "7" }), { default: 7 });
  assert.deepEqual(nums({ AGENTS: JSON.stringify({ only: { secret: "x" } }) }), { only: 2 });
  assert.equal(folderNum("0"), null);
  assert.equal(folderNum(1000), null);
  assert.equal(folderNum("12"), 12);
});

test("/log with X-Agent writes into logs/<num>/ and names the folder once (AGENT.md)", async () => {
  const res = await worker.fetch(req("/log", { conversationId: "Conv-9-in", userId: "dl_abc" }, { agent: "coach" }), env);
  const j = await res.json();
  assert.equal(res.status, 200);
  const folder = "logs/2/2026-11-27/1700-deepesh--Conv-9-in";
  assert.deepEqual(j, { logged: true, folder, written: 3, total: 2, more: false });
  assert.deepEqual(puts.map((p) => p.path), [folder + "/0000-session.md", "logs/2/AGENT.md", folder + "/0001-170005-user.md", folder + "/0002-170009-agent.md"]);
  assert.equal(dlAuth[0], "Bearer secret-coach");
  assert.match(puts[0].text, /\| Agent \| VLSI Coach \(`coach`\) · folder `logs\/2\/` \|/);
  assert.match(puts[1].text, /^# logs\/2\/ = VLSI Coach/);
  assert.match(puts[1].text, /\| Agent id \| `coach` \|/);
  assert.match(puts[0].message, /^log\(deepesh\): 2\/2026-11-27\/1700-deepesh--Conv-9-in start$/);
});

test("/log without X-Agent = the person's default agent (folder 1); `since` > 0 writes no header / AGENT.md", async () => {
  let j = await (await worker.fetch(req("/log", { conversationId: "Conv-9-in" }), env)).json();
  assert.equal(j.folder, "logs/1/2026-11-27/1700-deepesh--Conv-9-in");
  assert.ok(puts.some((p) => p.path === "logs/1/AGENT.md"));
  puts = [];
  j = await (await worker.fetch(req("/log", { conversationId: "Conv-9-in", since: 1 }, { agent: "planner" }), env)).json();
  assert.equal(j.folder, "logs/3/2026-11-27/1700-deepesh--Conv-9-in");
  assert.deepEqual(puts.map((p) => p.path), ["logs/3/2026-11-27/1700-deepesh--Conv-9-in/0002-170009-agent.md"]);
});

test("AGENT.md already there (422) or failing never blocks the transcript", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).endsWith("/AGENT.md") ? new Response("{}", { status: 500 }) : orig(url, init));
  const j = await (await worker.fetch(req("/log", { conversationId: "Conv-9-in" }, { agent: "coach" }), env)).json();
  assert.equal(j.logged, true);
  assert.equal(j.total, 2);
});

test("/export filename carries the folder number", async () => {
  const j = await (await worker.fetch(req("/export", { conversationId: "Conv-9-in" }, { agent: "coach" }), env)).json();
  assert.equal(j.filename, "2_2026-11-27_1700-deepesh--Conv-9-in.md");
});

test("parseSession reads both layouts; SESSION_RE (old) is unchanged", () => {
  assert.deepEqual(parseSession("logs/2026-11-27/0140-deepesh--Conv-1"), { num: null, date: "2026-11-27", hm: "0140", person: "deepesh", conv: "Conv-1" });
  assert.deepEqual(parseSession("logs/12/2026-11-27/0140-ravi--C-2"), { num: 12, date: "2026-11-27", hm: "0140", person: "ravi", conv: "C-2" });
  assert.equal(parseSession("logs/1234/2026-11-27/0140-ravi--C-2"), null);
  assert.equal(parseSession("logs/2/AGENT.md"), null);
  assert.equal(parseSession("logs/../2026-11-27/0140-x--y"), null);
  assert.ok(SESSION_RE.test("logs/2026-11-27/0140-deepesh--Conv-1"));
  assert.ok(!SESSION_RE.test("logs/1/2026-11-27/0140-deepesh--Conv-1"));
});

test("history lists old and numbered folders together, newest first, with the agent number", async () => {
  tree = [
    { type: "blob", path: "logs/2026-11-27/0900-deepesh--Old-1/0000-session.md" },
    { type: "blob", path: "logs/2026-11-27/0900-deepesh--Old-1/0001-090000-user.md" },
    { type: "blob", path: "logs/2/2026-11-27/1700-deepesh--New-2/0000-session.md" },
    { type: "blob", path: "logs/2/2026-11-27/1700-deepesh--New-2/0001-170000-user.md" },
    { type: "blob", path: "logs/2/2026-11-27/1700-deepesh--New-2/0002-170001-agent.md" },
    { type: "blob", path: "logs/2/AGENT.md" },
    { type: "blob", path: "logs/1/2026-11-26/2300-ravi--R-1/0000-session.md" },
    { type: "blob", path: "logs/AGENTS.md" },
  ];
  const j = await (await worker.fetch(req("/history"), env)).json();
  assert.deepEqual(j.items, [
    { path: "logs/2/2026-11-27/1700-deepesh--New-2", date: "2026-11-27", time: "17:00", person: "deepesh", messages: 2, agent: 2 },
    { path: "logs/2026-11-27/0900-deepesh--Old-1", date: "2026-11-27", time: "09:00", person: "deepesh", messages: 1 },
    { path: "logs/1/2026-11-26/2300-ravi--R-1", date: "2026-11-26", time: "23:00", person: "ravi", messages: 0, agent: 1 },
  ]);
  const r = await (await worker.fetch(req("/history", {}, { code: "ravi-code" }), env)).json();
  assert.deepEqual(r.items.map((i) => i.path), ["logs/1/2026-11-26/2300-ravi--R-1"], "non-admins see only their own");
});

test("transcript accepts numbered folders and keeps the per-person check", async () => {
  let res = await worker.fetch(req("/transcript", { path: "logs/2/2026-11-27/1700-deepesh--New-2" }), env);
  assert.equal(res.status, 200);
  res = await worker.fetch(req("/transcript", { path: "logs/2/2026-11-27/1700-deepesh--New-2" }, { code: "ravi-code" }), env);
  assert.equal(res.status, 403);
  res = await worker.fetch(req("/transcript", { path: "logs/2/AGENT.md" }), env);
  assert.equal(res.status, 400);
});

test("helpers without an agent keep the old layout (index.js alone)", () => {
  assert.equal(agentNum({}), null);
  assert.equal(agentNum({ LOG_AGENT_NUM: "3" }), 3);
  assert.equal(sessionFolder("C-1", ACTS, 330, "bob"), "logs/2026-11-27/1700-bob--C-1");
  assert.equal(sessionFolder("C-1", ACTS, 330, "bob", 4), "logs/4/2026-11-27/1700-bob--C-1");
  assert.ok(!/\| Agent \|/.test(sessionHeader("C-1", ACTS, 330, { name: "Bob" }, "dl_x")));
  assert.match(agentNote({ num: 4, id: "x", name: "X" }, ACTS, 330), /First conversation logged \| 2026-11-27 17:00:05 IST/);
});
