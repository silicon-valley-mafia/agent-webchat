// Bug found 2026-11-27: the CORS preflight for POST /agents (X-Access-Code header) went to index.js, which answered 404,
// so browsers blocked /agents and the agent picker / Group page never saw more than one agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { OWN_ROUTES } from "../src/main.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = { ALLOWED_ORIGINS: ORIGIN, DIRECTLINE_SECRET: "s", ACCESS_CODE: "c" };
const pre = (path, origin = ORIGIN) => worker.fetch(new Request("https://w.example" + path, {
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-access-code,content-type" },
}), env);

test("preflight for /agents: 204 with the allowed origin and headers", async () => {
  assert.ok(OWN_ROUTES.has("/agents"));
  const r = await pre("/agents");
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /X-Access-Code/);
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("preflight for /agents from a foreign origin is refused", async () => {
  assert.equal((await pre("/agents", "https://evil.example")).status, 403);
});

test("preflight for index.js routes is unchanged (204 + X-Agent added)", async () => {
  const r = await pre("/token");
  assert.equal(r.status, 204);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /X-Agent/);
});
