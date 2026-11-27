// TODO #7: the access code's role goes to the agent in startConversation (advisory; the Worker decides it).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker, { personRole } from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "secret-github",
  DEFAULT_AGENT_ID: "github",
  ACCESS_CODE: "owner-code",
  ACCESS_CODES: JSON.stringify({
    "ravi-code": "Ravi",
    "ro-code": { name: "Guest", role: "readOnly" },
    "boss-code": { name: "Boss", admin: true },
    "fake-code": { name: "Fake", role: "admin" },
    "lead-code": { name: "Lead", admin: true, role: "owner" },
  }),
  RATE_LIMIT_PER_MIN: "100",
  API_RATE_LIMIT_PER_MIN: "100",
};

beforeEach(() => {
  _resetRateLimiter();
  globalThis.fetch = async () => Response.json({ token: "tok", expires_in: 3600, conversationId: "conv-1" });
});

test("personRole: owner code, explicit roles, admin flag; admin/owner only for real admins", () => {
  assert.equal(personRole(env, "owner-code", { admin: true }), "owner");
  assert.equal(personRole(env, "ravi-code", { admin: false }), "user");
  assert.equal(personRole(env, "ro-code", { admin: false }), "readOnly");
  assert.equal(personRole(env, "boss-code", { admin: true }), "admin");
  assert.equal(personRole(env, "fake-code", { admin: false }), "user", "role:admin without admin:true is not trusted");
  assert.equal(personRole(env, "lead-code", { admin: true }), "owner");
});

test("/token and /resume answer with the role the Worker decided", async () => {
  const req = (path, code, body) => new Request("https://w.example" + path, {
    method: "POST", headers: { Origin: ORIGIN, "X-Access-Code": code, "CF-Connecting-IP": "1.1.1.1", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await (await worker.fetch(req("/token", "ro-code"), env)).json()).role, "readOnly");
  assert.equal((await (await worker.fetch(req("/token", "owner-code"), env)).json()).role, "owner");
  assert.equal((await (await worker.fetch(req("/resume", "ravi-code", { conversationId: "conv-1" }), env)).json()).role, "user");
});

function loadPage(cfg) {
  const posted = [];
  const window = {
    AGENT_WEBCHAT_CONFIG: cfg,
    fetch: async (url) => ({ ok: true, clone() { return { json: async () => (url.endsWith("/token") ? { token: "T1", role: "readOnly" } : { ok: 1 }) }; } }),
    WebChat: { createDirectLine: (opts) => ({ token: opts.token, postActivity(a) { posted.push(a); return { subscribe() {} }; } }) },
  };
  const ctx = vm.createContext({ window, Object, JSON, Promise });
  vm.runInContext(fs.readFileSync(new URL("../../web/role.js", import.meta.url), "utf8"), ctx, { filename: "role.js" });
  return { window, posted };
}

test("web/role.js: startConversation gets channelData.awRole + value.role; messages untouched", async () => {
  const { window, posted } = loadPage({ tokenEndpoint: "https://w.example/token" });
  await window.fetch("https://w.example/token", {});
  const dl = window.WebChat.createDirectLine({ token: "T1" });
  dl.postActivity({ type: "event", name: "startConversation", locale: "en-US", channelData: { x: 1 } });
  dl.postActivity({ type: "message", text: "hi" });
  assert.equal(posted[0].channelData.awRole, "readOnly");
  assert.equal(posted[0].channelData.x, 1);
  assert.equal(posted[0].value.role, "readOnly");
  assert.equal(posted[0].locale, "en-US");
  assert.deepEqual(posted[1], { type: "message", text: "hi" });
  const other = window.WebChat.createDirectLine({ token: "unknown" });
  other.postActivity({ type: "event", name: "startConversation" });
  assert.equal(posted[2].channelData, undefined, "no role known for that token -> nothing added");
});

test("web/role.js: sendRole:false leaves fetch and createDirectLine alone", async () => {
  const { window, posted } = loadPage({ tokenEndpoint: "https://w.example/token", sendRole: false });
  await window.fetch("https://w.example/token", {});
  window.WebChat.createDirectLine({ token: "T1" }).postActivity({ type: "event", name: "startConversation" });
  assert.equal(posted[0].channelData, undefined);
  assert.equal(window.AgentRole.tag({ type: "event", name: "startConversation" }, "bogus").channelData, undefined);
});
