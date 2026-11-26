/**
 * Attached files -> artifact repo (ARTIFACT_REPO, default branch), create-only.
 * Split out of index.js; shares its helpers (imported below, used only at call time).
 */
import { json, createOnly, contentsUrl, ghHeaders, localParts, CONV_RE } from "./index.js";

// ---------- attached files -> artifact repo ----------
// The browser base64-encodes each part and sends the complete GitHub "create file" JSON body.
// The Worker never touches those bytes (the 10 ms CPU limit on the free plan): it checks the
// caller, picks the path itself, and streams the body straight through to GitHub.

/** Cloudflare Free/Pro reject request bodies over 100 MB before the Worker runs. */
export const MAX_BODY = 100000000;
/** Largest raw part whose base64 JSON body still fits under MAX_BODY (~71.5 MiB). */
export const MAX_PART = 3 * Math.floor((MAX_BODY - 8192) / 4);
export const DEFAULT_PART = 70 * 1024 * 1024;
export const MAX_PARTS = 100;
export const UPLOAD_ID_RE = /^(\d{4})(\d{2})(\d{2})-(\d{6})-([a-z0-9]{4})$/;

function artifactRepo(env) {
  return env.ARTIFACT_REPO || "";
}
function artifactToken(env) {
  return env.ARTIFACT_REPO_TOKEN || env.LOG_REPO_TOKEN || "";
}
export function artifactsEnabled(env) {
  return Boolean(artifactRepo(env) && artifactToken(env));
}
export function partBytes(env) {
  const n = parseInt(env.ARTIFACT_PART_BYTES || "", 10);
  return n > 0 ? Math.min(n, MAX_PART) : DEFAULT_PART;
}
function maxArtifactBytes(env) {
  const n = parseInt(env.ARTIFACT_MAX_BYTES || "", 10);
  return n > 0 ? n : 1024 * 1024 * 1024;
}

/** Keeps the extension, drops path separators and odd characters. */
export function safeFileName(name) {
  const s = String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^A-Za-z0-9._ ()+-]/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/\s+$/, "")
    .slice(-120);
  return s || "file";
}

/** name, or name.part01of03 when split. */
export function partName(base, i, n) {
  if (n === 1) return base;
  const w = Math.max(2, String(n).length);
  return base + ".part" + String(i).padStart(w, "0") + "of" + String(n).padStart(w, "0");
}

export function newUploadId(env, now = Date.now()) {
  const offset = parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10);
  const p = localParts(new Date(now).toISOString(), offset);
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return p.date.replace(/-/g, "") + "-" + p.time.replace(/:/g, "") + "-" + rnd;
}

/** Upload ids are minted by /artifact begin; accept them for 2 days. */
export function uploadIdOk(env, id, now = Date.now()) {
  const m = typeof id === "string" ? UPLOAD_ID_RE.exec(id) : null;
  if (!m) return false;
  const offset = parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10);
  const t = Date.parse(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4].slice(0, 2) + ":" + m[4].slice(2, 4) + ":" + m[4].slice(4) + "Z") - offset * 60000;
  return Number.isFinite(t) && Math.abs(now - t) <= 2 * 86400000;
}

/** webchat-uploads/<day>/<person>--<conversation>/<HHMMSS>-<rand> (person comes from the access code). */
export function artifactFolder(person, conversationId, uploadId) {
  const m = UPLOAD_ID_RE.exec(uploadId);
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return "webchat-uploads/" + m[1] + "-" + m[2] + "-" + m[3] + "/" + person.slug + "--" + safe + "/" + m[4] + "-" + m[5];
}

function fmtBytes(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(2) + " MiB" : n >= 1024 ? (n / 1024).toFixed(1) + " KiB" : n + " B";
}

export function manifestText(person, conversationId, uploadId, folder, f) {
  const out = [
    "# " + f.name,
    "",
    "| | |",
    "|---|---|",
    "| Uploaded by | " + person.name + " |",
    "| Conversation ID | `" + conversationId + "` |",
    "| Upload ID | `" + uploadId + "` |",
    "| Original name | `" + String(f.name).replace(/`/g, "'") + "` |",
    "| Type | " + (f.type || "unknown") + " |",
    "| Size | " + f.size + " bytes (" + fmtBytes(f.size) + ") |",
    "| SHA-256 | " + (f.sha256 ? "`" + f.sha256 + "`" : "not computed (file too large to hash in the browser)") + " |",
    "| Parts | " + f.parts.length + " |",
    "",
    "| # | File | Bytes | SHA-256 | Saved |",
    "|---|---|---|---|---|",
  ];
  f.parts.forEach((p, i) => out.push("| " + (i + 1) + " | `" + p.name + "` | " + p.bytes + " | " + (p.sha256 ? "`" + p.sha256 + "`" : "") + " | " + (p.ok ? "yes" : "**NO**") + " |"));
  if (f.parts.length > 1) {
    out.push(
      "",
      "Rebuild the original by joining the parts in order:",
      "",
      "```",
      "# Linux / macOS",
      "cat " + f.parts.map((p) => "'" + p.name + "'").join(" ") + " > '" + f.safeName + "'",
      "# Windows (cmd)",
      "copy /b " + f.parts.map((p) => '"' + p.name + '"').join("+") + ' "' + f.safeName + '"',
      "```"
    );
  }
  return out.join("\n") + "\n";
}

const HEX64 = /^[0-9a-f]{64}$/;

export async function handleArtifact(env, origin, person, body) {
  if (!artifactsEnabled(env)) return json({ enabled: false, reason: "artifacts_disabled" }, 200, origin);
  const id = body.conversationId;
  if (typeof id !== "string" || !CONV_RE.test(id)) return json({ error: "bad_conversation_id" }, 400, origin);
  const size = body.size;
  if (!Number.isInteger(size) || size < 0) return json({ error: "bad_size" }, 400, origin);
  const name = safeFileName(body.name);
  const pb = partBytes(env);
  const n = Math.max(1, Math.ceil(size / pb));

  if (body.op === "begin") {
    if (size > maxArtifactBytes(env) || n > MAX_PARTS) return json({ error: "too_large", max: maxArtifactBytes(env) }, 413, origin);
    const uploadId = newUploadId(env);
    const folder = artifactFolder(person, id, uploadId);
    const names = Array.from({ length: n }, (_, i) => partName(name, i + 1, n));
    return json({ enabled: true, repo: artifactRepo(env), uploadId, folder, partBytes: pb, parts: n, names, maxBody: MAX_BODY }, 200, origin);
  }

  if (body.op === "manifest") {
    if (!uploadIdOk(env, body.uploadId)) return json({ error: "bad_upload_id" }, 400, origin);
    const parts = Array.isArray(body.parts) ? body.parts : null;
    if (!parts || parts.length !== n) return json({ error: "bad_parts" }, 400, origin);
    const clean = parts.map((p, i) => ({
      name: partName(name, i + 1, n),
      bytes: Number.isInteger(p && p.bytes) ? p.bytes : 0,
      sha256: p && HEX64.test(p.sha256) ? p.sha256 : "",
      ok: !!(p && p.ok),
    }));
    const folder = artifactFolder(person, id, body.uploadId);
    const text = manifestText(person, id, body.uploadId, folder, {
      name: String(body.name || name).slice(0, 200),
      safeName: name,
      type: String(body.type || "").slice(0, 100),
      size,
      sha256: HEX64.test(body.sha256) ? body.sha256 : "",
      parts: clean,
    });
    const target = { repo: artifactRepo(env), token: artifactToken(env) };
    const r = await createOnly(env, folder + "/MANIFEST.md", text, "webchat upload (" + person.slug + "): " + name + " manifest", { left: 3 }, target);
    if (r.error) return json({ error: r.error }, 502, origin);
    return json({ ok: true, path: folder + "/MANIFEST.md", repo: artifactRepo(env) }, 200, origin);
  }
  return json({ error: "bad_op" }, 400, origin);
}

/** POST /artifact/put?conversationId&uploadId&name&i&n  body = {"message":..,"content":"<base64>"} (streamed through). */
export async function handleArtifactPut(request, env, origin, person, url) {
  if (!artifactsEnabled(env)) return json({ error: "artifacts_disabled" }, 400, origin);
  const q = url.searchParams;
  const id = q.get("conversationId") || "";
  const uploadId = q.get("uploadId") || "";
  const i = parseInt(q.get("i") || "", 10);
  const n = parseInt(q.get("n") || "", 10);
  if (!CONV_RE.test(id)) return json({ error: "bad_conversation_id" }, 400, origin);
  if (!uploadIdOk(env, uploadId)) return json({ error: "bad_upload_id" }, 400, origin);
  if (!(n >= 1 && n <= MAX_PARTS && i >= 1 && i <= n)) return json({ error: "bad_part" }, 400, origin);
  if (!/application\/json/i.test(request.headers.get("Content-Type") || "")) return json({ error: "bad_content_type" }, 415, origin);
  const len = parseInt(request.headers.get("Content-Length") || "", 10);
  if (!(len > 0)) return json({ error: "length_required" }, 411, origin);
  if (len > MAX_BODY) return json({ error: "too_large", max: MAX_BODY }, 413, origin);
  if (!request.body) return json({ error: "empty_body" }, 400, origin);

  const path = artifactFolder(person, id, uploadId) + "/" + partName(safeFileName(q.get("name")), i, n);
  let body = request.body;
  if (typeof FixedLengthStream === "function") {
    // keeps Content-Length on the way out; piping is native, so no Worker CPU per byte
    const { readable, writable } = new FixedLengthStream(len);
    request.body.pipeTo(writable).catch(() => {});
    body = readable;
  }
  let r;
  try {
    r = await fetch(contentsUrl(env, path, artifactRepo(env)), {
      method: "PUT",
      headers: { ...ghHeaders(env, null, artifactToken(env)), "Content-Length": String(len) },
      body,
      duplex: "half",
    });
  } catch (e) {
    return json({ error: "github_unreachable", retry: true }, 502, origin);
  }
  if (r.ok) return json({ ok: true, created: true, path, repo: artifactRepo(env) }, 200, origin);
  let msg = "";
  try {
    msg = String(((await r.json()) || {}).message || "");
  } catch (e) {}
  // create-only: no sha is ever sent, so an existing path comes back as 422 "sha wasn't supplied"
  if (r.status === 422 && /sha/i.test(msg)) return json({ ok: true, exists: true, path, repo: artifactRepo(env) }, 200, origin);
  if (r.status === 409 || r.status >= 500) return json({ error: "github_write_" + r.status, retry: true }, 503, origin);
  return json({ error: "github_write_" + r.status, detail: msg.slice(0, 200) }, 502, origin);
}
