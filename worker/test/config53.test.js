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

// ---------- TODO #52 part 2: older logs repos are read for History, transcripts and #49 owner records ----------
import { oldLogRepos, readOwner as readOwner52, _resetOwnerCache as resetOwners52 } from "../src/index.js";
import { _resetRepoCheck } from "../src/main.js";

const OLD = { ...env, CONFIG_BRANCH: "off", LOG_REPO: "o/logs-2", LOG_REPOS_OLD: "o/logs, o/logs-2, bad name, o/logs" };
const F52 = "logs/1/2026-11-27/0140-deepesh--c1";
const G52 = "logs/1/2026-11-26/0900-deepesh--c0";
const reqBody = (path, code, body) =>
  new Request("https://w.example" + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "CF-Connecting-IP": "7.7.7.8", "Content-Type": "application/json", "X-Access-Code": code },
    body: JSON.stringify(body),
  });
/** repo -> list of blob paths, or an HTTP status */
const trees = (map) => async (url) => {
  const u = String(url);
  for (const [repo, v] of Object.entries(map)) {
    if (!u.startsWith("https://api.github.com/repos/" + repo + "/git/trees/")) continue;
    if (typeof v === "number") return new Response("{}", { status: v });
    return Response.json({ tree: v.map((p) => ({ type: "blob", path: p })) });
  }
  return new Response("{}", { status: 404 });
};
/** repo NAME -> {file: text} of folder F52, or an HTTP status */
const graph = (map) => async (url, init) => {
  if (String(url) !== "https://api.github.com/graphql") return new Response("{}", { status: 404 });
  const v = JSON.parse(init.body).variables;
  const files = map[v.n];
  if (typeof files === "number") return new Response("{}", { status: files });
  const obj = files && v.e === "main:" + F52 ? { entries: Object.entries(files).map(([name, text]) => ({ name, type: "blob", object: { text } })) } : null;
  return Response.json({ data: { repository: { object: obj } } });
};

test("#52 part 2: oldLogRepos, config repos.oldLogs and configEnv LOG_REPOS_OLD", async () => {
  assert.deepEqual(oldLogRepos(OLD), ["o/logs"], "current repo, bad names and duplicates dropped");
  assert.deepEqual(oldLogRepos({ LOG_REPO: "o/a" }), []);
  const c = normalizeConfig({ repos: { logs: "o/logs-2", oldLogs: ["o/logs", "o/logs", "bad name", 5] } });
  assert.deepEqual(c.repos, { logs: "o/logs-2", oldLogs: ["o/logs"] });
  const e = await configEnv(env, { data: c }, "");
  assert.equal(e.LOG_REPO, "o/logs-2");
  assert.equal(e.LOG_REPOS_OLD, "o/logs");
  assert.equal((await configEnv(env, { data: normalizeConfig({ repos: { logs: "o/x" } }) }, "")).LOG_REPOS_OLD, undefined);
});

test("#52 part 2: /history lists the current and the older logs repo; folders only in the older one say so", async () => {
  globalThis.fetch = trees({
    "o/logs-2": [F52 + "/0003-010000-user.md"],
    "o/logs": [F52 + "/0000-session.md", F52 + "/0001-014005-user.md", F52 + "/0002-014009-agent.md", G52 + "/0000-session.md", G52 + "/0001-090000-user.md"],
  });
  const j = await (await worker.fetch(req("/history", "owner-code"), OLD)).json();
  assert.deepEqual(j.items.map((i) => [i.path, i.messages, i.repo || ""]), [[F52, 3, ""], [G52, 1, "o/logs"]]);
  globalThis.fetch = trees({ "o/logs-2": [F52 + "/0001-014005-user.md"], "o/logs": 500 });
  assert.equal((await (await worker.fetch(req("/history", "owner-code"), OLD)).json()).items.length, 1, "unreadable older repo skipped");
  globalThis.fetch = trees({ "o/logs-2": 500 });
  assert.equal((await worker.fetch(req("/history", "owner-code"), OLD)).status, 502, "the current repo still has to answer");
  globalThis.fetch = trees({});
  assert.deepEqual(await (await worker.fetch(req("/history", "owner-code"), OLD)).json(), { items: [] }, "empty repos: as before");
});

test("#52 part 2: /transcript joins a session folder from the current and the older logs repo", async () => {
  globalThis.fetch = graph({ "logs-2": { "0003-010000-user.md": "three" }, logs: { "0000-session.md": "# head", "0001-014005-user.md": "one", "0003-010000-user.md": "old three" } });
  const j = await (await worker.fetch(reqBody("/transcript", "owner-code", { path: F52 }), OLD)).json();
  assert.equal(j.files, 3);
  assert.match(j.markdown, /^# head\n\| Messages \| 2 \|/);
  assert.ok(j.markdown.indexOf("one") < j.markdown.indexOf("three"));
  assert.ok(!j.markdown.includes("old three"), "the current repo wins for a file name found twice");
  globalThis.fetch = graph({ logs: { "0001-014005-user.md": "one" } });
  assert.equal((await worker.fetch(reqBody("/transcript", "owner-code", { path: F52 }), OLD)).status, 200, "only in the older repo");
  globalThis.fetch = graph({});
  assert.equal((await worker.fetch(reqBody("/transcript", "owner-code", { path: F52 }), OLD)).status, 404);
  globalThis.fetch = graph({ "logs-2": 500, logs: { "0001-014005-user.md": "one" } });
  assert.equal((await worker.fetch(reqBody("/transcript", "owner-code", { path: F52 }), OLD)).status, 502, "current repo error = 502 as before");
});

test("#52 part 2: #49 owner records are also looked up in the older logs repo", async () => {
  resetOwners52();
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.startsWith("https://api.github.com/repos/o/logs/contents/owners/c1.json")) return new Response('{"owner":"abc"}', { status: 200 });
    return new Response("", { status: 404 });
  };
  assert.equal(await readOwner52(OLD, "c1"), "abc");
  assert.equal(seen.length, 2, "current repo first, then the older one");
  assert.ok(seen[0].startsWith("https://api.github.com/repos/o/logs-2/"));
  assert.equal(await readOwner52(OLD, "c2"), "", "no record anywhere");
  resetOwners52();
  globalThis.fetch = async () => new Response("", { status: 500 });
  assert.equal(await readOwner52(OLD, "c3"), null, "current repo unreadable = fail closed");
  resetOwners52();
});

test("#52 part 2: GET /health?repos=1 says whether the tokens can read each repo, without names", async () => {
  _resetRepoCheck();
  globalThis.fetch = async (url) => new Response("{}", { status: String(url) === "https://api.github.com/repos/o/logs" ? 404 : 200 });
  const h = await (await worker.fetch(req("/health?repos=1", "", "", "GET"), OLD)).json();
  assert.deepEqual(h.repos, { logs: true, artifacts: true, oldLogs: [false] });
  assert.ok(!JSON.stringify(h).includes("o/"), "no repo names");
  const plain = await (await worker.fetch(req("/health", "", "", "GET"), OLD)).json();
  assert.equal(plain.repos, undefined);
  _resetRepoCheck();
});

// ---------- TODO #45 starters, #46 plan board, #47 hand-off, #20 History filter (Batch B / C) ----------
import fs45 from "node:fs";
import vm45 from "node:vm";
import { publicAgent } from "../src/main.js";

function page45(file, cfg) {
  const ctx = { console, AGENT_WEBCHAT_CONFIG: cfg || {} };
  ctx.window = ctx;
  vm45.createContext(ctx);
  vm45.runInContext(fs45.readFileSync(new URL("../../web/" + file, import.meta.url), "utf8"), ctx, { filename: file });
  return ctx;
}
const plain45 = (x) => JSON.parse(JSON.stringify(x));

test("#45: starter prompts are cleaned; a chat is empty until the user sends something", () => {
  const S = page45("starters.js").AgentStarters;
  assert.deepEqual(plain45(S.clean([" a ", "", "a", 5, "b", "c", "d", "e", "f", "g"])), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(plain45(S.clean("x")), []);
  assert.deepEqual(plain45(S.clean(["x".repeat(301)])), [], "too long");
  assert.equal(S.isEmpty([{ type: "message", from: { role: "bot" } }]), true);
  assert.equal(S.isEmpty([{ type: "message", from: { role: "user" } }]), false);
  assert.equal(S.isEmpty(null), true);
});

test("#46: plan board reads a YAML task list and picks the next task", () => {
  const P = page45("planboard.js").AgentPlan;
  const y = "plan: web-52\ntitle: Portable repos\ntasks:\n  - id: t1\n    title: \"Write the patch\"\n    status: done\n" +
    "  - id: t2\n    title: Open the PR # comment\n    status: todo\n  - {id: t3, title: Deploy, status: blocked}\n";
  const p = plain45(P.parse(y));
  assert.equal(p.plan, "web-52");
  assert.equal(p.title, "Portable repos");
  assert.deepEqual(p.tasks, [
    { id: "t1", title: "Write the patch", status: "done" },
    { id: "t2", title: "Open the PR", status: "todo" },
    { id: "t3", title: "Deploy", status: "blocked" },
  ]);
  assert.equal(P.next(P.parse(y)).id, "t2");
  assert.equal(P.command(P.parse(y)), "run plan web-52");
  assert.equal(P.command(P.parse("tasks:\n  - id: a\n    status: completed\n  - id: b\n")), "run task b", "no plan id");
  assert.equal(P.command(P.parse("tasks:\n  - id: a\n    status: done\n")), "", "all done");
  assert.equal(P.parse("no tasks here"), null);
  assert.equal(P.parse("tasks:\n"), null);
});

test("#20: History filter names agent folder numbers from /agents", () => {
  const H = page45("historyfilter.js").AgentHistoryFilter;
  const names = H.names({ github: 1, spark: 2 }, [{ id: "github", name: "GitHub" }, { id: "spark", name: "SPARK" }, { id: "x", name: "X" }]);
  assert.deepEqual(plain45(names), { 1: "GitHub", 2: "SPARK" });
});

test("#45 / #46: the Worker passes starters and plans on; /agents answers folder numbers; the default agent can be configured", async () => {
  const data = normalizeConfig({ people: {}, agents: { spark: { starters: [" Summarise my day ", "", 7], plans: true }, github: { starters: ["Hi"] } } });
  assert.deepEqual(data.agents.spark, { starters: ["Summarise my day"], plans: true });
  const reg = agentRegistry(await configEnv(env, { data }, ""));
  const gh = reg.find((a) => a.id === "github");
  assert.ok(gh, "configuring the default agent keeps it");
  assert.equal(gh.secret, "s1", "default agent falls back to DIRECTLINE_SECRET");
  assert.equal(gh.num, 1);
  assert.deepEqual(publicAgent(gh).starters, ["Hi"]);
  assert.equal(publicAgent(gh).plans, undefined);
  const sp = publicAgent(reg.find((a) => a.id === "spark"));
  assert.deepEqual(sp.starters, ["Summarise my day"]);
  assert.equal(sp.plans, true);
  const a = await (await worker.fetch(req("/agents", "owner-code"), env)).json();
  assert.deepEqual(a.nums, { github: 1, spark: 2, conductor: 3 });
});
