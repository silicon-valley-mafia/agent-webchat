/**
 * Direct Line token broker + transcript logger + history API for a Copilot Studio agent.
 *
 * All endpoints except /health are POST, need an allowed Origin, a per-IP rate limit, and a
 * valid X-Access-Code header. Each access code maps to a person (name, admin flag).
 *
 *   /token       -> new conversation token                         {token, conversationId, userId, domain, name, admin}
 *   /resume      {conversationId} -> fresh token for an existing conversation (Direct Line reconnect)
 *   /log         {conversationId} -> Worker reads the conversation from Direct Line and upserts
 *                   logs/YYYY-MM-DD/HHMM-<person>--<conversation>.md in LOG_REPO
 *   /export      {conversationId} -> {markdown, filename}  (no write; works without logging)
 *   /history     -> {items:[{path,date,time,person}]}  (admins see everyone, others only their own)
 *   /transcript  {path} -> {markdown}
 *   GET /health  -> {ok, configured, logging, people}
 *
 * Secrets: DIRECTLINE_SECRET; ACCESS_CODE (owner, admin) and/or ACCESS_CODES (JSON:
 *   {"code": "Name"} or {"code": {"name": "Name", "admin": true}}); LOG_REPO_TOKEN (optional).
 * Vars: ALLOWED_ORIGINS, DIRECTLINE_DOMAIN, RATE_LIMIT_PER_MIN (token/resume, 10),
 *   API_RATE_LIMIT_PER_MIN (log/export/history/transcript, 60), LOG_REPO, LOG_BRANCH (main),
 *   LOG_TZ_OFFSET_MIN (330 = IST), OWNER_NAME (name for ACCESS_CODE, default "Owner").
 */

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

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(origin ? corsHeaders(origin) : {}) },
  });
}

function dlDomain(env) {
  return (env.DIRECTLINE_DOMAIN || "https://directline.botframework.com").replace(/\/$/, "");
}

const CONV_RE = /^[A-Za-z0-9._|:-]{4,200}$/;
export const PATH_RE = /^logs\/(\d{4}-\d{2}-\d{2})\/(\d{4})-([a-z0-9-]{1,24})--([A-Za-z0-9_-]{1,80})\.md$/;

// ---------- transcript helpers ----------

export function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function localParts(iso, offsetMin) {
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

export function logPath(conversationId, activities, offsetMin, slug) {
  const p = localParts((activities[0] && activities[0].timestamp) || new Date().toISOString(), offsetMin);
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return "logs/" + p.date + "/" + p.hm + "-" + (slug || "user") + "--" + safe + ".md";
}

async function fetchActivities(env, conversationId) {
  const base = dlDomain(env) + "/v3/directline/conversations/" + encodeURIComponent(conversationId) + "/activities";
  const seen = new Set();
  const all = [];
  let wm = null;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(base + (wm ? "?watermark=" + encodeURIComponent(wm) : ""), {
      headers: { Authorization: "Bearer " + env.DIRECTLINE_SECRET },
    });
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
    if (!j.watermark || j.watermark === wm || acts.length === 0) break;
    wm = j.watermark;
  }
  return all;
}

function ghHeaders(env, accept) {
  return {
    Authorization: "Bearer " + env.LOG_REPO_TOKEN,
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-webchat-logger",
    "Content-Type": "application/json",
  };
}

function contentsUrl(env, path) {
  return "https://api.github.com/repos/" + env.LOG_REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
}

async function githubUpsert(env, path, content, message) {
  const url = contentsUrl(env, path);
  const headers = ghHeaders(env);
  const b64 = b64utf8(content);
  for (let attempt = 0; attempt < 3; attempt++) {
    let sha;
    const g = await fetch(url, { headers });
    if (g.status === 200) {
      const j = await g.json();
      sha = j.sha;
      if ((j.content || "").replace(/\n/g, "") === b64) return { changed: false };
    } else if (g.status !== 404) {
      return { error: "github_read_" + g.status };
    }
    const body = { message, content: b64 };
    if (sha) body.sha = sha;
    const p = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
    if (p.ok) return { changed: true };
    if (p.status !== 409 && p.status !== 422) return { error: "github_write_" + p.status };
  }
  return { error: "github_conflict" };
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
    return { id, acts: await fetchActivities(env, id) };
  } catch (e) {
    return { res: json({ error: "directline_error", status: e.status || 0 }, 502, origin) };
  }
}

async function handleLog(env, origin, person, body) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ logged: false, reason: "logging_disabled" }, 200, origin);
  const c = await loadConversation(env, origin, body);
  if (c.res) return c.res;
  if (!c.acts.some((a) => a.type === "message")) return json({ logged: false, reason: "empty" }, 200, origin);
  const offset = parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10);
  const path = logPath(c.id, c.acts, offset, person.slug);
  const md = renderTranscript(c.id, c.acts, offset, person);
  const res = await githubUpsert(env, path, md, "log(" + person.slug + "): " + path.slice(5));
  if (res.error) return json({ logged: false, error: res.error }, 502, origin);
  return json({ logged: true, changed: res.changed, path }, 200, origin);
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
  const items = [];
  for (const t of tree.tree || []) {
    if (t.type !== "blob") continue;
    const m = PATH_RE.exec(t.path);
    if (!m) continue;
    if (!person.admin && m[3] !== person.slug) continue;
    items.push({ path: t.path, date: m[1], time: m[2].slice(0, 2) + ":" + m[2].slice(2), person: m[3], size: t.size || 0 });
  }
  items.sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  return json({ items: items.slice(0, 300), truncated: !!tree.truncated || items.length > 300 }, 200, origin);
}

async function handleTranscript(env, origin, person, body) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ error: "logging_disabled" }, 400, origin);
  const m = typeof body.path === "string" ? PATH_RE.exec(body.path) : null;
  if (!m) return json({ error: "bad_path" }, 400, origin);
  if (!person.admin && m[3] !== person.slug) return json({ error: "forbidden" }, 403, origin);
  const r = await fetch(contentsUrl(env, body.path), { headers: ghHeaders(env, "application/vnd.github.raw+json") });
  if (r.status === 404) return json({ error: "not_found" }, 404, origin);
  if (!r.ok) return json({ error: "github_read_" + r.status }, 502, origin);
  return json({ markdown: await r.text(), path: body.path }, 200, origin);
}

const ROUTES = {
  "/token": { bucket: "tok" },
  "/resume": { bucket: "tok" },
  "/log": { bucket: "api" },
  "/export": { bucket: "api" },
  "/history": { bucket: "api" },
  "/transcript": { bucket: "api" },
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

    const body = url.pathname === "/token" || url.pathname === "/history" ? {} : await readJson(request);
    switch (url.pathname) {
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
