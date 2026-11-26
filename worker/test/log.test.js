import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetRateLimiter, renderTranscript, logPath, b64utf8 } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "test-secret",
  ACCESS_CODE: "open-sesame",
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  GITHUB_LOG_TOKEN: "gh-token",
  OWNER_NAME: "Deepesh",
};

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

let calls, gh;
function mockFetch({ dlStatus = 200, getStatus = 404, existing = null, putStatuses = [201] } = {}) {
  calls = [];
  gh = { puts: [] };
  let putIdx = 0;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("/v3/directline/conversations/")) {
      if (dlStatus !== 200) return new Response("x", { status: dlStatus });
      const wm = url.includes("watermark=") ? null : "5";
      return Response.json({ activities: wm ? ACTS : [], watermark: wm || "5" });
    }
    if (url.startsWith("https://api.github.com/")) {
      if ((init.method || "GET") === "GET") {
        if (getStatus === 200) return Response.json({ sha: "abc123", content: existing });
        return new Response("{}", { status: getStatus });
      }
      gh.puts.push(JSON.parse(init.body));
      const st = putStatuses[Math.min(putIdx++, putStatuses.length - 1)];
      return new Response("{}", { status: st });
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
  mockFetch();
});

test("log: reads conversation with the SECRET and creates the file", async () => {
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.logged, true);
  assert.equal(j.changed, true);
  assert.equal(j.path, "logs/2026-11-27/0140-deepesh--Conv-123-in.md"); // 20:10Z = 01:40 IST next day
  const dl = calls.filter((c) => c.url.includes("directline"));
  assert.equal(dl[0].init.headers.Authorization, "Bearer test-secret");
  assert.equal(gh.puts.length, 1);
  assert.equal(gh.puts[0].sha, undefined);
  const ghCall = calls.find((c) => c.url.startsWith("https://api.github.com/"));
  assert.equal(ghCall.init.headers.Authorization, "Bearer gh-token");
  assert.match(ghCall.url, /repos\/silicon-valley-mafia\/agent-webchat-logs\/contents\/logs\/2026-11-27\/0140-deepesh--Conv-123-in\.md$/);
});

test("log: transcript content is correct and UTF-8 safe", async () => {
  await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  const md = new TextDecoder().decode(Uint8Array.from(atob(gh.puts[0].content), (c) => c.charCodeAt(0)));
  assert.match(md, /🧑 Deepesh · 01:40:05\n\nhi/);
  assert.match(md, /\| Person \| Deepesh \|/);
  assert.match(md, /\| User ID \| `dl_abc` \|/);
  assert.match(md, /🤖 GitHub Agent · 01:40:09\n\nHello! नमस्ते/);
  assert.match(md, /adaptive card/);
  assert.match(md, /Suggested: List repos/);
  assert.match(md, /📎 \*\*spec\.pdf\*\* \(application\/pdf\) https:\/\/dl\.example\/att\/1/);
  assert.match(md, /Messages \| 3 \(Deepesh: 2, agent: 1\)/);
  assert.ok(!md.includes("typing"));
  assert.ok(!md.includes("startConversation"));
});

test("log: existing identical file -> no commit", async () => {
  const md = renderTranscript("Conv-123-in", ACTS, 330, { name: "Deepesh", slug: "deepesh" });
  const b64 = b64utf8(md).replace(/(.{60})/g, "$1\n"); // GitHub wraps base64
  mockFetch({ getStatus: 200, existing: b64 });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.deepEqual([j.logged, j.changed], [true, false]);
  assert.equal(gh.puts.length, 0);
});

test("log: existing different file -> update with sha", async () => {
  mockFetch({ getStatus: 200, existing: b64utf8("old") });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.equal(j.changed, true);
  assert.equal(gh.puts[0].sha, "abc123");
});

test("log: write conflict is retried, then succeeds", async () => {
  mockFetch({ putStatuses: [409, 201] });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.equal(j.logged, true);
  assert.equal(gh.puts.length, 2);
});

test("log: persistent conflict -> 502 github_conflict", async () => {
  mockFetch({ putStatuses: [409] });
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "github_conflict");
});

test("log: github auth failure surfaces status", async () => {
  mockFetch({ putStatuses: [403] });
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), env);
  assert.equal((await res.json()).error, "github_write_403");
});

test("log: disabled when no token configured (page keeps working)", async () => {
  const res = await worker.fetch(req({ conversationId: "Conv-123-in" }), { ...env, GITHUB_LOG_TOKEN: undefined });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { logged: false, reason: "logging_disabled" });
  assert.equal(calls.length, 0);
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

test("log path sanitises ids and uses first activity time", () => {
  assert.equal(logPath("A|b:c.d", ACTS, 0, "bob"), "logs/2026-11-26/2010-bob--A_b_c_d.md");
});

test("health reports logging flag", async () => {
  const h = await worker.fetch(new Request("https://w.example/health"), env);
  assert.deepEqual(await h.json(), { ok: true, configured: true, logging: true, people: 1 });
});
