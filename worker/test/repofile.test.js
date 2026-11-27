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

// ---------- Hardening 2026-11-28: the read token may cover many repos, so /file must hold the line itself ----------
import { sensitive } from "../src/repofile.js";

test("hardening: a symlink that resolves to another path is refused", async () => {
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes("/contents/docs/link.md")
    ? Response.json({ type: "file", name: "index.md", path: "worker/index.md", size: 5, sha: "s", encoding: "base64", content: b64("x") })
    : base(url, init);
  const r = await call("owner-code", { op: "get", repo: "acme/site", path: "docs/link.md" });
  assert.equal(r.status, 403);
  assert.equal(r.j.error, "path_not_allowed");
});

test("hardening: ref is refused (default branch only)", async () => {
  const r = await call("owner-code", { op: "get", repo: "acme/site", path: "docs/README.md", ref: "old-branch" });
  assert.equal(r.status, 400);
  assert.equal(r.j.error, "bad_ref");
  assert.equal(seen.filter((x) => String(x.url).includes("/contents/")).length, 0, "GitHub not asked");
});

test("hardening: secret-looking names are never served or listed", async () => {
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith("/contents/docs/sub") ? Response.json([
    { name: "passwords.txt", path: "docs/sub/passwords.txt", type: "file", size: 3 },
    { name: "notes.md", path: "docs/sub/notes.md", type: "file", size: 3 },
    { name: ".env.md", path: "docs/sub/.env.md", type: "file", size: 3 },
  ]) : base(url, init);
  for (const p of ["docs/api-keys.md", "docs/my-secrets.md", "docs/.env.txt", "docs/credentials/x.md", "docs/private_key.txt", "docs/Password.md"]) {
    const r = await call("owner-code", { op: "get", repo: "acme/site", path: p });
    assert.equal(r.j.error, "sensitive_name", p);
  }
  assert.equal(seen.filter((x) => String(x.url).includes("/contents/")).length, 0, "refused before GitHub is asked");
  const d = await call("owner-code", { op: "get", repo: "acme/site", path: "docs/sub" });
  assert.deepEqual(d.j.entries.map((e) => e.name), ["notes.md"]);
  const off = await call("owner-code", { op: "get", repo: "acme/site", path: "docs/my-secrets.md" }, { ...env, FILE_SENSITIVE_CHECK: "off" });
  assert.equal(off.status, 404, "off switch: GitHub is asked (the mock has no such file)");
  assert.equal(sensitive({}, "docs/tokenizer.md"), false);
  assert.equal(sensitive({}, "docs/secretary-notes.md"), false);
  assert.equal(sensitive({}, "docs/README.md"), false);
});

test("hardening: file reads and refusals are recorded in the logs repo; listings and roots are not", async () => {
  const e = { ...env, LOG_REPO: "acme/logs", LOG_REPO_TOKEN: "log-token" };
  const audits = () => seen.filter((x) => String(x.url).includes("/repos/acme/logs/contents/audit/file-reads/"));
  await call("owner-code", { op: "get", repo: "acme/site", path: "docs/README.md" }, e);
  assert.equal(audits().length, 1);
  assert.match(String(audits()[0].url), /audit\/file-reads\/\d{4}-\d{2}-\d{2}\/\d{6}-owner-[0-9a-f]{4}\.md$/);
  assert.equal(audits()[0].auth, "Bearer log-token");
  await call("owner-code", { op: "get", repo: "acme/site", path: "worker/x.md" }, e);
  assert.equal(audits().length, 2, "a refusal is recorded too");
  await call("owner-code", { op: "get", repo: "acme/site", path: "docs" }, e);
  await call("owner-code", { op: "roots" }, e);
  assert.equal(audits().length, 2, "listings and roots are not recorded");
  await call("owner-code", { op: "get", repo: "acme/site", path: "docs/README.md" }, { ...e, FILE_AUDIT: "off" });
  assert.equal(audits().length, 2, "off switch");
});

test("hardening: /file has its own per-IP limit (FILE_RATE_PER_MIN)", async () => {
  const e = { ...env, FILE_RATE_PER_MIN: "2" };
  assert.equal((await call("owner-code", { op: "roots" }, e)).status, 200);
  assert.equal((await call("owner-code", { op: "roots" }, e)).status, 200);
  assert.equal((await call("owner-code", { op: "roots" }, e)).status, 429);
});
