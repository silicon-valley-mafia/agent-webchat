// TODO #37a: POST /file reads an allowed .md / .txt file (read-only token, allow-list per code, 30 KB cap).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker from "../src/main.js";
import { _resetRateLimiter } from "../src/index.js";
import { normRoot, fileRoots, badPath, allowed } from "../src/repofile.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "s",
  ACCESS_CODE: "owner-code",
  ACCESS_CODES: JSON.stringify({ "ravi-code": "Ravi", "mia-code": { name: "Mia", files: ["acme/notes/public/"] } }),
  OWNER_FILES: JSON.stringify(["acme/site/docs/", "acme/site/web", "acme/plans/", "acme/logs/handoff/"]),
  FILE_READ_TOKEN: "read-only",
  API_RATE_LIMIT_PER_MIN: "1000",
};
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

let seen;
beforeEach(() => {
  _resetRateLimiter();
  seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url, auth: init.headers && init.headers.Authorization });
    if (url.endsWith("/contents/docs")) return Response.json([
      { name: "README.md", path: "docs/README.md", type: "file", size: 10 },
      { name: "img.png", path: "docs/img.png", type: "file", size: 10 },
      { name: "sub", path: "docs/sub", type: "dir" },
    ]);
    if (url.endsWith("/contents/")) return Response.json([
      { name: "docs", path: "docs", type: "dir" }, { name: "worker", path: "worker", type: "dir" }, { name: "README.md", path: "README.md", type: "file", size: 5 },
    ]);
    if (url.includes("/contents/docs/README.md")) return Response.json({ type: "file", name: "README.md", size: 13, sha: "abcdef1234567", encoding: "base64", content: b64("# Hello ✓\nhi\n") });
    if (url.includes("/contents/docs/big.md")) return Response.json({ type: "file", name: "big.md", size: 40000, sha: "x", encoding: "base64", content: "" });
    if (url.includes("/contents/docs/a.pdf")) return Response.json({ type: "file", name: "a.pdf", size: 10, sha: "x", encoding: "base64", content: "" });
    return new Response("{}", { status: 404 });
  };
});

const call = async (code, body, e = env) => {
  const r = await worker.fetch(new Request("https://w.example/file", {
    method: "POST", headers: { Origin: ORIGIN, "X-Access-Code": code, "CF-Connecting-IP": "2.2.2.2", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), e);
  return { status: r.status, j: await r.json() };
};

test("allow-list helpers", () => {
  assert.equal(normRoot("acme/site/docs"), "acme/site/docs/");
  assert.equal(normRoot("/acme/site/"), "acme/site/");
  assert.equal(normRoot("acme"), "");
  assert.equal(normRoot("acme/site/../x/"), "");
  assert.deepEqual(fileRoots(env, "owner-code"), ["acme/site/docs/", "acme/site/web/", "acme/plans/", "acme/logs/handoff/"]);
  assert.deepEqual(fileRoots(env, "ravi-code"), [], "other codes: none");
  assert.deepEqual(fileRoots(env, "mia-code"), ["acme/notes/public/"]);
  assert.equal(badPath("acme/site", "docs/../worker/src/index.js"), "bad_path");
  assert.equal(badPath("acme/site", ".github/workflows/x.md"), "bad_path");
  assert.equal(badPath("acme/site", "/etc"), "bad_path");
  assert.equal(badPath("acme site", "x"), "bad_repo");
  const roots = fileRoots(env, "owner-code");
  assert.equal(allowed(roots, "acme/site", "docs/a.md", false), true);
  assert.equal(allowed(roots, "acme/site", "worker/x.md", false), false);
  assert.equal(allowed(roots, "acme/site", "", true), true, "repo root leads to docs/");
  assert.equal(allowed(roots, "acme/site", "docsX/a.md", false), false, "prefix must end at a folder");
  assert.equal(allowed(roots, "acme/plans", "any/deep/file.md", false), true);
});

test("roots: owner sees the list, others none", async () => {
  assert.deepEqual((await call("owner-code", { op: "roots" })).j.roots.length, 4);
  assert.deepEqual((await call("ravi-code", { op: "roots" })).j.roots, []);
  assert.equal((await call("ravi-code", { op: "get", repo: "acme/site", path: "docs/README.md" })).status, 403);
});

test("get a file: text, sha header, read-only token", async () => {
  const { status, j } = await call("owner-code", { op: "get", repo: "acme/site", path: "docs/README.md" });
  assert.equal(status, 200);
  assert.equal(j.text, "# Hello ✓\nhi\n");
  assert.equal(j.header, "[file: acme/site/docs/README.md@abcdef1]");
  assert.equal(seen[0].auth, "Bearer read-only");
});

test("directory listing keeps only allowed folders and text files", async () => {
  let { j } = await call("owner-code", { op: "get", repo: "acme/site", path: "" });
  assert.deepEqual(j.entries.map((e) => e.name), ["docs"], "worker/ and README.md at the root are outside docs/ and web/");
  ({ j } = await call("owner-code", { op: "get", repo: "acme/site", path: "docs" }));
  assert.deepEqual(j.entries.map((e) => e.name), ["sub", "README.md"]);
});

test("refusals: outside allow-list, traversal, too big, not text, no token", async () => {
  assert.equal((await call("owner-code", { op: "get", repo: "acme/site", path: "worker/src/index.js" })).j.error, "path_not_allowed");
  assert.equal((await call("owner-code", { op: "get", repo: "acme/other", path: "x.md" })).j.error, "path_not_allowed");
  assert.equal((await call("owner-code", { op: "get", repo: "acme/site", path: "docs/../worker/a.md" })).j.error, "bad_path");
  const big = await call("owner-code", { op: "get", repo: "acme/site", path: "docs/big.md" });
  assert.equal(big.status, 413);
  assert.equal(big.j.maxBytes, 30720);
  assert.equal((await call("owner-code", { op: "get", repo: "acme/site", path: "docs/a.pdf" })).status, 415);
  assert.equal((await call("owner-code", { op: "roots" }, { ...env, FILE_READ_TOKEN: "" })).j.error, "file_disabled");
  assert.equal((await call("nope", { op: "roots" })).status, 401);
});

test("web/insert.js pure helpers", () => {
  const window = { AGENT_WEBCHAT_CONFIG: { insertFile: false } };
  vm.runInContext(fs.readFileSync(new URL("../../web/insert.js", import.meta.url), "utf8"), vm.createContext({ window }), { filename: "insert.js" });
  const A = window.AgentInsert;
  const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm realm
  assert.deepEqual(plain(A.parse("acme/site/docs/a.md")), { repo: "acme/site", path: "docs/a.md" });
  assert.deepEqual(plain(A.parse("acme/site/")), { repo: "acme/site", path: "" });
  assert.equal(A.parse("acme"), null);
  const f = { header: "[file: acme/site/docs/a.md@abcdef1]", text: "body\n\n" };
  assert.equal(A.compose("", f), "[file: acme/site/docs/a.md@abcdef1]\nbody\n[end of file]");
  assert.equal(A.compose("Summarise this:  ", f), "Summarise this:\n\n[file: acme/site/docs/a.md@abcdef1]\nbody\n[end of file]");
});
