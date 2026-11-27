
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
