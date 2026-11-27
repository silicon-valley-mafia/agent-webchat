// Direct Line paging for /log (bug hunt W3): read every page up to DL_MAX_PAGES, flag partial reads,
// and keep Direct Line reads + GitHub writes within SUBREQUEST_BUDGET (Cloudflare Free: 50 per request).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetRateLimiter, WRITE_BUDGET, DL_MAX_PAGES, SUBREQUEST_BUDGET } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "test-secret",
  ACCESS_CODE: "open-sesame",
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
  OWNER_NAME: "Deepesh",
};

function msg(i) {
  return {
    id: "m" + i, type: "message", text: "msg " + i,
    timestamp: new Date(Date.UTC(2026, 10, 26, 20, 0, 0) + i * 1000).toISOString(),
    from: { id: i % 2 ? "bot" : "dl_abc", role: i % 2 ? "bot" : "user" },
  };
}

let dlCalls, puts;
/** pages: fixed list of activity arrays; or perPage: endless pages with that many messages each. */
function mock({ pages = null, perPage = 0 } = {}) {
  dlCalls = 0;
  puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (url.includes("/v3/directline/conversations/")) {
      dlCalls++;
      const m = /watermark=(\d+)/.exec(url);
      const n = m ? Number(m[1]) : 0;
      if (pages && n >= pages.length) return Response.json({ activities: [], watermark: String(n) });
      const acts = pages ? pages[n] : Array.from({ length: perPage }, (_, k) => msg(n * perPage + k));
      return Response.json({ activities: acts, watermark: String(n + 1) });
    }
    if (url.startsWith("https://api.github.com/repos/")) {
      assert.equal(init.method, "PUT");
      puts++;
      return new Response("{}", { status: 201 });
    }
    throw new Error("unexpected fetch " + url);
  };
}

function req(body) {
  return new Request("https://w.example/log", {
    method: "POST",
    headers: { Origin: ORIGIN, "X-Access-Code": "open-sesame", "CF-Connecting-IP": "9.9.9.9", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => _resetRateLimiter());

test("budget constants stay under Cloudflare's 50 subrequests", () => {
  assert.ok(SUBREQUEST_BUDGET < 50);
  assert.ok(WRITE_BUDGET <= SUBREQUEST_BUDGET);
  assert.ok(DL_MAX_PAGES > 5, "more than the old 5-page cap");
});

test("log: messages spread over several Direct Line pages are all written", async () => {
  mock({ pages: [[msg(0), msg(1)], [msg(2), msg(3)], [msg(4)]] });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.equal(j.logged, true);
  assert.equal(j.total, 5);
  assert.equal(j.more, false);
  assert.equal(j.partial, undefined, "complete read -> no partial flag");
  assert.equal(dlCalls, 4, "3 pages + 1 empty page that ends the read");
  assert.equal(puts, 6, "header + 5 messages");
});

test("log: page cap reached -> partial: true, reads stop at DL_MAX_PAGES", async () => {
  mock({ perPage: 1 });
  const j = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.equal(dlCalls, DL_MAX_PAGES);
  assert.equal(j.partial, true);
  assert.equal(j.total, DL_MAX_PAGES);
  assert.equal(j.more, false);
});

test("log: reads + writes never exceed SUBREQUEST_BUDGET; `more` asks the client to continue", async () => {
  mock({ perPage: 5 });
  const j1 = await (await worker.fetch(req({ conversationId: "Conv-123-in" }), env)).json();
  assert.ok(dlCalls + puts <= SUBREQUEST_BUDGET, "used " + (dlCalls + puts));
  assert.equal(puts, Math.min(WRITE_BUDGET, SUBREQUEST_BUDGET - DL_MAX_PAGES));
  assert.equal(j1.more, true);
  assert.equal(j1.total, puts - 1, "header used one write");
  mock({ perPage: 5 });
  const j2 = await (await worker.fetch(req({ conversationId: "Conv-123-in", since: j1.total }), env)).json();
  assert.ok(dlCalls + puts <= SUBREQUEST_BUDGET);
  assert.ok(j2.total > j1.total);
});
