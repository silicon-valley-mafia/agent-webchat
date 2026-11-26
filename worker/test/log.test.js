import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetRateLimiter, sessionFolder, messageFile, logPath, joinSession, WRITE_BUDGET } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "test-secret",
  ACCESS_CODE: "open-sesame",
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
  OWNER_NAME: "Deepesh",
};
const FOLDER = "logs/2026-11-27/0140-deepesh--Conv-123-in"; // 20:10Z = 01:40 IST next day
const CONTENTS = "https://api.github.com/repos/silicon-valley-mafia/agent-webchat-logs/contents/";

const ACTS = [
  { id: "c|1", type: "event", name: "startConversation", timestamp: "2026-11-26T20:10:00Z", from: { id: "dl_abc", role: "user" } },
  { id: "c|2", type: "message", text: "hi", timestamp: "2026-11-26T20:10:05Z", from: { id: "dl_abc", role: "user" } },
  { id: "c|3", type: "typing", timestamp: "2026-11-26T20:10:06Z", from: { id: "bot1", name: "GitHub Agent", role: "bot" } },
  {
    id: "c|4", type: "message", text: "Hello! नमस्ते", timestamp: "2026-11-26T20:10:09Z",
    from: { id: "bot1", name: "GitHub Agent", role: "bot" },
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard" } }],
    suggestedActions: { actions: [{ title: "List repos" }] },
  },
  {
    id: "c|5", type: "message", timestamp: "2026-11-26T20:11:00Z", from: { id: "dl_abc", role: "user" },
    attachments: [{ contentType: "application/pdf", name: "spec.pdf", contentUrl: "https://dl.example/att/1" }],
  },
];

let calls, puts, acts;
/** putStatus(path, attempt) -> HTTP status for that PUT */
function mockFetch({ dlStatus = 200, putStatus = () => 201 } = {}) {
  calls = [];
  puts = [];
  const attempts = new Map();
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("/v3/directline/conversations/")) {
      if (dlStatus !== 200) return new Response("x", { status: dlStatus });
      const first = !url.includes("watermark=");
      return Response.json({ activities: first ? acts : [], watermark: "5" });
    }
    if (url.startsWith(CONTENTS)) {
      assert.equal(init.method, "PUT", "logger must never GET/DELETE contents");
      const path = decodeURIComponent(url.slice(CONTENTS.length));
      const n = (attempts.get(path) || 0) + 1;
      attempts.set(path, n);
      const body = JSON.parse(init.body);
      puts.push({ path, body, text: new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))) });
      return new Response("{}", { status: putStatus(path, n) });
    }
    throw new Error("unexpected fetch " + url);
  };
}

function req(body, headers = {}) {
  const h = { Origin: ORIGIN, "X-Access-Code": "open-sesame", "CF-Connecting-IP": "1.2.3.4", "Content-Type": "application/json", ...headers };
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  return new Request("https://w.example/log", { method: "POST", headers: h, body: JSON.stringify(body) });
}

beforeEach(() => {
  _resetRateLimiter();
  acts = ACTS;
  mockFetch();
});

test("log: first save creates the session folder: header + one file per message", async () => {
  const res = await worker.fetch(req({ conversationId: "Conv-123-in", userId: "dl_abc" }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { logged: true, folder: FOLDER, written: 4, total: 3, more: false });
  assert.deepEqual(puts.map((p) => p.path), [
    FOLDER + "/0000-session.md",
    FOLDER + "/0001-014005-user.md",
    FOLDER + "/0002-014009-agent.md",
    FOLDER + "/0003-014100-user.md",
  ]);
  for (const p of puts) {
    assert.equal(p.body.sha, undefined, "create-only: no sha ever sent");
    assert.equal(p.body.branch, "main");
    assert.match(p.body.message, /^log\(deepesh\): 2026-11-27\/0140-deepesh--Conv-123-in /);
  }
  const dl = calls.filter((c) => c.url.includes("directline"));
  assert.equal(dl[0].init.headers.Authorization, "Bearer test-secret");
  const gh = calls.find((c) => c.url.startsWith(CONTENTS));
  assert.equal(gh.init.headers.Authorization, "Bearer gh-token");
});

test("log: file contents are correct and UTF-8 safe", async () => {
  await worker.fetch(req({ conversationId: "Conv-123-in", userId: "dl_abc" }), env);
  const t = Object.fromEntries(puts.map((p) => [p.path.split("/").pop(), p.text]));
  assert.match(t["0000-session.md"], /^# Conversation 2026-11-27 01:40:00 IST/);
  assert.match(t["0000-session.md"], /\| Person \| Deepesh \|/);
  assert.match(t["0000-session.md"], /\| Conversation ID \| `Conv-123-in` \|/);
  assert.match(t["0000-session.md"], /\| User ID \| `dl_abc` \|/);
  assert.equal(t["0001-014005-user.md"], "### 🧑 Deepesh · 01:40:05\n\nhi\n");
  assert.match(t["0002-014009-agent.md"], /^### 🤖 GitHub Agent · 01:40:09\n\nHello! नमस्ते\n/);
  assert.match(t["0002-014009-agent.md"], /adaptive card/);
  assert.match(t["0002-014009-agent.md"], /Suggested: List repos/);
  assert.match(t["0003-014100-user.md"], /📎 \*\*spec\.pdf\*\* \(application\/pdf\) https:\/\/dl\.example\/att\/1/);
  const all = puts.map((p) => p.text).join("\n");
  assert.ok(!all.includes("typing") && !all.includes("startConversation"));
});

test("log: `since` writes only the new messages, no header", async () => {
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in", since: 2 }), env)).json();
  assert.deepEqual(j, { logged: true, folder: FOLDER, written: 1, total: 3, more: false });
  assert.deepEqual(puts.map((p) => p.path), [FOLDER + "/0003-014100-user.md"]);
});

test("log: nothing new -> no writes at all", async () => {
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in", since: 3 }), env)).json();
  assert.deepEqual(j, { logged: true, folder: FOLDER, written: 0, total: 3, more: false });
  assert.equal(puts.length, 0);
});

test("log: since beyond the conversation is clamped", async () => {
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in", since: 99 }), env)).json();
  assert.equal(j.total, 3);
  assert.equal(puts.length, 0);
});

test("log: existing files (422) are skipped, never overwritten", async () => {
  mockFetch({ putStatus: (p) => (p.endsWith("0000-session.md") || p.includes("/0001-") ? 422 : 201) });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.deepEqual(j, { logged: true, folder: FOLDER, written: 2, total: 3, more: false });
  assert.equal(puts.length, 4, "one attempt each, no retries on 422");
});

test("log: replaying from 0 after a lost `since` is idempotent", async () => {
  mockFetch({ putStatus: () => 422 });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.deepEqual(j, { logged: true, folder: FOLDER, written: 0, total: 3, more: false });
});

test("log: 409 (parallel write moved the branch) is retried", async () => {
  mockFetch({ putStatus: (p, n) => (p.includes("/0002-") && n === 1 ? 409 : 201) });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.equal(j.written, 4);
  assert.equal(puts.filter((p) => p.path.includes("/0002-")).length, 2);
});

test("log: persistent 409 -> 502 with progress so far", async () => {
  mockFetch({ putStatus: (p) => (p.includes("/0002-") ? 409 : 201) });
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { logged: false, error: "github_conflict", folder: FOLDER, total: 1 });
});

test("log: github auth failure surfaces status", async () => {
  mockFetch({ putStatus: () => 403 });
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  assert.equal((await res.json()).error, "github_write_403");
});

test("log: long conversation is written in chunks (subrequest budget), `more` tells the client to call again", async () => {
  acts = [];
  for (let i = 0; i < 60; i++) {
    acts.push({ id: "m" + i, type: "message", text: "msg " + i, timestamp: new Date(Date.UTC(2026, 10, 26, 20, 10, i)).toISOString(), from: { id: i % 2 ? "bot" : "dl_abc", role: i % 2 ? "bot" : "user" } });
  }
  const j1 = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.equal(puts.length, WRITE_BUDGET);
  assert.deepEqual([j1.total, j1.more], [WRITE_BUDGET - 1, true]); // header used one write
  mockFetch();
  const j2 = await (await worker.fetch(req({ conversationId: "Conv-123-in", since: j1.total }), env)).json();
  assert.deepEqual([j2.total, j2.more], [60, false]);
  assert.equal(puts[0].path, FOLDER + "/0040-014039-agent.md");
});

test("log: userId falls back to the first user message; bad userId ignored", async () => {
  await worker.fetch(req({ conversationId: "Conv-123-in", userId: "../evil" }), env);
  assert.match(puts[0].text, /\| User ID \| `dl_abc` \|/);
});

test("log: disabled when no token configured (page keeps working)", async () => {
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), { ...env, LOG_REPO_TOKEN: undefined });
  assert.deepEqual(await res.json(), { logged: false, reason: "logging_disabled" });
  assert.equal(calls.length, 0);
});

test("log: conversation with no messages -> empty, nothing written", async () => {
  acts = [ACTS[0]];
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.deepEqual(j, { logged: false, reason: "empty" });
  assert.equal(puts.length, 0);
});

test("log: wrong access code -> 401, nothing read", async () => {
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }, { "X-Access-Code": "nope" }), env);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("log: wrong codes on /log also burn the token rate limit", async () => {
  const e = { ...env, RATE_LIMIT_PER_MIN: "2" };
  for (let i = 0; i < 2; i++) await worker.fetch(req({ conversationId: "x1234" }, { "X-Access-Code": "bad" }), e);
  const tok = await worker.fetch(
    new Request("https://w.example/token", { method: "POST", headers: { Origin: ORIGIN, "X-Access-Code": "open-sesame", "CF-Connecting-IP": "1.2.3.4" } }),
    e
  );
  assert.equal(tok.status, 429);
});

test("log: rejects bad conversation ids (path injection)", async () => {
  for (const id of ["../../etc", "a/b/c/d", "", 42, "x".repeat(300)]) {
    const res = await worker.fetch(req({ conversationId: id }), env);
    assert.equal(res.status, 400, String(id));
  }
  assert.equal(calls.length, 0);
});

test("log: foreign origin -> 403", async () => {
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }, { Origin: "https://evil.example" }), env);
  assert.equal(res.status, 403);
});

test("log: Direct Line failure -> 502", async () => {
  mockFetch({ dlStatus: 403 });
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "directline_error", status: 403 });
});

test("folder / file naming helpers", () => {
  assert.equal(sessionFolder("A|b:c.d", ACTS, 0, "bob"), "logs/2026-11-26/2010-bob--A_b_c_d");
  assert.equal(logPath("A|b:c.d", ACTS, 0, "bob"), "logs/2026-11-26/2010-bob--A_b_c_d.md");
  assert.equal(messageFile(ACTS[1], 12, 0, { name: "Bob" }).name, "0012-201005-user.md");
  assert.equal(messageFile(ACTS[3], 7, 330).name, "0007-014009-agent.md");
});

test("joinSession: header, message count, messages in name order", () => {
  const md = joinSession([
    { name: "0002-x-agent.md", text: "B\n" },
    { name: "0000-session.md", text: "# H\n| Conversation ID | `c1` |\n\n" },
    { name: "0001-x-user.md", text: "A\n" },
  ]);
  assert.equal(md, "# H\n| Conversation ID | `c1` |\n| Messages | 2 |\n\n---\n\nA\n\nB\n");
});

test("health reports logging flag", async () => {
  const h = await worker.fetch(new Request("https://w.example/health"), env);
  assert.deepEqual(await h.json(), { ok: true, configured: true, logging: true, people: 1 });
});
