// TODO #49 (brief #44): /resume, /export and /log only for the code that started the conversation; admins see all.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetRateLimiter, _resetOwnerCache, ownerId, ownerPath, ownershipOn } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const base = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "dl-secret",
  ACCESS_CODE: "owner-code",
  ACCESS_CODES: JSON.stringify({ "ravi-code": "Ravi", "mia-code": "Mia", "boss-code": { name: "Boss", admin: true } }),
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
  OWNER_PEPPER: "pepper-for-tests",
};

let files, calls;
function mock() {
  files = new Map();
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    if (url.endsWith("/v3/directline/tokens/generate")) return Response.json({ token: "t", conversationId: "Conv" + calls.length + "-in", expires_in: 1800 });
    if (url.includes("/v3/directline/conversations/") && url.includes("/activities")) return Response.json({ activities: [], watermark: "0" });
    if (url.includes("/v3/directline/conversations/")) return Response.json({ token: "t2", conversationId: decodeURIComponent(url.split("/").pop()) });
    const m = /\/contents\/(owners\/[^?]+)/.exec(url);
    if (m) {
      const path = decodeURIComponent(m[1]);
      if (init.method === "PUT") {
        if (files.has(path)) return new Response("{}", { status: 422 });
        files.set(path, atob(JSON.parse(init.body).content));
        return new Response("{}", { status: 201 });
      }
      return files.has(path) ? new Response(files.get(path), { status: 200 }) : new Response("{}", { status: 404 });
    }
    throw new Error("unexpected fetch " + url);
  };
}

function req(path, code, body) {
  return new Request("https://w.example" + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "X-Access-Code": code, "CF-Connecting-IP": "1.2.3." + Math.floor(Math.random() * 250), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const call = async (path, code, body, env = base) => {
  const r = await worker.fetch(req(path, code, body), env);
  return { status: r.status, j: await r.json() };
};

beforeEach(() => { _resetRateLimiter(); _resetOwnerCache(); mock(); });

test("on only with OWNER_PEPPER + logging, and OWNERSHIP_CHECK=off turns it off", () => {
  assert.equal(ownershipOn(base), true);
  assert.equal(ownershipOn({ ...base, OWNER_PEPPER: "" }), false);
  assert.equal(ownershipOn({ ...base, LOG_REPO_TOKEN: "" }), false);
  assert.equal(ownershipOn({ ...base, OWNERSHIP_CHECK: "off" }), false);
});

test("owner id is an HMAC (32 hex), differs per code, never contains the code", async () => {
  const a = await ownerId(base, "ravi-code"), b = await ownerId(base, "mia-code");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, await ownerId({ ...base, OWNER_PEPPER: "other" }, "ravi-code"));
  assert.ok(!a.includes("ravi"));
});

test("/token records owners/<conversation>.json without the code", async () => {
  const { status, j } = await call("/token", "ravi-code");
  assert.equal(status, 200);
  assert.equal(j.ownerRecorded, true);
  const rec = JSON.parse(files.get(ownerPath(j.conversationId)));
  assert.equal(rec.owner, await ownerId(base, "ravi-code"));
  assert.ok(!files.get(ownerPath(j.conversationId)).includes("ravi-code"));
});

test("another code gets 403 on /resume, /export and /log; the starter gets through", async () => {
  const { j } = await call("/token", "ravi-code");
  const id = j.conversationId;
  _resetOwnerCache(); // force the GitHub read path too
  for (const p of ["/resume", "/export", "/log"]) {
    const other = await call(p, "mia-code", { conversationId: id });
    assert.equal(other.status, 403, p);
    assert.equal(other.j.error, "forbidden");
  }
  assert.equal((await call("/resume", "ravi-code", { conversationId: id })).status, 200);
  assert.equal((await call("/export", "ravi-code", { conversationId: id })).status, 200);
});

test("admins (owner code and admin:true) can open any conversation", async () => {
  const { j } = await call("/token", "ravi-code");
  assert.equal((await call("/resume", "owner-code", { conversationId: j.conversationId })).status, 200);
  assert.equal((await call("/resume", "boss-code", { conversationId: j.conversationId })).status, 200);
});

test("old conversation without a record: admin-only", async () => {
  assert.equal((await call("/resume", "ravi-code", { conversationId: "OldConv-in" })).status, 403);
  assert.equal((await call("/resume", "owner-code", { conversationId: "OldConv-in" })).status, 200);
});

test("GitHub unreadable -> 503 for non-admins (fail closed)", async () => {
  globalThis.fetch = async (url) => (url.includes("/contents/owners/") ? new Response("{}", { status: 500 }) : Response.json({ token: "t" }));
  const r = await call("/resume", "ravi-code", { conversationId: "Conv9-in" });
  assert.equal(r.status, 503);
  assert.equal(r.j.error, "owner_check_unavailable");
});

test("without OWNER_PEPPER nothing changes: no record, no check, same /token fields", async () => {
  const env = { ...base, OWNER_PEPPER: "" };
  const { j } = await call("/token", "ravi-code", null, env);
  assert.equal(j.ownerRecorded, undefined);
  assert.equal(files.size, 0);
  assert.equal((await call("/resume", "mia-code", { conversationId: j.conversationId }, env)).status, 200);
});
