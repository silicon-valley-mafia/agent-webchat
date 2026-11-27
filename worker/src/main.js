/**
 * Multi-agent front for the token Worker (TODO #11 / #20 / #7). Wraps src/index.js without changing it.
 *
 * Agents (registry):
 *   - the existing DIRECTLINE_SECRET is the default agent: id DEFAULT_AGENT_ID ("github"), name DEFAULT_AGENT_NAME;
 *   - optional secret AGENTS (JSON) adds more Copilot Studio agents, each with its own Direct Line secret:
 *       {"coach": {"name": "VLSI Coach", "description": "Study help", "initials": "VC", "secret": "<Direct Line secret>"}}
 *     ("secretName": "DL_SECRET_COACH" instead of "secret" reads another Worker secret).
 * Users (ACCESS_CODES, unchanged format plus two optional keys):
 *       {"code": {"name": "Ravi", "agents": ["coach"], "defaultAgent": "coach"}}
 *     no "agents" key (or "*") = every agent; the owner (ACCESS_CODE) and admins always get every agent.
 *
 *   POST /agents  -> {agents:[{id,name,description,initials}], default, person}  (only agents this code may use)
 *   /token /resume /log /export take an optional X-Agent header; the Worker picks that agent's Direct Line secret.
 *   No header = the person's default agent (old cached pages keep working). Not allowed -> 403 agent_not_allowed.
 *   /token and /resume answers gain {agent:{id,name,initials}, role}. Secrets never leave the Worker.
 *   role (TODO #7) = "owner" | "admin" | "user" | "readOnly" (ACCESS_CODES "role"); advisory, see personRole().
 * Transcripts (TODO #44): each agent logs into its own numbered folder logs/<num>/ (default agent = 1, AGENTS
 *   entries "num": 2, 3, ...); index.js writes logs/<num>/AGENT.md once to say which agent a number is.
 * Config branch (TODO #51, src/config.js): per-person agents / defaultAgent / role / files / session header can come
 *   from a private branch (CONFIG_BRANCH); a key set there wins over ACCESS_CODES. /token and /resume add {header}.
 */
import worker, { identify, rateLimited, json } from "./index.js";
import { fileRequest } from "./repofile.js";
import { loadConfig, configEntry, personHeader } from "./config.js";

export const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const DL_ROUTES = new Set(["/token", "/resume", "/log", "/export"]);

function parseJson(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

/** Valid log folder number (1-999) or null. */
export function folderNum(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/**
 * All agents that have a secret, default agent first: [{id, name, description, initials, secret, num}].
 * num = the agent's transcript folder logs/<num>/ (TODO #44): the default agent is DEFAULT_AGENT_NUM (1); an AGENTS
 * entry uses its "num"; without one it gets the lowest free number from 2 up, in AGENTS order. Set "num" explicitly
 * so removing an agent never renumbers the others.
 */
export function agentRegistry(env) {
  const extra = parseJson(env.AGENTS) || {};
  const defId = AGENT_ID_RE.test(env.DEFAULT_AGENT_ID || "") ? env.DEFAULT_AGENT_ID : "default";
  const out = [];
  if (env.DIRECTLINE_SECRET && !extra[defId]) {
    out.push({
      id: defId,
      name: env.DEFAULT_AGENT_NAME || "Agent",
      description: env.DEFAULT_AGENT_DESCRIPTION || "",
      initials: env.DEFAULT_AGENT_INITIALS || "",
      secret: env.DIRECTLINE_SECRET,
      num: folderNum(env.DEFAULT_AGENT_NUM) || 1,
    });
  }
  for (const [id, v] of Object.entries(extra)) {
    if (!AGENT_ID_RE.test(id) || !v || typeof v !== "object") continue;
    const secret = typeof v.secret === "string" && v.secret ? v.secret : typeof v.secretName === "string" ? env[v.secretName] : "";
    if (!secret || typeof secret !== "string") continue;
    const a = {
      id,
      name: String(v.name || id).slice(0, 60),
      description: String(v.description || "").slice(0, 200),
      initials: String(v.initials || "").slice(0, 3),
      secret,
      num: folderNum(v.num) || (id === defId ? folderNum(env.DEFAULT_AGENT_NUM) || 1 : null),
      // TODO #37b: agents this one can pass messages on to ("➡ Pass on to Coach" chip on the page), e.g. ["coach"]
      routes: Array.isArray(v.routes) ? v.routes.map(String).filter((r) => AGENT_ID_RE.test(r)).slice(0, 5) : [],
    };
    if (id === defId) out.unshift(a);
    else out.push(a);
  }
  // Explicit numbers first; a duplicate or missing number gets the lowest free one (2, 3, ...).
  const used = new Set();
  for (const a of out) {
    if (a.num && !used.has(a.num)) used.add(a.num);
    else a.num = null;
  }
  let next = 2;
  for (const a of out) {
    if (a.num) continue;
    while (used.has(next)) next++;
    a.num = next;
    used.add(next);
  }
  return out;
}

/**
 * Per-person agent rules (only read after identify() accepted the code): the config branch entry (TODO #51) first,
 * then ACCESS_CODES. Admin codes always get every agent (the config may only pick their default agent).
 */
export function personRules(env, code, person, cfg) {
  const c = configEntry(cfg, person) || {};
  const cDef = typeof c.defaultAgent === "string" ? c.defaultAgent : null;
  if (person && person.admin) return { agents: null, defaultAgent: cDef };
  const v = (parseJson(env.ACCESS_CODES) || {})[code];
  const s = v && typeof v === "object" ? v : {};
  const src = Array.isArray(c.agents) ? c.agents : Array.isArray(s.agents) ? s.agents : null;
  const list = src ? src.map(String) : null;
  return {
    agents: list && list.indexOf("*") < 0 ? list : null,
    defaultAgent: cDef || (typeof s.defaultAgent === "string" ? s.defaultAgent : null),
  };
}

/** TODO #51: the config branch, or a 503 for non-admins when it is on but has never been readable (fail closed). */
async function configFor(env, person, origin) {
  const cfg = await loadConfig(env);
  if (cfg.error && !(person && person.admin)) return { deny: json({ error: "config_unavailable" }, 503, origin) };
  return { cfg };
}

/**
 * TODO #7: the role the page passes to the agent in the startConversation event. ADVISORY ONLY: the agent can't
 * verify it; access control is the Worker's per-code agent list (and the #49 ownership check).
 * ACCESS_CODE = "owner"; ACCESS_CODES entry "role": "owner" | "admin" | "user" | "readOnly"; "owner"/"admin" are only
 * reported for codes that really are admins ("admin": true); otherwise admin codes = "admin", everyone else "user".
 */
export const ROLES = ["owner", "admin", "user", "readOnly"];
export function personRole(env, code, person, cfg) {
  if (env.ACCESS_CODE && code === env.ACCESS_CODE) return "owner";
  const c = configEntry(cfg, person) || {};
  const v = (parseJson(env.ACCESS_CODES) || {})[code];
  const raw = typeof c.role === "string" ? c.role : v && typeof v === "object" ? v.role : "";
  const r = ROLES.indexOf(raw) >= 0 ? raw : "";
  const admin = !!(person && person.admin);
  if (r === "owner" || r === "admin") return admin ? r : "user";
  return r || (admin ? "admin" : "user");
}

export function allowedAgents(registry, rules) {
  return rules.agents ? registry.filter((a) => rules.agents.indexOf(a.id) >= 0) : registry.slice();
}

/** {agent} or {error, status}. */
export function pickAgent(registry, allowed, rules, requested) {
  if (requested) {
    if (!AGENT_ID_RE.test(requested)) return { error: "bad_agent", status: 400 };
    const a = allowed.find((x) => x.id === requested);
    if (a) return { agent: a };
    return registry.some((x) => x.id === requested) ? { error: "agent_not_allowed", status: 403 } : { error: "unknown_agent", status: 400 };
  }
  const d = (rules.defaultAgent && allowed.find((x) => x.id === rules.defaultAgent)) || allowed[0];
  return d ? { agent: d } : { error: "agent_not_allowed", status: 403 };
}

export const publicAgent = (a) => {
  const p = { id: a.id, name: a.name, description: a.description, initials: a.initials };
  if (a.routes && a.routes.length) p.routes = a.routes.slice(); // only agents that have routes (TODO #37b)
  return p;
};

function originOf(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

/** index.js still checks DIRECTLINE_SECRET for every route: give it the first agent's secret if only AGENTS is set. */
function baseEnv(env, registry) {
  return env.DIRECTLINE_SECRET || !registry.length ? env : { ...env, DIRECTLINE_SECRET: registry[0].secret };
}

function withAgentHeader(res) {
  const h = new Headers(res.headers);
  const allow = h.get("Access-Control-Allow-Headers");
  if (allow && !/x-agent/i.test(allow)) h.set("Access-Control-Allow-Headers", allow + ", X-Agent");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** Paths handled here, not by index.js (they need their own CORS preflight). */
export const OWN_ROUTES = new Set(["/agents", "/file"]);

function preflight(request, env) {
  const origin = originOf(request, env);
  if (!origin) return json({ error: "origin_not_allowed" }, 403, null);
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Access-Code, X-Agent",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}

async function handleAgents(request, env, registry) {
  const origin = originOf(request, env);
  if (!origin) return json({ error: "origin_not_allowed" }, 403, null);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!registry.length) return json({ error: "server_not_configured" }, 500, origin);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited("api:" + ip, parseInt(env.API_RATE_LIMIT_PER_MIN || "60", 10))) return json({ error: "rate_limited" }, 429, origin);
  const code = request.headers.get("X-Access-Code") || "";
  const person = await identify(env, code);
  if (!person) {
    rateLimited("tok:" + ip, parseInt(env.RATE_LIMIT_PER_MIN || "10", 10));
    return json({ error: "bad_access_code" }, 401, origin);
  }
  const cf = await configFor(env, person, origin);
  if (cf.deny) return cf.deny;
  const rules = personRules(env, code, person, cf.cfg);
  const allowed = allowedAgents(registry, rules);
  const d = pickAgent(registry, allowed, rules, "");
  return json({ agents: allowed.map(publicAgent), default: d.agent ? d.agent.id : null, person: person.name }, 200, origin);
}

/** TODO #37a: POST /file -> worker/src/repofile.js (allow-list per code, read-only token). */
async function handleFile(request, env) {
  const origin = originOf(request, env);
  if (!origin) return json({ error: "origin_not_allowed" }, 403, null);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited("api:" + ip, parseInt(env.API_RATE_LIMIT_PER_MIN || "60", 10))) return json({ error: "rate_limited" }, 429, origin);
  const code = request.headers.get("X-Access-Code") || "";
  const person = await identify(env, code);
  if (!person) {
    rateLimited("tok:" + ip, parseInt(env.RATE_LIMIT_PER_MIN || "10", 10));
    return json({ error: "bad_access_code" }, 401, origin);
  }
  const cf = await configFor(env, person, origin);
  if (cf.deny) return cf.deny;
  const c = configEntry(cf.cfg, person);
  let body = {};
  try { body = (await request.json()) || {}; } catch (e) { body = {}; }
  // TODO #51: "files" in the config branch replaces OWNER_FILES / ACCESS_CODES "files" for this person
  const r = await fileRequest(env, code, body, c && Array.isArray(c.files) ? c.files : null);
  return json(r.body, r.status, origin);
}

/**
 * TODO #20: uploads (/artifact, /artifact/put) go to webchat-uploads/<agent number>/... when the page names the agent
 * (X-Agent, same rules as /token). No header (older page) = the old flat folder, exactly as before. The request body
 * (up to ~100 MB) is passed through untouched.
 */
const ART_ROUTES = new Set(["/artifact", "/artifact/put"]);
async function artifactRoute(request, env, env0, ctx, registry) {
  const requested = (request.headers.get("X-Agent") || "").trim();
  const origin = originOf(request, env);
  if (!requested || !origin || request.method !== "POST" || !registry.length) return worker.fetch(request, env0, ctx);
  const code = request.headers.get("X-Access-Code") || "";
  const person = await identify(env, code);
  if (!person) return worker.fetch(request, env0, ctx); // index.js answers 401 (and rate-limits)
  const cf = await configFor(env, person, origin);
  if (cf.deny) return cf.deny;
  const rules = personRules(env, code, person, cf.cfg);
  const pick = pickAgent(registry, allowedAgents(registry, rules), rules, requested);
  if (pick.error) return json({ error: pick.error }, pick.status, origin);
  const a = pick.agent;
  return worker.fetch(request, { ...env0, LOG_AGENT_NUM: String(a.num), LOG_AGENT_ID: a.id, LOG_AGENT_NAME: a.name }, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const registry = agentRegistry(env);
    const env0 = baseEnv(env, registry);

    // Routes main.js answers itself: index.js doesn't know them and would answer their CORS preflight with 404, which
    // made browsers block POST /agents (it sends X-Access-Code) - the picker never appeared. Fixed 2026-11-27.
    if (request.method === "OPTIONS" && OWN_ROUTES.has(url.pathname)) return preflight(request, env);
    if (request.method === "OPTIONS") return withAgentHeader(await worker.fetch(request, env0, ctx));
    if (url.pathname === "/agents") return handleAgents(request, env, registry);
    if (url.pathname === "/file") return handleFile(request, env);
    if (url.pathname === "/health") {
      const res = await worker.fetch(request, env0, ctx);
      const j = await res.json().catch(() => ({}));
      j.agents = registry.length;
      return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
    }
    if (ART_ROUTES.has(url.pathname)) return artifactRoute(request, env, env0, ctx, registry);
    if (!DL_ROUTES.has(url.pathname)) return worker.fetch(request, env0, ctx);

    // Origin / method / config / bad-code errors: let index.js answer exactly as before (rate limits included).
    const origin = originOf(request, env);
    if (!origin || request.method !== "POST" || !registry.length) return worker.fetch(request, env0, ctx);
    const code = request.headers.get("X-Access-Code") || "";
    const person = await identify(env, code);
    if (!person) return worker.fetch(request, env0, ctx);

    const cf = await configFor(env, person, origin);
    if (cf.deny) return cf.deny;
    const rules = personRules(env, code, person, cf.cfg);
    const pick = pickAgent(registry, allowedAgents(registry, rules), rules, (request.headers.get("X-Agent") || "").trim());
    if (pick.error) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      rateLimited("api:" + ip, parseInt(env.API_RATE_LIMIT_PER_MIN || "60", 10));
      return json({ error: pick.error }, pick.status, origin);
    }
    const a = pick.agent;
    const res = await worker.fetch(request, { ...env, DIRECTLINE_SECRET: a.secret, LOG_AGENT_NUM: String(a.num), LOG_AGENT_ID: a.id, LOG_AGENT_NAME: a.name }, ctx);
    if ((url.pathname === "/token" || url.pathname === "/resume") && res.ok) {
      const j = await res.json().catch(() => null);
      if (!j) return res;
      j.agent = { id: a.id, name: a.name, initials: a.initials };
      j.role = personRole(env, code, person, cf.cfg); // TODO #7 (advisory, see personRole)
      const h = personHeader(cf.cfg, person); // TODO #51: web/header.js puts it on top of the first / every N-th message
      if (h) j.header = h;
      return json(j, res.status, origin);
    }
    return res;
  },
};
