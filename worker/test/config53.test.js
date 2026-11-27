// TODO #53 (wider config without secrets) + TODO #52 part 1 (switchable logs / artifacts repos): src/config.js + main.js.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { configEnv, secretValue, hmacHex, agentRegistry } from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";
import { normalizeConfig, _resetConfigCache } from "../src/config.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const PEPPER = "p".repeat(40);
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "s1",
  DEFAULT_AGENT_ID: "github",
  ACCESS_CODE: "owner-code",
  OWNER_NAME: "Deepesh",
  ACCESS_CODES: JSON.stringify({ "ravi-code": { name: "Ravi" } }),
  AGENTS: JSON.stringify({ spark: { name: "Spark (secret)", num: 2, secret: "s2" } }),
  AGENT_SECRETS: JSON.stringify({ DL_CONDUCTOR: "s3" }),
  OWNER_PEPPER: PEPPER,
  OWNERSHIP_CHECK: "off",
  LOG_REPO: "o/logs",
  ARTIFACT_REPO: "o/artifacts-1",
  LOG_REPO_TOKEN: "t",
  CONFIG_REPO: "o/config",
  CONFIG_BRANCH: "main",
  RATE_LIMIT_PER_MIN: "100",
  API_RATE_LIMIT_PER_MIN: "100",
};

let CONFIG;
async function makeConfig() {
  return {
    people: {
      deepesh: { agents: ["*"] },
      meera: { codeHash: await hmacHex(PEPPER, "meera-code"), name: "Meera", agents: ["spark"], role: "owner", header: "Meera rules" },
      nolist: { codeHash: await hmacHex(PEPPER, "nolist-code") },
      ravi: { codeHash: await hmacHex(PEPPER, "fake-ravi") }, // same slug as a secrets person -> ignored
    },
    agents: {
      spark: { name: "SPARK", initials: "SP", routes: ["coach"] },
      conductor: { name: "CONDUCTOR", num: 3, secretName: "DL_CONDUCTOR", secret: "never-used" },
      ghost: { name: "Ghost", secretName: "DL_MISSING" },
    },
    repos: { logs: "o/logs-2", artifacts: "o/artifacts-2" },
  };
}

beforeEach(async () => {
  _resetRateLimiter();
  _resetConfigCache();
  CONFIG = await makeConfig();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com/repos/o/config/")) return new Response(JSON.stringify(CONFIG), { status: 200 });
    if (u.startsWith("https://api.github.com/")) return new Response("{}", { status: 201 });
    return Response.json({ token: "tok", expires_in: 3600, conversationId: "conv-1" });
  };
});

const req = (path, code, agent, method = "POST") => {
  const headers = { Origin: ORIGIN, "CF-Connecting-IP": "7.7.7.7", "Content-Type": "application/json" };
  if (code) headers["X-Access-Code"] = code;
  if (agent) headers["X-Agent"] = agent;
  return new Request("https://w.example" + path, { method, headers, body: method === "POST" ? "{}" : undefined });
};

test("normalizeConfig: agents keep only non-secret fields, repos and codeHash are validated", async () => {
  const c = normalizeConfig({
    ...(await makeConfig()),
    agents: { conductor: { name: "C", secretName: "DL_CONDUCTOR", secret: "x" }, bad: { secretName: "lower-case" }, "Bad Id": {} },
    repos: { logs: "o/logs-2", artifacts: "not a repo" },
  });
  assert.deepEqual(c.agents.conductor, { name: "C", secretName: "DL_CONDUCTOR" }, "secret value dropped");
  assert.deepEqual(c.agents.bad, {}, "bad secretName dropped");
  assert.equal(c.agents["Bad Id"], undefined);
  assert.deepEqual(c.repos, { logs: "o/logs-2" });
  assert.match(c.people.meera.codeHash, /^[0-9a-f]{64}$/);
  assert.equal(c.people.meera.name, "Meera");
  assert.equal(normalizeConfig({ people: { x: { codeHash: "plain-code" } } }).people.x.codeHash, undefined, "not a hash");
  assert.deepEqual(normalizeConfig(null), { header: null, people: {} }, "no new keys when absent (old shape)");
});

test("secretValue: Worker secret first, then AGENT_SECRETS; only valid names", () => {
  assert.equal(secretValue({ DL_X: "a", AGENT_SECRETS: '{"DL_X":"b"}' }, "DL_X"), "a");
  assert.equal(secretValue({ AGENT_SECRETS: '{"DL_X":"b"}' }, "DL_X"), "b");
  assert.equal(secretValue({ AGENT_SECRETS: "not json" }, "DL_X"), "");
  assert.equal(secretValue({ dl_x: "a" }, "dl_x"), "", "lower-case names are not secret names");
  assert.equal(secretValue({ AGENTS: "x" }, "AGENTS"), "x", "any upper-case Worker var can be named");
});

test("configEnv: agents merged over AGENTS, secretName replaces a secret, repos switch LOG_REPO / ARTIFACT_REPO", async () => {
  const e = await configEnv(env, { data: normalizeConfig(CONFIG) }, "");
  const agents = JSON.parse(e.AGENTS);
  assert.equal(agents.spark.name, "SPARK", "config wins for non-secret fields");
  assert.equal(agents.spark.secret, "s2", "secret still from the AGENTS secret");
  assert.equal(agents.spark.num, 2);
  assert.equal(agents.conductor.secretName, "DL_CONDUCTOR");
  assert.equal(agents.conductor.secret, undefined);
  assert.equal(e.LOG_REPO, "o/logs-2");
  assert.equal(e.ARTIFACT_REPO, "o/artifacts-2");
  const reg = agentRegistry(e);
  assert.deepEqual(reg.map((a) => [a.id, a.num]), [["github", 1], ["spark", 2], ["conductor", 3]], "ghost has no secret -> left out");
  assert.equal(reg.find((a) => a.id === "conductor").secret, "s3");
  const off = await configEnv(env, { off: true }, "");
  assert.equal(off.LOG_REPO, "o/logs");
  assert.equal(off.AGENTS, env.AGENTS);
});

test("Worker: config agents show up in /agents; /token answers the repos from the config", async () => {
  const a = await (await worker.fetch(req("/agents", "owner-code"), env)).json();
  assert.deepEqual(a.agents.map((x) => x.id), ["github", "spark", "conductor"]);
  assert.deepEqual(a.agents.find((x) => x.id === "spark").routes, ["coach"]);
  const t = await (await worker.fetch(req("/token", "owner-code", "conductor"), env)).json();
  assert.equal(t.agent.id, "conductor");
  assert.deepEqual(t.repos, { logs: "o/logs-2", artifacts: "o/artifacts-2" });
});

test("Worker: a hashed code from the config works, only for the listed agents, never as owner/admin", async () => {
  const a = await (await worker.fetch(req("/agents", "meera-code"), env)).json();
  assert.equal(a.person, "Meera");
  assert.deepEqual(a.agents.map((x) => x.id), ["spark"]);
  const t = await (await worker.fetch(req("/token", "meera-code"), env)).json();
  assert.equal(t.agent.id, "spark");
  assert.equal(t.role, "user", "config role owner is ignored for a non-admin");
  assert.deepEqual(t.header, { text: "Meera rules", every: 0 });
  const denied = await worker.fetch(req("/token", "meera-code", "github"), env);
  assert.equal(denied.status, 403);
  const none = await (await worker.fetch(req("/agents", "nolist-code"), env)).json();
  assert.deepEqual(none.agents, [], "no agents listed = no agents");
});

test("Worker: hashed codes are refused when they reuse a secrets person's name, or without OWNER_PEPPER", async () => {
  assert.equal((await worker.fetch(req("/agents", "fake-ravi"), env)).status, 401);
  assert.equal((await worker.fetch(req("/agents", "meera-code"), { ...env, OWNER_PEPPER: "" })).status, 401);
  assert.equal((await worker.fetch(req("/agents", "wrong"), env)).status, 401);
  assert.equal((await worker.fetch(req("/agents", "ravi-code"), env)).status, 200, "secrets people unchanged");
});

test("Worker: config off = everything from the secrets, as before; /health reports the config state", async () => {
  const e2 = { ...env, CONFIG_BRANCH: "off" };
  const a = await (await worker.fetch(req("/agents", "owner-code"), e2)).json();
  assert.deepEqual(a.agents.map((x) => x.id), ["github", "spark"]);
  assert.equal((await worker.fetch(req("/agents", "meera-code"), e2)).status, 401);
  const t = await (await worker.fetch(req("/token", "owner-code"), e2)).json();
  assert.deepEqual(t.repos, { logs: "o/logs", artifacts: "o/artifacts-1" });
  const h1 = await (await worker.fetch(req("/health", "", "", "GET"), env)).json();
  assert.equal(h1.config, "on");
  const h2 = await (await worker.fetch(req("/health", "", "", "GET"), e2)).json();
  assert.equal(h2.config, "off");
});
