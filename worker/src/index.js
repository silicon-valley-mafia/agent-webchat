/**
 * Direct Line token broker + transcript logger for a Copilot Studio agent.
 *
 * POST /token  -> returns a single-conversation Direct Line token (secret never leaves the Worker)
 * POST /log    -> body {conversationId}; the Worker reads that conversation from Direct Line
 *                 itself (using the secret) and writes a Markdown transcript to a private repo.
 * GET  /health -> {ok, configured, logging}
 *
 * Every POST requires: allowed Origin + per-IP rate limit + matching X-Access-Code header.
 *
 * Secrets (wrangler secret put / GitHub Actions):
 *   DIRECTLINE_SECRET  - Copilot Studio > Settings > Security > Web channel security > Secret 1
 *   ACCESS_CODE        - shared passcode typed on the page
 *   GITHUB_LOG_TOKEN   - (optional) fine-grained PAT: Contents read/write on LOG_REPO only
 * Vars (wrangler.toml [vars]):
 *   ALLOWED_ORIGINS, DIRECTLINE_DOMAIN, RATE_LIMIT_PER_MIN (token, default 10),
 *   LOG_RATE_LIMIT_PER_MIN (default 30), LOG_REPO ("owner/name"), LOG_TZ_OFFSET_MIN (default 330 = IST)
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
  if (buckets.size > 5000) buckets.clear(); // memory guard
  return false;
}

export function _resetRateLimiter() {
  buckets.clear();
}

async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
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
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function dlDomain(env) {
  return (env.DIRECTLINE_DOMAIN || "https://directline.botframework.com").replace(/\/$/, "");
}

// ---------- transcript helpers ----------

export function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function localParts(iso, offsetMin) {
  const t = Date.parse(iso);
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + offsetMin * 60000);
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19), hm: s.slice(11, 16).replace(":", "") };
}

function tzLabel(offsetMin) {
  if (offsetMin === 330) return "IST";
  const sign = offsetMin < 0 ? "-" : "+";
  const a = Math.abs(offsetMin);
  return "UTC" + sign + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
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
  const name = att.name || "file";
  return "📎 **" + name + "** (" + ct + ")" + (att.contentUrl && !String(att.contentUrl).startsWith("data:") ? " " + att.contentUrl : "");
}

export function renderTranscript(conversationId, activities, offsetMin) {
  const msgs = activities.filter((a) => a.type === "message");
  const label = tzLabel(offsetMin);
  const first = localParts((activities[0] && activities[0].timestamp) || new Date().toISOString(), offsetMin);
  const last = localParts((activities[activities.length - 1] && activities[activities.length - 1].timestamp) || new Date().toISOString(), offsetMin);
  const out = [
    "# Conversation " + first.date + " " + first.time + " " + label,
    "",
    "| | |",
    "|---|---|",
    "| Conversation ID | `" + conversationId + "` |",
    "| Started | " + first.date + " " + first.time + " " + label + " |",
    "| Last activity | " + last.date + " " + last.time + " " + label + " |",
    "| Messages | " + msgs.length + " (you: " + msgs.filter(isUser).length + ", agent: " + msgs.filter((m) => !isUser(m)).length + ") |",
    "",
    "---",
    "",
  ];
  for (const a of msgs) {
    const p = localParts(a.timestamp || a.localTimestamp, offsetMin);
    const who = isUser(a) ? "🧑 You" : "🤖 " + ((a.from && a.from.name) || "Agent");
    out.push("### " + who + " · " + p.time);
    out.push("");
    if (a.text) out.push(a.text, "");
    for (const att of a.attachments || []) out.push(describeAttachment(att), "");
    const sa = a.suggestedActions && a.suggestedActions.actions;
    if (sa && sa.length) out.push("> Suggested: " + sa.map((x) => x.title || x.value).join(" · "), "");
  }
  return out.join("\n");
}

export function logPath(conversationId, activities, offsetMin) {
  const p = localParts((activities[0] && activities[0].timestamp) || new Date().toISOString(), offsetMin);
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return "logs/" + p.date + "/" + p.hm + "-" + safe + ".md";
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

async function githubUpsert(env, path, content, message) {
  const url =
    "https://api.github.com/repos/" + env.LOG_REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
  const headers = {
    Authorization: "Bearer " + env.GITHUB_LOG_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-webchat-logger",
    "Content-Type": "application/json",
  };
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
    // 409/422 = someone else updated the file in between: re-read sha and retry
  }
  return { error: "github_conflict" };
}

// ---------- handlers ----------

async function handleToken(env, origin) {
  const domain = dlDomain(env);
  const userId = "dl_" + crypto.randomUUID();
  let dl;
  try {
    dl = await fetch(domain + "/v3/directline/tokens/generate", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.DIRECTLINE_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: userId } }),
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
    },
    200,
    origin
  );
}

async function handleLog(request, env, origin) {
  if (!env.LOG_REPO || !env.GITHUB_LOG_TOKEN) return json({ logged: false, reason: "logging_disabled" }, 200, origin);
  let body = null;
  try {
    body = await request.json();
  } catch (e) {}
  const conversationId = body && body.conversationId;
  if (typeof conversationId !== "string" || !/^[A-Za-z0-9._|:-]{4,200}$/.test(conversationId)) {
    return json({ error: "bad_conversation_id" }, 400, origin);
  }
  let acts;
  try {
    acts = await fetchActivities(env, conversationId);
  } catch (e) {
    return json({ error: "directline_error", status: e.status || 0 }, 502, origin);
  }
  if (!acts.some((a) => a.type === "message")) return json({ logged: false, reason: "empty" }, 200, origin);
  const offset = parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10);
  const path = logPath(conversationId, acts, offset);
  const md = renderTranscript(conversationId, acts, offset);
  const res = await githubUpsert(env, path, md, "log: " + path.slice(5));
  if (res.error) return json({ logged: false, error: res.error }, 502, origin);
  return json({ logged: true, changed: res.changed, path }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const originOk = allowed.includes(origin);

    if (url.pathname === "/health") {
      return json(
        {
          ok: true,
          configured: Boolean(env.DIRECTLINE_SECRET && env.ACCESS_CODE),
          logging: Boolean(env.LOG_REPO && env.GITHUB_LOG_TOKEN),
        },
        200,
        originOk ? origin : null
      );
    }
    if (url.pathname !== "/token" && url.pathname !== "/log") return json({ error: "not_found" }, 404, null);

    if (!originOk) return json({ error: "origin_not_allowed" }, 403, null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    if (!env.DIRECTLINE_SECRET || !env.ACCESS_CODE) return json({ error: "server_not_configured" }, 500, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const isLog = url.pathname === "/log";
    const limit = isLog
      ? parseInt(env.LOG_RATE_LIMIT_PER_MIN || "30", 10)
      : parseInt(env.RATE_LIMIT_PER_MIN || "10", 10);
    if (rateLimited((isLog ? "log:" : "tok:") + ip, limit)) return json({ error: "rate_limited" }, 429, origin);

    const code = request.headers.get("X-Access-Code") || "";
    if (!(await timingSafeEqual(code, env.ACCESS_CODE))) {
      // wrong guesses on /log also burn the token bucket, so /log can't be used to brute-force
      if (isLog) rateLimited("tok:" + ip, parseInt(env.RATE_LIMIT_PER_MIN || "10", 10));
      return json({ error: "bad_access_code" }, 401, origin);
    }

    return isLog ? handleLog(request, env, origin) : handleToken(env, origin);
  },
};
