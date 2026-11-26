import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetRateLimiter } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "test-secret",
  ACCESS_CODE: "open-sesame",
  RATE_LIMIT_PER_MIN: "3",
};

let calls;
beforeEach(() => {
  _resetRateLimiter();
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ token: "tok123", expires_in: 3600, conversationId: "conv1" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
});

function req(opts = {}) {
  const headers = { Origin: ORIGIN, "X-Access-Code": "open-sesame", "CF-Connecting-IP": "1.2.3.4" };
  Object.assign(headers, opts.headers || {});
  for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
  return new Request("https://w.example/" + (opts.path || "token"), {
    method: opts.method || "POST",
    headers,
  });
}

test("happy path returns token and never leaks secret", async () => {
  const res = await worker.fetch(req(), env);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("test-secret"));
  const body = JSON.parse(text);
  assert.equal(body.token, "tok123");
  assert.match(body.userId, /^dl_/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://directline.botframework.com/v3/directline/tokens/generate");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-secret");
});

test("wrong access code -> 401, Direct Line not called", async () => {
  const res = await worker.fetch(req({ headers: { "X-Access-Code": "nope" } }), env);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("missing access code -> 401", async () => {
  const res = await worker.fetch(req({ headers: { "X-Access-Code": null } }), env);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("foreign origin -> 403 without CORS header", async () => {
  const res = await worker.fetch(req({ headers: { Origin: "https://evil.example" } }), env);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(calls.length, 0);
});

test("no origin (curl) -> 403", async () => {
  const res = await worker.fetch(req({ headers: { Origin: null } }), env);
  assert.equal(res.status, 403);
});

test("preflight OK for allowed origin", async () => {
  const res = await worker.fetch(req({ method: "OPTIONS" }), env);
  assert.equal(res.status, 204);
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /X-Access-Code/);
});

test("GET /token -> 405", async () => {
  const res = await worker.fetch(req({ method: "GET" }), env);
  assert.equal(res.status, 405);
});

test("rate limit kicks in after N requests per IP", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(req(), env)).status, 200);
  assert.equal((await worker.fetch(req(), env)).status, 429);
  const other = await worker.fetch(req({ headers: { "CF-Connecting-IP": "5.6.7.8" } }), env);
  assert.equal(other.status, 200);
});

test("bad guesses also count toward rate limit", async () => {
  for (let i = 0; i < 3; i++) {
    await worker.fetch(req({ headers: { "X-Access-Code": "guess" + i } }), env);
  }
  assert.equal((await worker.fetch(req(), env)).status, 429);
});

test("unconfigured server -> 500", async () => {
  const res = await worker.fetch(req(), { ALLOWED_ORIGINS: ORIGIN });
  assert.equal(res.status, 500);
});

test("Direct Line failure -> 502 with status only", async () => {
  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  const res = await worker.fetch(req(), env);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "directline_error", status: 403 });
});

test("regional domain honoured", async () => {
  await worker.fetch(req(), { ...env, DIRECTLINE_DOMAIN: "https://europe.directline.botframework.com/" });
  assert.equal(calls[0].url, "https://europe.directline.botframework.com/v3/directline/tokens/generate");
});

test("unknown path -> 404, health -> 200", async () => {
  assert.equal((await worker.fetch(req({ path: "x" }), env)).status, 404);
  const h = await worker.fetch(req({ path: "health", method: "GET" }), env);
  assert.equal(h.status, 200);
  assert.deepEqual(await h.json(), { ok: true, configured: true, logging: false, artifacts: false, people: 1 });
});
