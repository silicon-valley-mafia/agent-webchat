// TODO #57 "💾 Save": POST /save writes the ⬇ Download Markdown to saved/<Download file name> and overwrites it later.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { OWN_ROUTES } from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";
import { savePath, saveDir, saveEnabled, messagesOf, SAVE_ATTEMPTS } from "../src/save.js";
import "../../web/save.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const CONTENTS = "https://api.github.com/repos/silicon-valley-mafia/agent-webchat-logs/contents/";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "secret-github",
  DEFAULT_AGENT_ID: "github",
  DEFAULT_AGENT_NAME: "GitHub Agent",
  AGENTS: JSON.stringify({ coach: { name: "VLSI Coach", secret: "secret-coach", num: 2 } }),
  ACCESS_CODE: "owner-code",
  OWNER_NAME: "Deepesh",
  ACCESS_CODES: JSON.stringify({
    "ravi-code": { name: "Ravi", agents: ["coach"] },
    "viewer-code": { name: "Viewer", role: "readOnly" },
  }),
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
  RATE_LIMIT_PER_MIN: "100",
  API_RATE_LIMIT_PER_MIN: "100",
};
const FILE = "saved/2_2026-11-27_1700-deepesh--Conv-9-in.md";
const m = (id, text, t, user) => ({ id, type: "message", text, timestamp: t, from: user ? { id: "dl_abc", role: "user" } : { id: "bot", name: "VLSI Coach", role: "bot" } });

let acts, files, puts, gets, dlAuth, failPuts;
const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
beforeEach(() => {
  _resetRateLimiter();
  acts = [m("1", "hi", "2026-11-27T11:30:05Z", true), m("2", "hello", "2026-11-27T11:30:09Z")];
  files = new Map(); // path -> {sha, text}
  puts = [];
  gets = 0;
  dlAuth = [];
  failPuts = []; // statuses to answer the next PUTs with (409 / 422 / 500)
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes("/v3/directline/conversations/")) {
      dlAuth.push(init.headers.Authorization);
      return Response.json({ activities: url.includes("watermark=") ? [] : acts, watermark: "9" });
    }
    if (url.startsWith(CONTENTS)) {
      const path = decodeURIComponent(url.slice(CONTENTS.length).split("?")[0]);
      if (!init.method || init.method === "GET") {
        gets++;
        assert.match(url, /\?ref=main$/);
        const f = files.get(path);
        if (!f) return new Response("{}", { status: 404 });
        // GitHub wraps base64 at 60 characters
        return Response.json({ sha: f.sha, content: enc(f.text).replace(/(.{60})/g, "$1\n") });
      }
      const body = JSON.parse(init.body);
      puts.push({ path, sha: body.sha, branch: body.branch, message: body.message, text: dec(body.content) });
      const fail = failPuts.shift();
      if (fail) return new Response("{}", { status: fail });
      const f = files.get(path);
      if (f && body.sha !== f.sha) return new Response("{}", { status: f ? 409 : 422 });
      if (!f && body.sha) return new Response("{}", { status: 422 });
      const sha = "sha" + (puts.length);
      files.set(path, { sha, text: dec(body.content) });
      return Response.json({ content: { sha }, commit: { sha: "c" + puts.length } }, { status: f ? 200 : 201 });
    }
    throw new Error("unexpected fetch " + url);
  };
});

function req(path, body, { code = "owner-code", agent, method = "POST", origin = ORIGIN } = {}) {
  const headers = { Origin: origin, "X-Access-Code": code, "CF-Connecting-IP": "1.2.3.4", "Content-Type": "application/json" };
  if (agent) headers["X-Agent"] = agent;
  return new Request("https://w.example" + path, { method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined });
}
const save = async (opts = {}, body = { conversationId: "Conv-9-in" }) => {
  const res = await worker.fetch(req("/save", body, { agent: "coach", ...opts }), env);
  return { status: res.status, j: await res.json(), res };
};

test("first save creates saved/<Download file name> with the same Markdown as /export", async () => {
  const exp = await (await worker.fetch(req("/export", { conversationId: "Conv-9-in" }, { agent: "coach" }), env)).json();
  const { status, j, res } = await save();
  assert.equal(status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(FILE, "saved/" + exp.filename);
  assert.deepEqual(j, {
    saved: true, status: "created", path: FILE, repo: env.LOG_REPO, branch: "main",
    url: "https://github.com/silicon-valley-mafia/agent-webchat-logs/blob/main/" + FILE, commit: "c1", messages: 2,
  });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].sha, undefined, "new file: no sha");
  assert.equal(puts[0].branch, "main");
  assert.equal(puts[0].message, "save(deepesh): 2_2026-11-27_1700-deepesh--Conv-9-in.md");
  assert.equal(puts[0].text, exp.markdown);
  assert.equal(dlAuth.at(-1), "Bearer secret-coach", "read through the conversation's agent");
});

test("saving again after more chat overwrites the same file with the whole conversation", async () => {
  await save();
  acts.push(m("3", "one more question", "2026-11-27T11:35:00Z", true), m("4", "answer", "2026-11-27T11:35:04Z"));
  const { status, j } = await save();
  assert.equal(status, 200);
  assert.equal(j.status, "updated");
  assert.equal(j.messages, 4);
  assert.equal(puts.length, 2);
  assert.equal(puts[1].path, FILE);
  assert.equal(puts[1].sha, "sha1", "overwrite sends the current sha");
  assert.match(files.get(FILE).text, /hi[\s\S]*hello[\s\S]*one more question[\s\S]*answer/);
  assert.equal([...files.keys()].length, 1, "still one file");
});

test("nothing new since the last save -> unchanged, no commit", async () => {
  await save();
  const { j } = await save();
  assert.equal(j.status, "unchanged");
  assert.equal(puts.length, 1);
});

test("parallel saves never fail: a 409 / 422 re-reads the sha and writes again", async () => {
  failPuts = [409, 422];
  const { status, j } = await save();
  assert.equal(status, 200);
  assert.equal(j.saved, true);
  assert.equal(puts.length, 3);
  const both = await Promise.all([save(), (acts.push(m("5", "x", "2026-11-27T11:40:00Z", true)), save())]);
  for (const r of both) assert.equal(r.j.saved, true);
});

test("gives up after SAVE_ATTEMPTS conflicts; other GitHub errors are reported", async () => {
  failPuts = Array(SAVE_ATTEMPTS).fill(409);
  let r = await save();
  assert.equal(r.status, 502);
  assert.equal(r.j.error, "github_conflict");
  failPuts = [403];
  r = await save();
  assert.equal(r.j.error, "github_write_403");
});

test("refusals: bad code, read-only code, agent not allowed, bad id, saving off, foreign origin, GET", async () => {
  assert.equal((await save({ code: "nope" })).status, 401);
  const ro = await save({ code: "viewer-code", agent: undefined });
  assert.deepEqual([ro.status, ro.j.error], [403, "read_only"]);
  const na = await save({ code: "ravi-code", agent: "github" });
  assert.deepEqual([na.status, na.j.error], [403, "agent_not_allowed"]);
  assert.equal((await save({}, { conversationId: "../x" })).status, 400);
  let res = await worker.fetch(req("/save", { conversationId: "Conv-9-in" }), { ...env, LOG_REPO_TOKEN: "" });
  assert.deepEqual([res.status, (await res.json()).error], [400, "save_disabled"]);
  res = await worker.fetch(req("/save", { conversationId: "Conv-9-in" }), { ...env, SAVE_BUTTON: "off" });
  assert.equal(res.status, 400);
  assert.equal((await worker.fetch(req("/save", {}, { origin: "https://evil.example" }), env)).status, 403);
  assert.equal((await worker.fetch(req("/save", null, { method: "GET" }), env)).status, 405);
  assert.equal(puts.length, 0);
});

test("ravi (coach only) can save his own chat; without X-Agent his default agent is used", async () => {
  const { status, j } = await save({ code: "ravi-code", agent: undefined });
  assert.equal(status, 200);
  assert.equal(j.path, "saved/2_2026-11-27_1700-ravi--Conv-9-in.md");
  assert.equal(puts[0].message, "save(ravi): 2_2026-11-27_1700-ravi--Conv-9-in.md");
});

test("preflight for /save: 204 with X-Agent allowed", async () => {
  assert.ok(OWN_ROUTES.has("/save"));
  const r = await worker.fetch(new Request("https://w.example/save", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } }), env);
  assert.equal(r.status, 204);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /X-Agent/);
});

test("helpers: savePath, saveDir, saveEnabled, messagesOf", () => {
  assert.equal(savePath({}, "1_2026-11-27_0140-deepesh--C-1.md"), "saved/1_2026-11-27_0140-deepesh--C-1.md");
  assert.equal(savePath({ SAVE_DIR: "/exports/full/" }, "a.md"), "exports/full/a.md");
  assert.equal(savePath({}, "../a.md"), null);
  assert.equal(savePath({}, "a/b.md"), null);
  assert.equal(savePath({}, "a..md"), null);
  assert.equal(savePath({}, "a.txt"), null);
  assert.equal(saveDir({ SAVE_DIR: "../etc" }), "saved");
  assert.equal(saveEnabled({ LOG_REPO: "o/r", LOG_REPO_TOKEN: "t" }), true);
  assert.equal(saveEnabled({ LOG_REPO: "o/r", LOG_REPO_TOKEN: "t", SAVE_BUTTON: "OFF" }), false);
  assert.equal(saveEnabled({ LOG_REPO: "o/r" }), false);
  assert.equal(messagesOf("| Messages | 12 (You: 6, agent: 6) |"), 12);
  assert.equal(messagesOf("no table"), null);
});

test("web/save.js pure parts", () => {
  const S = globalThis.AgentSave;
  assert.equal(S.base("https://w.example/token"), "https://w.example");
  assert.equal(S.base("REPLACE_WITH_URL"), "");
  assert.equal(S.message({ saved: true, status: "created", messages: 2, repo: "o/r", path: "saved/a.md" }), "Saved - 2 messages -> o/r/saved/a.md");
  assert.equal(S.message({ saved: true, status: "updated", messages: 4, repo: "o/r", path: "saved/a.md" }), "Saved (overwritten) - 4 messages -> o/r/saved/a.md");
  assert.equal(S.message({ saved: true, status: "unchanged", repo: "o/r", path: "saved/a.md" }), "Already up to date -> o/r/saved/a.md");
  assert.equal(S.message({ error: "read_only" }, 403), "Save failed: This access code is read-only - it can't save to GitHub.");
  assert.equal(S.message({}, 500), "Save failed: HTTP 500");
  assert.equal(S.agentId("C1", null, {}), "", "single-agent setups send no X-Agent");
});
