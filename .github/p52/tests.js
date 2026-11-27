
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
