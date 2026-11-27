// TODO #51: per-person settings from the private config branch (src/config.js) + session header (web/header.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker, { personRules, personRole } from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";
import { loadConfig, normalizeConfig, normHeader, configEntry, personHeader, _resetConfigCache } from "../src/config.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const CONFIG = {
  header: { text: "Team rules", every: 0 },
  people: {
    Deepesh: { agents: ["*"], defaultAgent: "spark", files: ["silicon-valley-mafia/agent-plans/"], header: { text: "Owner rules", every: 3 } },
    ravi: { agents: ["github"], role: "readOnly", files: [] },
    asha: { header: null },
    "Bad Slug!": { agents: ["*"] },
  },
};
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "s",
  DEFAULT_AGENT_ID: "github",
  ACCESS_CODE: "owner-code",
  OWNER_NAME: "Deepesh",
  ACCESS_CODES: JSON.stringify({ "ravi-code": { name: "Ravi", agents: ["*"] }, "asha-code": "Asha" }),
  AGENTS: JSON.stringify({ spark: { name: "SPARK", num: 2, secret: "s2" } }),
  OWNER_FILES: JSON.stringify(["silicon-valley-mafia/other/"]),
  FILE_READ_TOKEN: "read-only",
  LOG_REPO: "o/logs",
  LOG_REPO_TOKEN: "t",
  CONFIG_BRANCH: "config",
  RATE_LIMIT_PER_MIN: "100",
  API_RATE_LIMIT_PER_MIN: "100",
};

let gh = { calls: 0, mode: "ok" };
beforeEach(() => {
  _resetRateLimiter();
  _resetConfigCache();
  gh = { calls: 0, mode: "ok" };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com/")) {
      gh.calls++;
      if (gh.mode === "down") throw new Error("down");
      if (gh.mode === "404") return new Response("{}", { status: 404 });
      if (gh.mode === "bad") return new Response("{not json", { status: 200 });
      assert.equal(u, "https://api.github.com/repos/o/logs/contents/config/people.json?ref=config");
      return new Response(JSON.stringify(CONFIG), { status: 200 });
    }
    return Response.json({ token: "tok", expires_in: 3600, conversationId: "conv-1" });
  };
});

const req = (path, code, body, agent) => {
  const headers = { Origin: ORIGIN, "X-Access-Code": code, "CF-Connecting-IP": "5.5.5.5", "Content-Type": "application/json" };
  if (agent) headers["X-Agent"] = agent;
  return new Request("https://w.example" + path, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
};

test("normalizeConfig / normHeader: lower-case slugs, bad entries dropped, header forms", () => {
  const c = normalizeConfig(CONFIG);
  assert.deepEqual(Object.keys(c.people).sort(), ["asha", "deepesh", "ravi"]);
  assert.deepEqual(c.people.deepesh.header, { text: "Owner rules", every: 3 });
  assert.equal(c.people.asha.header, null);
  assert.deepEqual(normHeader("hi"), { text: "hi", every: 0 });
  assert.deepEqual(normHeader({ text: " x ", every: -2 }), { text: "x", every: 0 });
  assert.equal(normHeader({ text: "  " }), null);
  assert.deepEqual(normalizeConfig(null), { header: null, people: {} });
});

test("loadConfig: off without CONFIG_BRANCH; cached; 404 = empty; outage keeps the last good copy", async () => {
  assert.deepEqual(await loadConfig({ ...env, CONFIG_BRANCH: "" }), { off: true });
  assert.deepEqual(await loadConfig({ ...env, CONFIG_BRANCH: "off" }), { off: true });
  assert.equal(gh.calls, 0);
  const a = await loadConfig(env, 1000);
  await loadConfig(env, 2000);
  assert.equal(gh.calls, 1, "second read comes from the cache");
  assert.ok(a.data.people.ravi);
  gh.mode = "down";
  const b = await loadConfig(env, 1000 + 61000);
  assert.equal(b.stale, true);
  assert.ok(b.data.people.ravi, "last good copy");
  _resetConfigCache();
  assert.equal((await loadConfig(env, 5000)).error, "config_unreachable");
  _resetConfigCache();
  gh.mode = "404";
  assert.deepEqual((await loadConfig(env, 5000)).data, { header: null, people: {} });
  _resetConfigCache();
  gh.mode = "bad";
  assert.equal((await loadConfig(env, 5000)).error, "config_bad_json");
});

test("personRules / personRole / personHeader: config wins over ACCESS_CODES; admins keep every agent", async () => {
  const cfg = await loadConfig(env);
  const ravi = { name: "Ravi", slug: "ravi", admin: false };
  const owner = { name: "Deepesh", slug: "deepesh", admin: true };
  assert.deepEqual(personRules(env, "ravi-code", ravi, cfg), { agents: ["github"], defaultAgent: null });
  assert.deepEqual(personRules(env, "ravi-code", ravi, null), { agents: null, defaultAgent: null }, "no config = as before");
  assert.deepEqual(personRules(env, "owner-code", owner, cfg), { agents: null, defaultAgent: "spark" });
  assert.equal(personRole(env, "ravi-code", ravi, cfg), "readOnly");
  assert.equal(personRole(env, "owner-code", owner, cfg), "owner");
  assert.deepEqual(personHeader(cfg, owner), { text: "Owner rules", every: 3 });
  assert.deepEqual(personHeader(cfg, ravi), { text: "Team rules", every: 0 }, "default header");
  assert.equal(personHeader(cfg, { slug: "asha" }), null, "header: null switches it off");
  assert.equal(configEntry(cfg, { slug: "nobody" }), null);
});

test("Worker: /agents, /token and X-Agent follow the config branch; /token answers the header", async () => {
  const ag = await (await worker.fetch(req("/agents", "ravi-code"), env)).json();
  assert.deepEqual(ag.agents.map((a) => a.id), ["github"]);
  const denied = await worker.fetch(req("/token", "ravi-code", null, "spark"), env);
  assert.equal(denied.status, 403);
  const t = await (await worker.fetch(req("/token", "owner-code"), env)).json();
  assert.equal(t.agent.id, "spark", "owner's defaultAgent from the config");
  assert.deepEqual(t.header, { text: "Owner rules", every: 3 });
  assert.equal(t.role, "owner");
  const r = await (await worker.fetch(req("/token", "ravi-code"), env)).json();
  assert.deepEqual(r.header, { text: "Team rules", every: 0 });
  assert.equal(r.role, "readOnly");
  const a = await (await worker.fetch(req("/token", "asha-code"), env)).json();
  assert.equal(a.header, undefined);
  assert.equal(gh.calls, 1, "one GitHub read for all of that (cache)");
});

test("Worker: config never readable -> non-admins 503, owner still works", async () => {
  gh.mode = "down";
  const r = await worker.fetch(req("/token", "ravi-code"), env);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "config_unavailable");
  const o = await worker.fetch(req("/token", "owner-code"), env);
  assert.equal(o.status, 200);
});

test("Worker: /file roots come from the config branch ('files'), replacing OWNER_FILES", async () => {
  const j = await (await worker.fetch(req("/file", "owner-code", { op: "roots" }), env)).json();
  assert.deepEqual(j.roots, ["silicon-valley-mafia/agent-plans/"]);
  const off = await (await worker.fetch(req("/file", "owner-code", { op: "roots" }), { ...env, CONFIG_BRANCH: "" })).json();
  assert.deepEqual(off.roots, ["silicon-valley-mafia/other/"], "config off = OWNER_FILES as before");
});

test("CONFIG_REPO + AGENT_SYSTEM_PAT: config read from that repo with that token; /file uses it when no FILE_READ_TOKEN", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init && init.headers && init.headers.Authorization });
    return new Response(JSON.stringify(CONFIG), { status: 200 });
  };
  const e2 = { ...env, CONFIG_REPO: "o/agent-webchat-config", CONFIG_BRANCH: "main", AGENT_SYSTEM_PAT: "sys", FILE_READ_TOKEN: "" };
  const c = await loadConfig(e2);
  assert.ok(c.data.people.deepesh);
  assert.equal(seen[0].url, "https://api.github.com/repos/o/agent-webchat-config/contents/config/people.json?ref=main");
  assert.equal(seen[0].auth, "Bearer sys");
  const j = await (await worker.fetch(req("/file", "owner-code", { op: "roots" }), e2)).json();
  assert.deepEqual(j.roots, ["silicon-valley-mafia/agent-plans/"], "file_disabled would mean the PAT fallback failed");
  _resetConfigCache();
  assert.deepEqual(await loadConfig({ ...e2, AGENT_SYSTEM_PAT: "", LOG_REPO_TOKEN: "" }), { off: true }, "no token at all = off");
});

function loadPage(cfg) {
  const posted = [];
  const store = new Map();
  const window = {
    AGENT_WEBCHAT_CONFIG: cfg,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    fetch: async (url) => ({
      ok: true,
      clone() { return { json: async () => (url.endsWith("/token") ? { token: "T1", conversationId: "C1", header: { text: "Rules", every: 2 } } : {}) }; },
    }),
    WebChat: { createDirectLine: (opts) => ({ token: opts.token, postActivity(a) { posted.push(a); return { subscribe() {} }; } }) },
  };
  const ctx = vm.createContext({ window, Object, JSON, Promise, Number, Math });
  vm.runInContext(fs.readFileSync(new URL("../../web/header.js", import.meta.url), "utf8"), ctx, { filename: "header.js" });
  return { window, posted, store };
}

test("web/header.js: header on message 1 and every N-th after; events and other tokens untouched", async () => {
  const { window, posted, store } = loadPage({ tokenEndpoint: "https://w.example/token" });
  await window.fetch("https://w.example/token", {});
  const dl = window.WebChat.createDirectLine({ token: "T1" });
  dl.postActivity({ type: "event", name: "startConversation" });
  for (let i = 1; i <= 5; i++) dl.postActivity({ type: "message", text: "m" + i });
  const msgs = posted.filter((a) => a.type === "message").map((a) => a.text);
  assert.equal(msgs[0], "[session header]\nRules\n[end of header]\n\nm1");
  assert.equal(msgs[1], "m2");
  assert.ok(msgs[2].startsWith("[session header]") && msgs[2].endsWith("m3"));
  assert.equal(msgs[3], "m4");
  assert.ok(msgs[4].endsWith("m5") && msgs[4].startsWith("[session header]"));
  assert.equal(posted[0].text, undefined, "event untouched");
  assert.equal(JSON.parse(store.get("agentHeaderCount")).C1, 5, "count survives a reload");
  const other = window.WebChat.createDirectLine({ token: "unknown" });
  other.postActivity({ type: "message", text: "x" });
  assert.equal(posted[posted.length - 1].text, "x");
  assert.equal(window.AgentHeader.due(0, 0), true);
  assert.equal(window.AgentHeader.due(3, 0), false, "every: 0 = first message only");
});

test("web/header.js: sessionHeader:false leaves fetch and createDirectLine alone", async () => {
  const { window, posted } = loadPage({ tokenEndpoint: "https://w.example/token", sessionHeader: false });
  await window.fetch("https://w.example/token", {});
  window.WebChat.createDirectLine({ token: "T1" }).postActivity({ type: "message", text: "hi" });
  assert.equal(posted[0].text, "hi");
});
