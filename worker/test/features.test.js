import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetRateLimiter, identify, people, slugify, SESSION_RE } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "test-secret",
  ACCESS_CODE: "owner-code",
  OWNER_NAME: "Deepesh",
  ACCESS_CODES: JSON.stringify({ "friend-code": "Ravi Kumar", "boss-code": { name: "Asha", admin: true } }),
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
};

const ACTS = [
  { id: "c|1", type: "message", text: "hi", timestamp: "2026-11-26T20:10:05Z", from: { id: "dl_u1", role: "user" } },
  { id: "c|2", type: "message", text: "hello", timestamp: "2026-11-26T20:10:09Z", from: { id: "bot1", name: "GitHub Agent", role: "bot" } },
];

const TREE = {
  truncated: false,
  tree: [
    { path: "README.md", type: "blob" },
    { path: "logs", type: "tree" },
    { path: "logs/2026-11-27", type: "tree" },
    { path: "logs/2026-11-27/0140-deepesh--ConvA", type: "tree" },
    { path: "logs/2026-11-27/0140-deepesh--ConvA/0000-session.md", type: "blob" },
    { path: "logs/2026-11-27/0140-deepesh--ConvA/0001-014005-user.md", type: "blob" },
    { path: "logs/2026-11-27/0140-deepesh--ConvA/0002-014009-agent.md", type: "blob" },
    { path: "logs/2026-11-27/0905-ravi-kumar--ConvB/0000-session.md", type: "blob" },
    { path: "logs/2026-11-27/0905-ravi-kumar--ConvB/0001-090501-user.md", type: "blob" },
    { path: "logs/2026-11-26/2300-asha--ConvC/0000-session.md", type: "blob" },
    { path: "logs/2026-11-26/old-format-file.md", type: "blob" },
    { path: "logs/2026-11-26/2300-asha--ConvC/notes.txt", type: "blob" },
  ],
};

const GQL_FILES = [
  { name: "0002-014009-agent.md", type: "blob", object: { text: "### 🤖 Agent · 01:40:09\n\nhello\n" } },
  { name: "0000-session.md", type: "blob", object: { text: "# Conversation\n\n| Conversation ID | `ConvB` |\n" } },
  { name: "0001-014005-user.md", type: "blob", object: { text: "### 🧑 Ravi Kumar · 01:40:05\n\nhi\n" } },
];

let calls;
function mock(over = {}) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (over[url]) return over[url]();
    if (url.endsWith("/tokens/generate")) return Response.json({ token: "tok", expires_in: 3600, conversationId: "newconv" });
    if (/\/v3\/directline\/conversations\/[^/]+$/.test(url)) return Response.json({ conversationId: "ConvA", token: "resumed-tok", expires_in: 3600, streamUrl: "wss://x" });
    if (url.includes("/activities")) return Response.json({ activities: url.includes("watermark") ? [] : ACTS, watermark: "2" });
    if (url.includes("/git/trees/")) return Response.json(TREE);
    if (url === "https://api.github.com/graphql") return Response.json({ data: { repository: { object: { entries: GQL_FILES } } } });
    if (url.includes("/contents/") && init.method === "PUT") return new Response("{}", { status: 201 });
    throw new Error("unexpected " + url);
  };
}

function req(path, code, body) {
  return new Request("https://w.example" + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "X-Access-Code": code, "CF-Connecting-IP": "9.9.9.9", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  _resetRateLimiter();
  mock();
});

// ---- people / access codes ----

test("people: owner + JSON codes, slugs", () => {
  const p = people(env);
  assert.deepEqual(p.map((x) => [x.name, x.slug, x.admin]), [
    ["Deepesh", "deepesh", true],
    ["Ravi Kumar", "ravi-kumar", false],
    ["Asha", "asha", true],
  ]);
  assert.equal(slugify("  Émile -- O'Neil!! "), "mile-o-neil");
  assert.equal(slugify(""), "user");
  assert.equal(slugify("x".repeat(40)).length, 24);
});

test("identify: each code maps to its person; wrong code -> null", async () => {
  assert.equal((await identify(env, "friend-code")).name, "Ravi Kumar");
  assert.equal((await identify(env, "owner-code")).admin, true);
  assert.equal(await identify(env, "nope"), null);
  assert.equal(await identify(env, ""), null);
});

test("ACCESS_CODES alone (no ACCESS_CODE) is a valid configuration", async () => {
  const e = { ...env, ACCESS_CODE: undefined };
  const res = await worker.fetch(req("/token", "friend-code"), e);
  assert.equal(res.status, 200);
});

test("malformed ACCESS_CODES JSON is ignored, owner still works", async () => {
  const e = { ...env, ACCESS_CODES: "{not json" };
  assert.equal(people(e).length, 1);
  assert.equal((await worker.fetch(req("/token", "owner-code"), e)).status, 200);
  assert.equal((await worker.fetch(req("/token", "friend-code"), e)).status, 401);
});

test("token: returns the person's name and puts it in the Direct Line user", async () => {
  const j = await (await worker.fetch(req("/token", "friend-code"), env)).json();
  assert.equal(j.name, "Ravi Kumar");
  assert.equal(j.admin, false);
  assert.deepEqual(JSON.parse(calls[0].init.body).user.name, "Ravi Kumar");
});

test("log: each person's sessions get their own folder under the day", async () => {
  const j = await (await worker.fetch(req("/log", "friend-code", { conversationId: "ConvA" }), env)).json();
  assert.equal(j.folder, "logs/2026-11-27/0140-ravi-kumar--ConvA");
  const putUrls = calls.filter((c) => c.init.method === "PUT").map((c) => decodeURIComponent(c.url.split("/contents/")[1]));
  assert.deepEqual(putUrls, [
    "logs/2026-11-27/0140-ravi-kumar--ConvA/0000-session.md",
    "logs/2026-11-27/0140-ravi-kumar--ConvA/0001-014005-user.md",
    "logs/2026-11-27/0140-ravi-kumar--ConvA/0002-014009-agent.md",
  ]);
  const put = calls.find((c) => c.init.method === "PUT");
  const md = new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(put.init.body).content), (c) => c.charCodeAt(0)));
  assert.match(md, /\| Person \| Ravi Kumar \|/);
  assert.match(JSON.parse(put.init.body).message, /^log\(ravi-kumar\): /);
  // a second person's session the same day lands in a sibling folder
  mock();
  const k = await (await worker.fetch(req("/log", "boss-code", { conversationId: "ConvZ" }), env)).json();
  assert.equal(k.folder, "logs/2026-11-27/0140-asha--ConvZ");
});

// ---- resume ----

test("resume: reconnects with the SECRET and returns a fresh token", async () => {
  const res = await worker.fetch(req("/resume", "owner-code", { conversationId: "ConvA" }), env);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.token, "resumed-tok");
  assert.equal(j.conversationId, "ConvA");
  assert.equal(j.domain, "https://directline.botframework.com/v3/directline");
  assert.equal(calls[0].url, "https://directline.botframework.com/v3/directline/conversations/ConvA");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-secret");
  assert.ok(!JSON.stringify(j).includes("test-secret"));
});

test("resume: expired conversation -> 410 conversation_expired", async () => {
  mock({ "https://directline.botframework.com/v3/directline/conversations/Gone1": () => new Response("x", { status: 404 }) });
  const res = await worker.fetch(req("/resume", "owner-code", { conversationId: "Gone1" }), env);
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, "conversation_expired");
});

test("resume: bad id -> 400, nothing called", async () => {
  const res = await worker.fetch(req("/resume", "owner-code", { conversationId: "../x/y" }), env);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("resume shares the token rate-limit bucket", async () => {
  const e = { ...env, RATE_LIMIT_PER_MIN: "2" };
  await worker.fetch(req("/token", "owner-code"), e);
  await worker.fetch(req("/resume", "owner-code", { conversationId: "ConvA" }), e);
  assert.equal((await worker.fetch(req("/token", "owner-code"), e)).status, 429);
});

// ---- export ----

test("export: returns markdown + filename, writes nothing", async () => {
  const j = await (await worker.fetch(req("/export", "owner-code", { conversationId: "ConvA" }), env)).json();
  assert.match(j.markdown, /🧑 Deepesh · 01:40:05\n\nhi/);
  assert.equal(j.filename, "2026-11-27_0140-deepesh--ConvA.md");
  assert.ok(!calls.some((c) => c.url.startsWith("https://api.github.com/")));
});

test("export works even when logging is disabled", async () => {
  const res = await worker.fetch(req("/export", "owner-code", { conversationId: "ConvA" }), { ...env, LOG_REPO_TOKEN: undefined });
  assert.equal(res.status, 200);
});

// ---- history ----

test("history: one item per session folder, newest first, message counts, ignores stray files", async () => {
  const j = await (await worker.fetch(req("/history", "owner-code"), env)).json();
  assert.deepEqual(j.items, [
    { path: "logs/2026-11-27/0905-ravi-kumar--ConvB", date: "2026-11-27", time: "09:05", person: "ravi-kumar", messages: 1 },
    { path: "logs/2026-11-27/0140-deepesh--ConvA", date: "2026-11-27", time: "01:40", person: "deepesh", messages: 2 },
    { path: "logs/2026-11-26/2300-asha--ConvC", date: "2026-11-26", time: "23:00", person: "asha", messages: 0 },
  ]);
  assert.match(calls[0].url, /\/git\/trees\/main\?recursive=1$/);
});

test("history: non-admin sees only their own", async () => {
  const j = await (await worker.fetch(req("/history", "friend-code"), env)).json();
  assert.deepEqual(j.items.map((i) => i.person), ["ravi-kumar"]);
});

test("history: empty log repo -> empty list", async () => {
  mock({
    "https://api.github.com/repos/silicon-valley-mafia/agent-webchat-logs/git/trees/main?recursive=1": () => new Response("{}", { status: 409 }),
  });
  const j = await (await worker.fetch(req("/history", "owner-code"), env)).json();
  assert.deepEqual(j.items, []);
});

test("history: logging disabled -> empty list with reason", async () => {
  const j = await (await worker.fetch(req("/history", "owner-code"), { ...env, LOG_REPO_TOKEN: undefined })).json();
  assert.deepEqual(j, { items: [], reason: "logging_disabled" });
});

// ---- transcript ----

test("transcript: whole session folder read in ONE GraphQL call and joined in order", async () => {
  const j = await (await worker.fetch(req("/transcript", "owner-code", { path: "logs/2026-11-27/0905-ravi-kumar--ConvB" }), env)).json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/graphql");
  const q = JSON.parse(calls[0].init.body);
  assert.deepEqual(q.variables, { o: "silicon-valley-mafia", n: "agent-webchat-logs", e: "main:logs/2026-11-27/0905-ravi-kumar--ConvB" });
  assert.equal(calls[0].init.headers.Authorization, "Bearer gh-token");
  assert.equal(j.files, 3);
  assert.equal(
    j.markdown,
    "# Conversation\n\n| Conversation ID | `ConvB` |\n| Messages | 2 |\n\n---\n\n### 🧑 Ravi Kumar · 01:40:05\n\nhi\n\n### 🤖 Agent · 01:40:09\n\nhello\n"
  );
});

test("transcript: missing folder -> 404", async () => {
  mock({ "https://api.github.com/graphql": () => Response.json({ data: { repository: { object: null } } }) });
  const res = await worker.fetch(req("/transcript", "owner-code", { path: "logs/2026-11-27/0905-ravi-kumar--Nope" }), env);
  assert.equal(res.status, 404);
});

test("transcript: non-admin cannot read someone else's session", async () => {
  const res = await worker.fetch(req("/transcript", "friend-code", { path: "logs/2026-11-27/0140-deepesh--ConvA" }), env);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("transcript: path traversal / non-session paths rejected", async () => {
  for (const path of ["../secrets", "logs/2026-11-27/../../x", "README.md", "logs/2026-11-27/0140-deepesh--A/B",
    "logs/2026-11-27/0140-deepesh--ConvA/0001-014005-user.md", "logs/2026-11-27/0140-deepesh--ConvA.md", 5]) {
    const res = await worker.fetch(req("/transcript", "owner-code", { path }), env);
    assert.equal(res.status, 400, String(path));
  }
  assert.equal(calls.length, 0);
});

test("SESSION_RE matches session folders only", () => {
  assert.ok(SESSION_RE.test("logs/2026-11-27/0140-deepesh--Conv-123-in"));
  assert.ok(!SESSION_RE.test("logs/2026-11-27/0140-deepesh--Conv-123-in.md"));
  assert.ok(!SESSION_RE.test("logs/2026-11-27/0140-Conv-123-in"));
});

// ---- guards apply to every new endpoint ----

test("every POST endpoint rejects wrong code, foreign origin and GET", async () => {
  for (const p of ["/resume", "/export", "/history", "/transcript"]) {
    _resetRateLimiter();
    mock();
    assert.equal((await worker.fetch(req(p, "nope", {}), env)).status, 401, p);
    const foreign = new Request("https://w.example" + p, { method: "POST", headers: { Origin: "https://evil.example", "X-Access-Code": "owner-code" } });
    assert.equal((await worker.fetch(foreign, env)).status, 403, p);
    const get = new Request("https://w.example" + p, { headers: { Origin: ORIGIN } });
    assert.equal((await worker.fetch(get, env)).status, 405, p);
    assert.equal(calls.length, 0, p);
  }
});

test("wrong codes on api endpoints burn the token bucket", async () => {
  const e = { ...env, RATE_LIMIT_PER_MIN: "2" };
  await worker.fetch(req("/history", "x1"), e);
  await worker.fetch(req("/export", "x2", { conversationId: "ConvA" }), e);
  assert.equal((await worker.fetch(req("/token", "owner-code"), e)).status, 429);
});

test("health reports people count", async () => {
  const h = await (await worker.fetch(new Request("https://w.example/health"), env)).json();
  assert.deepEqual(h, { ok: true, configured: true, logging: true, people: 3 });
});
