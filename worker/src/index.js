/**
 * Direct Line token broker + transcript logger + history API for a Copilot Studio agent.
 *
 * All endpoints except /health are POST, need an allowed Origin, a per-IP rate limit, and a
 * valid X-Access-Code header. Each access code maps to a person (name, admin flag).
 *
 *   /token       -> new conversation token                         {token, conversationId, userId, domain, name, admin}
 *   /resume      {conversationId} -> fresh token for an existing conversation (Direct Line reconnect)
 *   /log         {conversationId, userId?, since?} -> Worker reads the conversation from Direct Line and
 *                   CREATES files in a per-session folder (never updates or deletes anything):
 *                     logs/YYYY-MM-DD/HHMM-<person>--<conversation>/0000-session.md
 *                     logs/YYYY-MM-DD/HHMM-<person>--<conversation>/0001-HHMMSS-user.md, 0002-...-agent.md, ...
 *                   Returns {total} = messages written so far; the client sends it back as `since`.
 *   /export      {conversationId} -> {markdown, filename}  (no write; works without logging)
 *   /history     -> {items:[{path,date,time,person,messages}]}  (admins see everyone, others only their own)
 *   /transcript  {path: session folder} -> {markdown}  (one GraphQL call reads every file in the folder)
 *   /artifact    {op:"begin", conversationId, name, size} -> {uploadId, folder, partBytes, parts, names}
 *                {op:"manifest", conversationId, uploadId, name, size, type, sha256, parts:[{bytes,sha256,ok}]}
 *                   -> creates <folder>/MANIFEST.md in ARTIFACT_REPO
 *   /artifact/put?conversationId&uploadId&name&i&n  body {"message","content":<base64>} streamed to GitHub
 *                   -> creates <folder>/<name>[.partIIofNN]   (create-only, like the logs)
 *   GET /health  -> {ok, configured, logging, artifacts, people}
 *
 * Secrets: DIRECTLINE_SECRET; ACCESS_CODE (owner, admin) and/or ACCESS_CODES (JSON:
 *   {"code": "Name"} or {"code": {"name": "Name", "admin": true}}); LOG_REPO_TOKEN (optional);
 *   ARTIFACT_REPO_TOKEN (optional, defaults to LOG_REPO_TOKEN). Vars: ARTIFACT_REPO, ARTIFACT_PART_BYTES,
 *   ARTIFACT_MAX_BYTES.
 * Vars: ALLOWED_ORIGINS, DIRECTLINE_DOMAIN, RATE_LIMIT_PER_MIN (token/resume, 10),
 *   API_RATE_LIMIT_PER_MIN (log/export/history/transcript, 60), LOG_REPO, LOG_BRANCH (main),
 *   LOG_TZ_OFFSET_MIN (330 = IST), OWNER_NAME (name for ACCESS_CODE, default "Owner").
 */

import { handleArtifact, handleArtifactPut, artifactsEnabled } from "./artifacts.js";
export * from "./artifacts.js";

const buckets = new Map(); // best-effort, per-isolate rate limiter

export function rateLimited(key, limit, now = Date.now()) {
  const windowStart = now - 60000;
  const hits = (buckets.get(key) || []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return false;
}

export function _resetRateLimiter() {
  buckets.clear();
}

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
}

function sameBytes(x, y) {
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function slugify(name) {
  return (
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "user"
  );
}

/** All configured people, as [{code, name, slug, admin}]. */
export function people(env) {
  const out = [];
  if (env.ACCESS_CODE) out.push({ code: env.ACCESS_CODE, name: env.OWNER_NAME || "Owner", admin: true });
  if (env.ACCESS_CODES) {
    let parsed = {};
    try {
      parsed = JSON.parse(env.ACCESS_CODES);
    } catch (e) {
      parsed = {};
    }
    for (const [code, v] of Object.entries(parsed || {})) {
      if (!code) continue;
      if (typeof v === "string") out.push({ code, name: v, admin: false });
      else if (v && typeof v === "object") out.push({ code, name: v.name || "user", admin: !!v.admin });
    }
  }
  return out.map((p) => ({ ...p, slug: slugify(p.name) }));
}

/** Constant-time over every configured code (no early exit). */
export async function identify(env, code) {
  const given = await digest(code);
  let found = null;
  for (const p of people(env)) {
    const ok = sameBytes(given, await digest(p.code));
    if (ok && !found) found = p;
  }
  return found ? { name: found.name, slug: found.slug, admin: found.admin } : null;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(origin ? corsHeaders(origin) : {}) },
  });
}

function dlDomain(env) {
  return (env.DIRECTLINE_DOMAIN || "https://directline.botframework.com").replace(/\/$/, "");
}

export const CONV_RE = /^[A-Za-z0-9._|:-]{4,200}$/;
const USER_RE = /^dl_[A-Za-z0-9_-]{1,80}$/;
/** A session folder: logs/<day>/<HHMM>-<person>--<conversation> */
export const SESSION_RE = /^logs\/(\d{4}-\d{2}-\d{2})\/(\d{4})-([a-z0-9-]{1,24})--([A-Za-z0-9_-]{1,80})$/;
/** Cloudflare Workers Free allows 50 subrequests per request; keep headroom for Direct Line reads. */
export const WRITE_BUDGET = 40;
/** Direct Line pages read per request (one subrequest each). Was 5; long conversations could stop being logged. */
export const DL_MAX_PAGES = 10;
/** Subrequests one /log call may use in total (Direct Line reads + GitHub writes); 2 spare below the 50 limit. */
export const SUBREQUEST_BUDGET = 48;

// ---------- transcript helpers ----------

export function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function localParts(iso, offsetMin) {
  const t = Date.parse(iso);
  const s = new Date((Number.isFinite(t) ? t : Date.now()) + offsetMin * 60000).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19), hm: s.slice(11, 16).replace(":", "") };
}

function tzLabel(offsetMin) {
  if (offsetMin === 330) return "IST";
  const a = Math.abs(offsetMin);
  return "UTC" + (offsetMin < 0 ? "-" : "+") + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
}

function isUser(a) {
  const id = (a.from && a.from.id) || "";
  return (a.from && a.from.role === "user") || id.startsWith("dl_");
}

function describeAttachment(att) {
  const ct = att.contentType || "unknown";
  if (ct.startsWith("application/vnd.microsoft.card")) {
    let body = "";
    try {
      body = JSON.stringify(att.content);
    } catch (e) {}
    if (body.length > 3000) body = body.slice(0, 3000) + "...(truncated)";
    return "*(" + ct.replace("application/vnd.microsoft.card.", "") + " card)*\n\n<details><summary>card JSON</summary>\n\n```json\n" + body + "\n```\n</details>";
  }
  const url = att.contentUrl && !String(att.contentUrl).startsWith("data:") ? " " + att.contentUrl : "";
  return "📎 **" + (att.name || "file") + "** (" + ct + ")" + url;
}

export function renderTranscript(conversationId, activities, offsetMin, person) {
  const msgs = activities.filter((a) => a.type === "message");
  const label = tzLabel(offsetMin);
  const now = new Date().toISOString();
  const first = localParts((activities[0] && activities[0].timestamp) || now, offsetMin);
  const last = localParts((activities[activities.length - 1] && activities[activities.length - 1].timestamp) || now, offsetMin);
  const firstUser = msgs.find(isUser);
  const userId = (firstUser && firstUser.from && firstUser.from.id) || "";
  const who = (person && person.name) || "You";
  const out = [
    "# Conversation " + first.date + " " + first.time + " " + label,
    "",
    "| | |",
    "|---|---|",
    "| Person | " + who + " |",
    "| Conversation ID | `" + conversationId + "` |",
    "| User ID | `" + userId + "` |",
    "| Started | " + first.date + " " + first.time + " " + label + " |",
    "| Last activity | " + last.date + " " + last.time + " " + label + " |",
    "| Messages | " + msgs.length + " (" + who + ": " + msgs.filter(isUser).length + ", agent: " + msgs.filter((m) => !isUser(m)).length + ") |",
    "",
    "---",
    "",
  ];
  for (const a of msgs) {
    const p = localParts(a.timestamp || a.localTimestamp, offsetMin);
    out.push("### " + (isUser(a) ? "🧑 " + who : "🤖 " + ((a.from && a.from.name) || "Agent")) + " · " + p.time, "");
    if (a.text) out.push(a.text, "");
    for (const att of a.attachments || []) out.push(describeAttachment(att), "");
    const sa = a.suggestedActions && a.suggestedActions.actions;
    if (sa && sa.length) out.push("> Suggested: " + sa.map((x) => x.title || x.value).join(" · "), "");
  }
  return out.join("\n");
}

/** Name used by /export downloads: one Markdown file for the whole conversation. */
export function logPath(conversationId, activities, offsetMin, slug) {
  return sessionFolder(conversationId, activities, offsetMin, slug) + ".md";
}

/** logs/<day>/<HHMM>-<person>--<conversation>, dated by the conversation's first activity. */
export function sessionFolder(conversationId, activities, offsetMin, slug) {
  const p = localParts((activities[0] && activities[0].timestamp) || new Date().toISOString(), offsetMin);
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return "logs/" + p.date + "/" + p.hm + "-" + (slug || "user") + "--" + safe;
}

/** 0000-session.md: written once, never changed. */
export function sessionHeader(conversationId, activities, offsetMin, person, userId) {
  const label = tzLabel(offsetMin);
  const first = localParts((activities[0] && activities[0].timestamp) || new Date().toISOString(), offsetMin);
  return [
    "# Conversation " + first.date + " " + first.time + " " + label,
    "",
    "| | |",
    "|---|---|",
    "| Person | " + ((person && person.name) || "You") + " |",
    "| Conversation ID | `" + conversationId + "` |",
    "| User ID | `" + (userId || "") + "` |",
    "| Started | " + first.date + " " + first.time + " " + label + " |",
    "",
  ].join("\n");
}

/** NNNN-HHMMSS-user|agent.md for the index-th message (1-based). */
export function messageFile(a, index, offsetMin, person) {
  const p = localParts(a.timestamp || a.localTimestamp, offsetMin);
  const user = isUser(a);
  const out = ["### " + (user ? "🧑 " + ((person && person.name) || "You") : "🤖 " + ((a.from && a.from.name) || "Agent")) + " · " + p.time, ""];
  if (a.text) out.push(a.text, "");
  for (const att of a.attachments || []) out.push(describeAttachment(att), "");
  const sa = a.suggestedActions && a.suggestedActions.actions;
  if (sa && sa.length) out.push("> Suggested: " + sa.map((x) => x.title || x.value).join(" · "), "");
  return {
    name: String(index).padStart(4, "0") + "-" + p.time.replace(/:/g, "") + "-" + (user ? "user" : "agent") + ".md",
    content: out.join("\n"),
  };
}

/**
 * Reads the conversation's activities page by page (watermark), at most DL_MAX_PAGES requests.
 * `meta` (optional) receives {pages, complete}: complete = false when the page limit was hit before the end.
 */
async function fetchActivities(env, conversationId, meta) {
  const base = dlDomain(env) + "/v3/directline/conversations/" + encodeURIComponent(conversationId) + "/activities";
  const seen = new Set();
  const all = [];
  let wm = null;
  let pages = 0;
  let complete = false;
  for (let i = 0; i < DL_MAX_PAGES; i++) {
    const r = await fetch(base + (wm ? "?watermark=" + encodeURIComponent(wm) : ""), {
      headers: { Authorization: "Bearer " + env.DIRECTLINE_SECRET },
    });
    pages++;
    if (!r.ok) {
      const e = new Error("directline_error");
      e.status = r.status;
      throw e;
    }
    const j = await r.json();
    const acts = j.activities || [];
    for (const a of acts) {
      if (a.id && seen.has(a.id)) continue;
      if (a.id) seen.add(a.id);
      all.push(a);
    }
    if (!j.watermark || j.watermark === wm || acts.length === 0) {
      complete = true;
      break;
    }
    wm = j.watermark;
  }
  if (meta) {
    meta.pages = pages;
    meta.complete = complete;
  }
  return all;
}

export function ghHeaders(env, accept, token) {
  return {
    Authorization: "Bearer " + (token || env.LOG_REPO_TOKEN),
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-webchat-logger",
    "Content-Type": "application/json",
  };
}

export function contentsUrl(env, path, repo) {
  return "https://api.github.com/repos/" + (repo || env.LOG_REPO) + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Create-only write. No read, no sha, so it can never overwrite an existing file:
 * GitHub answers 422 when the path already exists, which counts as "already written".
 * 409 (branch moved under us by a parallel write) is retried.
 */
export async function createOnly(env, path, content, message, budget, target) {
  const url = contentsUrl(env, path, target && target.repo);
  const req = { message, content: b64utf8(content) };
  if (!target) req.branch = env.LOG_BRANCH || "main"; // artifact repo: default branch
  const body = JSON.stringify(req);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (budget.left <= 0) return { error: "budget" };
    budget.left--;
    const p = await fetch(url, { method: "PUT", headers: ghHeaders(env, null, target && target.token), body });
    if (p.ok) return { created: true };
    if (p.status === 422) return { exists: true };
    if (p.status !== 409) return { error: "github_write_" + p.status };
  }
  return { error: "github_conflict" };
}

/** Read every file of one session folder with a single GraphQL request. */
async function readSessionFolder(env, folder) {
  const [owner, name] = String(env.LOG_REPO).split("/");
  const query =
    "query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){object(expression:$e){" +
    "... on Tree{entries{name type object{... on Blob{text}}}}}}}";
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: ghHeaders(env),
    body: JSON.stringify({ query, variables: { o: owner, n: name, e: (env.LOG_BRANCH || "main") + ":" + folder } }),
  });
  if (!r.ok) return { error: "github_read_" + r.status };
  const j = await r.json();
  if (j.errors && !j.data) return { error: "github_read_graphql" };
  const obj = j.data && j.data.repository && j.data.repository.object;
  if (!obj || !obj.entries) return { error: "not_found" };
  const files = obj.entries
    .filter((e) => e.type === "blob" && /\.md$/.test(e.name))
    .map((e) => ({ name: e.name, text: (e.object && e.object.text) || "" }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files };
}

/** Join a session folder's files into one transcript (header, rule, messages in order). */
export function joinSession(files) {
  const head = files.find((f) => f.name === "0000-session.md");
  const msgs = files
    .filter((f) => f.name !== "0000-session.md")
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return ((head ? head.text.replace(/\s+$/, "") + "\n" : "") + "| Messages | " + msgs.length + " |\n\n---\n\n" +
    msgs.map((f) => f.text.replace(/\s+$/, "")).join("\n\n") + "\n");
}

// ---------- handlers ----------

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch (e) {
    return {};
  }
}

async function handleToken(env, origin, person) {
  const domain = dlDomain(env);
  const userId = "dl_" + crypto.randomUUID();
  let dl;
  try {
    dl = await fetch(domain + "/v3/directline/tokens/generate", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.DIRECTLINE_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: userId, name: person.name } }),
    });
  } catch (e) {
    return json({ error: "directline_unreachable" }, 502, origin);
  }
  if (!dl.ok) return json({ error: "directline_error", status: dl.status }, 502, origin);
  const data = await dl.json();
  return json(
    {
      token: data.token,
      expires_in: data.expires_in,
      conversationId: data.conversationId,
      userId,
      domain: domain + "/v3/directline",
      name: person.name,
      admin: person.admin,
    },
    200,
    origin
  );
}

async function handleResume(env, origin, person, body) {
  const id = body.conversationId;
  if (typeof id !== "string" || !CONV_RE.test(id)) return json({ error: "bad_conversation_id" }, 400, origin);
  const domain = dlDomain(env);
  let r;
  try {
    r = await fetch(domain + "/v3/directline/conversations/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + env.DIRECTLINE_SECRET },
    });
  } catch (e) {
    return json({ error: "directline_unreachable" }, 502, origin);
  }
  if (r.status === 403 || r.status === 404) return json({ error: "conversation_expired", status: r.status }, 410, origin);
  if (!r.ok) return json({ error: "directline_error", status: r.status }, 502, origin);
  const data = await r.json();
  if (!data.token) return json({ error: "directline_error", status: 0 }, 502, origin);
  return json(
    {
      token: data.token,
      expires_in: data.expires_in,
      conversationId: data.conversationId || id,
      domain: domain + "/v3/directline",
      name: person.name,
      admin: person.admin,
    },
    200,
    origin
  );
}

async function loadConversation(env, origin, body) {
  const id = body.conversationId;
  if (typeof id !== "string" || !CONV_RE.test(id)) return { res: json({ error: "bad_conversation_id" }, 400, origin) };
  try {
    const meta = {};
    const acts = await fetchActivities(env, id, meta);
    return { id, acts, meta };
  } catch (e) {
    return { res: json({ error: "directline_error", status: e.status || 0 }, 502, origin) };
  }
}

async function handleLog(env, origin, person, body) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ logged: false, reason: "logging_disabled" }, 200, origin);
  const c = await loadConversation(env, origin, body);
  if (c.res) return c.res;
  const msgs = c.acts.filter((a) => a.type === "message");
  if (!msgs.length) return json({ logged: false, reason: "empty" }, 200, origin);
  const offset = parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10);
  const folder = sessionFolder(c.id, c.acts, offset, person.slug);
  const since = Number.isInteger(body.since) && body.since > 0 ? Math.min(body.since, msgs.length) : 0;
  const firstUser = msgs.find(isUser);
  const userId = typeof body.userId === "string" && USER_RE.test(body.userId)
    ? body.userId
    : (firstUser && firstUser.from && firstUser.from.id) || "";
  // Direct Line reads already used part of the 50-subrequest allowance: writes get what is left.
  const budget = { left: Math.max(1, Math.min(WRITE_BUDGET, SUBREQUEST_BUDGET - ((c.meta && c.meta.pages) || 0))) };
  const label = "log(" + person.slug + "): " + folder.slice(5);
  let written = 0;
  let done = since;

  if (since === 0) {
    const h = await createOnly(env, folder + "/0000-session.md", sessionHeader(c.id, c.acts, offset, person, userId), label + " start", budget);
    if (h.error) return json({ logged: false, error: h.error, folder, total: 0 }, 502, origin);
    if (h.created) written++;
  }
  for (let i = since; i < msgs.length; i++) {
    const f = messageFile(msgs[i], i + 1, offset, person);
    const r = await createOnly(env, folder + "/" + f.name, f.content, label + " #" + (i + 1), budget);
    if (r.error === "budget") break;
    if (r.error) return json({ logged: false, error: r.error, folder, total: done }, 502, origin);
    if (r.created) written++;
    done = i + 1;
  }
  const out = { logged: true, folder, written, total: done, more: done < msgs.length };
  if (c.meta && c.meta.complete === false) out.partial = true; // hit DL_MAX_PAGES: newest messages may be missing
  return json(out, 200, origin);
}

async function handleExport(env, origin, person, body) {
  const c = await loadConversation(env, origin, body);
  if (c.res) return c.res;
  const offset = parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10);
  const md = renderTranscript(c.id, c.acts, offset, person);
  const filename = logPath(c.id, c.acts, offset, person.slug).split("/").slice(1).join("_");
  return json({ markdown: md, filename }, 200, origin);
}

async function handleHistory(env, origin, person) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ items: [], reason: "logging_disabled" }, 200, origin);
  const url =
    "https://api.github.com/repos/" + env.LOG_REPO + "/git/trees/" + encodeURIComponent(env.LOG_BRANCH || "main") + "?recursive=1";
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 404 || r.status === 409) return json({ items: [] }, 200, origin); // empty repo
  if (!r.ok) return json({ error: "github_read_" + r.status }, 502, origin);
  const tree = await r.json();
  const sessions = new Map();
  for (const t of tree.tree || []) {
    if (t.type !== "blob") continue;
    const slash = t.path.lastIndexOf("/");
    const folder = t.path.slice(0, slash);
    const m = SESSION_RE.exec(folder);
    if (!m || !/^\d{4}-.*\.md$/.test(t.path.slice(slash + 1))) continue;
    if (!person.admin && m[3] !== person.slug) continue;
    let s = sessions.get(folder);
    if (!s) {
      s = { path: folder, date: m[1], time: m[2].slice(0, 2) + ":" + m[2].slice(2), person: m[3], messages: 0 };
      sessions.set(folder, s);
    }
    if (!t.path.endsWith("/0000-session.md")) s.messages++;
  }
  const items = [...sessions.values()].sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  return json({ items: items.slice(0, 300), truncated: !!tree.truncated || items.length > 300 }, 200, origin);
}

async function handleTranscript(env, origin, person, body) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ error: "logging_disabled" }, 400, origin);
  const m = typeof body.path === "string" ? SESSION_RE.exec(body.path) : null;
  if (!m) return json({ error: "bad_path" }, 400, origin);
  if (!person.admin && m[3] !== person.slug) return json({ error: "forbidden" }, 403, origin);
  const res = await readSessionFolder(env, body.path);
  if (res.error === "not_found") return json({ error: "not_found" }, 404, origin);
  if (res.error) return json({ error: res.error }, 502, origin);
  return json({ markdown: joinSession(res.files), path: body.path, files: res.files.length }, 200, origin);
}

const ROUTES = {
  "/token": { bucket: "tok" },
  "/resume": { bucket: "tok" },
  "/log": { bucket: "api" },
  "/export": { bucket: "api" },
  "/history": { bucket: "api" },
  "/transcript": { bucket: "api" },
  "/artifact": { bucket: "api" },
  "/artifact/put": { bucket: "api" },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
    const originOk = allowed.includes(origin);

    if (url.pathname === "/health") {
      return json(
        {
          ok: true,
          configured: Boolean(env.DIRECTLINE_SECRET && people(env).length),
          logging: Boolean(env.LOG_REPO && env.LOG_REPO_TOKEN),
          artifacts: artifactsEnabled(env),
          people: people(env).length,
        },
        200,
        originOk ? origin : null
      );
    }
    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "not_found" }, 404, null);
    if (!originOk) return json({ error: "origin_not_allowed" }, 403, null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    if (!env.DIRECTLINE_SECRET || !people(env).length) return json({ error: "server_not_configured" }, 500, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const tokLimit = parseInt(env.RATE_LIMIT_PER_MIN || "10", 10);
    const limit = route.bucket === "tok" ? tokLimit : parseInt(env.API_RATE_LIMIT_PER_MIN || "60", 10);
    if (rateLimited(route.bucket + ":" + ip, limit)) return json({ error: "rate_limited" }, 429, origin);

    const person = await identify(env, request.headers.get("X-Access-Code") || "");
    if (!person) {
      // wrong guesses on any endpoint also burn the token bucket (brute-force guard)
      if (route.bucket !== "tok") rateLimited("tok:" + ip, tokLimit);
      return json({ error: "bad_access_code" }, 401, origin);
    }

    if (url.pathname === "/artifact/put") return handleArtifactPut(request, env, origin, person, url);
    const body = url.pathname === "/token" || url.pathname === "/history" ? {} : await readJson(request);
    switch (url.pathname) {
      case "/artifact":
        return handleArtifact(env, origin, person, body);
      case "/token":
        return handleToken(env, origin, person);
      case "/resume":
        return handleResume(env, origin, person, body);
      case "/log":
        return handleLog(env, origin, person, body);
      case "/export":
        return handleExport(env, origin, person, body);
      case "/history":
        return handleHistory(env, origin, person);
      default:
        return handleTranscript(env, origin, person, body);
    }
  },
};
