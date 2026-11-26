import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, {
  _resetRateLimiter, safeFileName, partName, partBytes, uploadIdOk, newUploadId, artifactFolder,
  MAX_BODY, MAX_PART, DEFAULT_PART,
} from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "test-secret",
  ACCESS_CODE: "open-sesame",
  ACCESS_CODES: JSON.stringify({ "ravi-code": "Ravi" }),
  LOG_REPO: "silicon-valley-mafia/agent-webchat-logs",
  LOG_REPO_TOKEN: "gh-token",
  ARTIFACT_REPO: "silicon-valley-mafia/artifacts-10",
  OWNER_NAME: "Deepesh",
};
const CONTENTS = "https://api.github.com/repos/silicon-valley-mafia/artifacts-10/contents/";

let puts;
function mockFetch(status = () => 201, message = "") {
  puts = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(url.startsWith(CONTENTS), "only the artifact repo is written: " + url);
    assert.equal(init.method, "PUT");
    let body = init.body;
    if (body && typeof body.getReader === "function") body = await new Response(body).text();
    puts.push({ path: decodeURIComponent(url.slice(CONTENTS.length)), init, body });
    const s = status(puts.length);
    return new Response(JSON.stringify({ message }), { status: s });
  };
}

function post(path, body, headers = {}) {
  const h = { Origin: ORIGIN, "X-Access-Code": "open-sesame", "CF-Connecting-IP": "9.9.9.9", "Content-Type": "application/json", ...headers };
  return new Request("https://w.example" + path, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
}
async function begin(extra = {}, code = "open-sesame") {
  const r = await worker.fetch(post("/artifact", { op: "begin", conversationId: "Conv-1", name: "big video.mp4", size: 10, ...extra }, { "X-Access-Code": code }), env);
  return { status: r.status, j: await r.json() };
}
function putReq(q, body, headers = {}) {
  const qs = new URLSearchParams(q).toString();
  const b = typeof body === "string" ? body : JSON.stringify(body);
  return post("/artifact/put?" + qs, b, { "Content-Length": String(new TextEncoder().encode(b).length), ...headers });
}

beforeEach(() => {
  _resetRateLimiter();
  mockFetch();
});

test("helpers: names, parts, sizes", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\x\\my report (v2).pdf"), "my report (v2).pdf");
  assert.equal(safeFileName("..."), "file");
  assert.equal(safeFileName("नमस्ते.txt"), "______.txt");
  assert.equal(partName("a.bin", 1, 1), "a.bin");
  assert.equal(partName("a.bin", 2, 3), "a.bin.part02of03");
  assert.equal(partName("a.bin", 7, 120), "a.bin.part007of120");
  assert.equal(partBytes({}), DEFAULT_PART);
  assert.equal(partBytes({ ARTIFACT_PART_BYTES: "999999999" }), MAX_PART);
  // a full part, base64-encoded inside the JSON body, still fits Cloudflare's 100 MB request cap
  assert.ok(Math.ceil(MAX_PART / 3) * 4 + 4096 < MAX_BODY);
  assert.ok(Math.ceil(DEFAULT_PART / 3) * 4 + 4096 < MAX_BODY);
});

test("upload ids: minted in IST, valid for 2 days only", () => {
  const now = Date.parse("2026-11-26T21:37:00Z"); // 03:07 IST on the 27th
  const id = newUploadId(env, now);
  assert.match(id, /^20261127-030700-[a-z0-9]{4}$/);
  assert.ok(uploadIdOk(env, id, now));
  assert.ok(!uploadIdOk(env, id, now + 3 * 86400000));
  assert.ok(!uploadIdOk(env, "20261127-030700-ABCD", now));
  assert.ok(!uploadIdOk(env, "../../x", now));
  assert.equal(artifactFolder({ slug: "deepesh" }, "Conv|1", id), "webchat-uploads/2026-11-27/deepesh--Conv_1/030700-" + id.slice(-4));
});

test("begin: worker picks folder and part names", async () => {
  const { status, j } = await begin({ size: DEFAULT_PART * 2 + 5 });
  assert.equal(status, 200);
  assert.equal(j.enabled, true);
  assert.equal(j.repo, "silicon-valley-mafia/artifacts-10");
  assert.equal(j.parts, 3);
  assert.deepEqual(j.names, ["big video.mp4.part01of03", "big video.mp4.part02of03", "big video.mp4.part03of03"]);
  assert.match(j.folder, /^webchat-uploads\/\d{4}-\d{2}-\d{2}\/deepesh--Conv-1\/\d{6}-[a-z0-9]{4}$/);
  assert.equal(puts.length, 0, "begin writes nothing");
  const small = await begin({ size: 1000 });
  assert.deepEqual(small.j.names, ["big video.mp4"]);
});

test("begin: too large / disabled / bad input", async () => {
  assert.equal((await begin({ size: 2 * 1024 ** 3 })).status, 413);
  assert.equal((await begin({ size: -1 })).status, 400);
  assert.equal((await begin({ conversationId: "bad id!" })).status, 400);
  const r = await worker.fetch(post("/artifact", { op: "begin", conversationId: "Conv-1", name: "x", size: 1 }), { ...env, ARTIFACT_REPO: "" });
  assert.deepEqual(await r.json(), { enabled: false, reason: "artifacts_disabled" });
});

test("put: body is streamed through untouched to the worker-chosen path", async () => {
  const { j } = await begin({ size: 3 });
  const body = { message: "webchat upload", content: "YWJj" };
  const r = await worker.fetch(putReq({ conversationId: "Conv-1", uploadId: j.uploadId, name: "big video.mp4", i: 1, n: 1 }, body), env);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.ok, true);
  assert.equal(out.path, j.folder + "/big video.mp4");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, j.folder + "/big video.mp4");
  assert.equal(puts[0].body, JSON.stringify(body));
  assert.equal(puts[0].init.headers.Authorization, "Bearer gh-token");
  assert.equal(puts[0].init.headers["Content-Length"], String(JSON.stringify(body).length));
});

test("put: a name with ../ can't escape the folder; part names come from i/n", async () => {
  const { j } = await begin({ size: 3 });
  await worker.fetch(putReq({ conversationId: "Conv-1", uploadId: j.uploadId, name: "../../logs/x.md", i: 2, n: 3 }, { content: "" }), env);
  assert.equal(puts[0].path, j.folder + "/x.md.part02of03");
});

test("put: person in the path comes from the access code, not the request", async () => {
  const { j } = await begin({ size: 3 }, "ravi-code");
  assert.match(j.folder, /\/ravi--Conv-1\//);
  await worker.fetch(putReq({ conversationId: "Conv-1", uploadId: j.uploadId, name: "a", i: 1, n: 1 }, { content: "" }, { "X-Access-Code": "ravi-code" }), env);
  assert.match(puts[0].path, /^webchat-uploads\/[^/]+\/ravi--Conv-1\//);
});

test("put: existing path (422 sha) = ok/exists; conflicts ask the browser to retry; other errors surface", async () => {
  const { j } = await begin({ size: 3 });
  const q = { conversationId: "Conv-1", uploadId: j.uploadId, name: "a", i: 1, n: 1 };
  mockFetch(() => 422, "Invalid request.\n\n\"sha\" wasn't supplied.");
  assert.deepEqual(await (await worker.fetch(putReq(q, { content: "" }), env)).json(), { ok: true, exists: true, path: j.folder + "/a", repo: env.ARTIFACT_REPO });
  mockFetch(() => 409);
  const c = await worker.fetch(putReq(q, { content: "" }), env);
  assert.equal(c.status, 503);
  assert.equal((await c.json()).retry, true);
  mockFetch(() => 422, "content is not valid Base64");
  const bad = await worker.fetch(putReq(q, { content: "!!" }), env);
  assert.equal(bad.status, 502);
  assert.equal((await bad.json()).error, "github_write_422");
});

test("put: validation (upload id, part range, type, length)", async () => {
  const { j } = await begin({ size: 3 });
  const ok = { conversationId: "Conv-1", uploadId: j.uploadId, name: "a", i: 1, n: 1 };
  assert.equal((await worker.fetch(putReq({ ...ok, uploadId: "20200101-000000-abcd" }, {}), env)).status, 400);
  assert.equal((await worker.fetch(putReq({ ...ok, i: 2 }, {}), env)).status, 400);
  assert.equal((await worker.fetch(putReq({ ...ok, n: 101, i: 1 }, {}), env)).status, 400);
  assert.equal((await worker.fetch(putReq(ok, {}, { "Content-Type": "text/plain" }), env)).status, 415);
  assert.equal((await worker.fetch(putReq(ok, {}, { "Content-Length": String(MAX_BODY + 1) }), env)).status, 413);
  assert.equal((await worker.fetch(putReq(ok, {}, { "X-Access-Code": "nope" }), env)).status, 401);
  assert.equal(puts.length, 0);
});

test("manifest: create-only MANIFEST.md with parts, hashes and a join recipe", async () => {
  const size = DEFAULT_PART + 10;
  const { j } = await begin({ size });
  const h = "a".repeat(64);
  const r = await worker.fetch(post("/artifact", {
    op: "manifest", conversationId: "Conv-1", uploadId: j.uploadId, name: "big video.mp4", size, type: "video/mp4", sha256: h,
    parts: [{ bytes: DEFAULT_PART, sha256: h, ok: true }, { bytes: 10, sha256: "nothex", ok: false }],
  }), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).path, j.folder + "/MANIFEST.md");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, j.folder + "/MANIFEST.md");
  const sent = JSON.parse(puts[0].body);
  assert.equal(sent.branch, undefined, "artifact repo uses its default branch");
  const text = new TextDecoder().decode(Uint8Array.from(atob(sent.content), (c) => c.charCodeAt(0)));
  assert.match(text, /\| Uploaded by \| Deepesh \|/);
  assert.match(text, /\| SHA-256 \| `a{64}` \|/);
  assert.match(text, /`big video.mp4.part01of02` \| 73400320 \| `a{64}` \| yes/);
  assert.match(text, /`big video.mp4.part02of02` \| 10 \|  \| \*\*NO\*\*/);
  assert.match(text, /cat 'big video.mp4.part01of02' 'big video.mp4.part02of02' > 'big video.mp4'/);
  assert.match(text, /copy \/b "big video.mp4.part01of02"\+"big video.mp4.part02of02" "big video.mp4"/);
});

test("manifest: part count must match the size", async () => {
  const { j } = await begin({ size: 5 });
  const r = await worker.fetch(post("/artifact", { op: "manifest", conversationId: "Conv-1", uploadId: j.uploadId, name: "a", size: 5, parts: [{}, {}] }), env);
  assert.equal(r.status, 400);
  assert.equal(puts.length, 0);
});

test("health reports artifacts flag; separate artifact token is used when set", async () => {
  const h = await (await worker.fetch(new Request("https://w.example/health"), env)).json();
  assert.equal(h.artifacts, true);
  const env2 = { ...env, ARTIFACT_REPO_TOKEN: "art-token" };
  const b = await worker.fetch(post("/artifact", { op: "begin", conversationId: "Conv-1", name: "a", size: 1 }), env2);
  const { uploadId } = await b.json();
  await worker.fetch(putReq({ conversationId: "Conv-1", uploadId, name: "a", i: 1, n: 1 }, { content: "" }), env2);
  assert.equal(puts[0].init.headers.Authorization, "Bearer art-token");
});
