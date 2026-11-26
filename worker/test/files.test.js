// Tests for web/files.js (browser attachment handling), run in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import crypto from "node:crypto";
import "../../web/files.js";

const F = globalThis.AgentFiles;
const MiB = 1048576;

/** Minimal ZIP reader: returns [{name, method, data}] after checking CRC and the central directory. */
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = u8.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, "end of central directory");
  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < count; k++) {
    assert.equal(dv.getUint32(cd, true), 0x02014b50, "central header");
    const method = dv.getUint16(cd + 10, true);
    const crc = dv.getUint32(cd + 16, true);
    const csize = dv.getUint32(cd + 20, true);
    const usize = dv.getUint32(cd + 24, true);
    const nlen = dv.getUint16(cd + 28, true);
    const off = dv.getUint32(cd + 42, true);
    const name = new TextDecoder().decode(u8.subarray(cd + 46, cd + 46 + nlen));
    assert.equal(dv.getUint32(off, true), 0x04034b50, "local header");
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = u8.subarray(start, start + csize);
    const data = method === 8 ? new Uint8Array(zlib.inflateRawSync(raw)) : raw;
    assert.equal(data.length, usize);
    assert.equal(F.crc32(data), crc, "crc of " + name);
    out.push({ name, method, data });
    cd += 46 + nlen;
  }
  return out;
}

function rand(n) { return new Uint8Array(crypto.randomBytes(n)); }
function file(bytes, name, type = "") { return new File([bytes], name, { type }); }
async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }

test("crc32 matches zlib", () => {
  const d = rand(5000);
  assert.equal(F.crc32(d), zlib.crc32(d));
  assert.equal(F.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("makeZip: stored and deflated entries round-trip, UTF-8 names", async () => {
  const text = new TextEncoder().encode("hello ".repeat(2000));
  const deflated = await F.deflateRaw(text);
  assert.ok(deflated && deflated.length < text.length);
  const bin = rand(3000);
  const z = F.makeZip([{ name: "नोट्स.txt", data: text, deflated }, { name: "b.bin", data: bin, deflated: await F.deflateRaw(bin) }]);
  const e = readZip(z);
  assert.equal(e[0].name, "नोट्स.txt");
  assert.equal(e[0].method, 8);
  assert.deepEqual(e[0].data, text);
  assert.equal(e[1].method, 0, "incompressible data stays stored");
  assert.deepEqual(e[1].data, bin);
});

const lim = F.limits({ agentMaxFileMB: 1, agentMaxParts: 5 });

test("limits: defaults follow the Direct Line 4 MB cap", () => {
  const d = F.limits({});
  assert.equal(d.maxBytes, Math.floor(3.8 * MiB));
  assert.ok(d.maxBytes < 4 * MiB);
  assert.deepEqual(d.types, ["docx", "csv", "pdf", "txt", "jpg", "jpeg", "png", "webp", "gif"]);
});

test("plan: supported + small -> as-is", async () => {
  const f = file(rand(1000), "Photo.PNG", "image/png");
  const p = await F.planDelivery(f, lim);
  assert.equal(p.mode, "as-is");
  assert.equal(p.items[0].blob, f);
});

test("plan: unsupported type -> one zip with the original inside", async () => {
  const data = rand(2000);
  const p = await F.planDelivery(file(data, "design.v"), lim);
  assert.equal(p.mode, "zip");
  assert.match(p.reason, /\.v is not supported/);
  assert.equal(p.items[0].name, "design.v.zip");
  const e = readZip(await blobBytes(p.items[0].blob));
  assert.equal(e[0].name, "design.v");
  assert.deepEqual(e[0].data, data);
});

test("plan: too large but compressible -> single deflated zip", async () => {
  const text = new TextEncoder().encode("x".repeat(3 * MiB));
  const p = await F.planDelivery(file(text, "log.txt", "text/plain"), lim);
  assert.equal(p.mode, "zip");
  assert.ok(p.items[0].blob.size <= lim.maxBytes);
  assert.deepEqual(readZip(await blobBytes(p.items[0].blob))[0].data, text);
});

test("plan: too large -> independent zip parts that rebuild the original exactly", async () => {
  const data = rand(Math.floor(2.5 * MiB));
  const p = await F.planDelivery(file(data, "dump.bin"), lim);
  assert.equal(p.mode, "parts");
  assert.deepEqual(p.items.map((i) => i.name), ["dump.bin.part01of03.zip", "dump.bin.part02of03.zip", "dump.bin.part03of03.zip"]);
  const pieces = [];
  for (const it of p.items) {
    assert.ok(it.blob.size <= lim.maxBytes, "each part fits one message");
    const e = readZip(await blobBytes(it.blob));
    assert.equal(e.length, 1);
    assert.equal(e[0].method, 0);
    pieces.push(e[0].data);
  }
  assert.deepEqual(new Uint8Array(Buffer.concat(pieces)), data);
});

test("plan: needs more than maxParts -> skip (not sent in chat)", async () => {
  const p = await F.planDelivery(file(rand(6 * MiB), "movie.mp4"), lim);
  assert.equal(p.mode, "skip");
  assert.match(p.reason, /would need 7 messages \(limit 5\)/);
  assert.equal(p.items.length, 0);
});

test("batch: messages stay under the per-message limit", () => {
  const it = (n) => ({ blob: { size: n } });
  const b = F.batch([it(600), it(300), it(200), it(900), it(50)], 1000);
  assert.deepEqual(b.map((g) => g.map((x) => x.blob.size)), [[600, 300], [200], [900, 50]]);
});

test("describe: explains what happened and where the original is", () => {
  const f = { name: "a.mp4", size: 5 * MiB };
  const s = F.describe(f, { mode: "parts", reason: "too large", items: [{ name: "a.mp4.part01of02.zip" }, { name: "a.mp4.part02of02.zip" }] },
    { repo: "silicon-valley-mafia/artifacts-10", folder: "webchat-uploads/2026-11-27/deepesh--c/030700-ab12", parts: 1 });
  assert.match(s, /^- a\.mp4 \(5\.0 MB\): too large, so it was sent as 2 zip parts/);
  assert.match(s, /\*\*silicon-valley-mafia\/artifacts-10\*\* → `webchat-uploads\/2026-11-27\/deepesh--c\/030700-ab12\/`/);
  assert.equal(F.describe({ name: "x.png", size: 1 }, { mode: "as-is", items: [] }, null), "");
});

test("uploadArtifact: parts as base64 JSON, retries conflicts, then a manifest with hashes", async () => {
  const data = rand(2500);
  const f = file(data, "big.bin");
  const art = { uploadId: "20261127-030700-ab12", parts: 3, partBytes: 1000, folder: "x" };
  const calls = [];
  let conflict = true;
  globalThis.fetch = async (url, init) => {
    const body = init.body instanceof Blob ? await init.body.text() : init.body;
    calls.push({ url, body });
    if (url.includes("/artifact/put")) {
      if (url.includes("&i=2&") && conflict) { conflict = false; return Response.json({ error: "github_write_409", retry: true }, { status: 503 }); }
      return Response.json({ ok: true, created: true });
    }
    return Response.json({ ok: true });
  };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    const states = [];
    const res = await F.uploadArtifact({ base: "https://w", code: "c", conversationId: "Conv-1" }, f, art, (s) => states.push(s));
    assert.deepEqual(res, { ok: true, saved: 3, parts: 3 });
    assert.deepEqual(states, ["Saving big.bin part 1/3…", "Saving big.bin part 2/3…", "Saving big.bin part 3/3…"]);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  const puts = calls.filter((c) => c.url.includes("/artifact/put"));
  assert.equal(puts.length, 4, "part 2 retried once");
  const rebuilt = Buffer.concat([puts[0], puts[2], puts[3]].map((c) => Buffer.from(JSON.parse(c.body).content, "base64")));
  assert.deepEqual(new Uint8Array(rebuilt), data);
  assert.equal(JSON.parse(puts[0].body).message, "webchat upload: big.bin part 1/3");
  assert.match(puts[0].url, /uploadId=20261127-030700-ab12&name=big\.bin&i=1&n=3$/);
  const man = JSON.parse(calls[calls.length - 1].body);
  assert.equal(man.op, "manifest");
  assert.equal(man.sha256, crypto.createHash("sha256").update(data).digest("hex"));
  assert.deepEqual(man.parts.map((p) => p.bytes), [1000, 1000, 500]);
  assert.equal(man.parts[2].sha256, crypto.createHash("sha256").update(data.subarray(2000)).digest("hex"));
});
