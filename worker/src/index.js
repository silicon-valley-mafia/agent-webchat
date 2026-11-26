/**
 * Direct Line token broker for a Copilot Studio agent.
 *
 * The browser NEVER sees the Direct Line secret. It calls POST /token with an
 * access code; this Worker checks origin + rate limit + access code, exchanges
 * the secret for a single-conversation token, and returns only that token.
 *
 * Secrets (npx wrangler secret put <NAME>):
 *   DIRECTLINE_SECRET  - Copilot Studio > Settings > Security > Web channel security > Secret 1
 *   ACCESS_CODE        - shared passcode users type on the page
 * Vars (wrangler.toml [vars]):
 *   ALLOWED_ORIGINS    - comma-separated, e.g. "https://silicon-valley-mafia.github.io"
 *   DIRECTLINE_DOMAIN  - default "https://directline.botframework.com"
 *                        (regional agents may need e.g. https://europe.directline.botframework.com)
 *   RATE_LIMIT_PER_MIN - token requests per IP per minute (default 10)
 */

const buckets = new Map(); // best-effort, per-isolate rate limiter

export function rateLimited(ip, limit, now = Date.now()) {
  const windowStart = now - 60000;
  const hits = (buckets.get(ip) || []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    buckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  buckets.set(ip, hits);
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
        { ok: true, configured: Boolean(env.DIRECTLINE_SECRET && env.ACCESS_CODE) },
        200,
        originOk ? origin : null
      );
    }
    if (url.pathname !== "/token") return json({ error: "not_found" }, 404, null);

    if (!originOk) return json({ error: "origin_not_allowed" }, 403, null);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    if (!env.DIRECTLINE_SECRET || !env.ACCESS_CODE) {
      return json({ error: "server_not_configured" }, 500, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = parseInt(env.RATE_LIMIT_PER_MIN || "10", 10);
    if (rateLimited(ip, limit)) return json({ error: "rate_limited" }, 429, origin);

    const code = request.headers.get("X-Access-Code") || "";
    if (!(await timingSafeEqual(code, env.ACCESS_CODE))) {
      return json({ error: "bad_access_code" }, 401, origin);
    }

    const domain = (env.DIRECTLINE_DOMAIN || "https://directline.botframework.com").replace(/\/$/, "");
    const userId = "dl_" + crypto.randomUUID();
    let dl;
    try {
      dl = await fetch(domain + "/v3/directline/tokens/generate", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.DIRECTLINE_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user: { id: userId } }),
      });
    } catch (e) {
      return json({ error: "directline_unreachable" }, 502, origin);
    }
    if (!dl.ok) {
      return json({ error: "directline_error", status: dl.status }, 502, origin);
    }
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
  },
};
