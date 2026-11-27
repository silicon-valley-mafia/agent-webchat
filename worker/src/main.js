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
 *   /token and /resume answers gain {agent:{id,name,initials}}. Secrets never leave the Worker.
 * Transcripts (TODO #44): each agent logs into its own numbered folder logs/<num>/ (default agent = 1, AGENTS
 *   entries "num": 2, 3, ...); index.js writes logs/<num>/AGENT.md once to say which agent a number is.
 */
import worker, { identify, rateLimited, json } from "./index.js";

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

/** Per-person agent rules from ACCESS_CODES (only read after identify() accepted the code). */
export function personRules(env, code, person) {
  if (person && person.admin) return { agents: null, defaultAgent: null };
  const v = (parseJson(env.ACCESS_CODES) || {})[code];
  if (!v || typeof v !== "object") return { agents: null, defaultAgent: null };
  const list = Array.isArray(v.agents) ? v.agents.map(String) : null;
  return {
    agents: list && list.indexOf("*") < 0 ? list : null,
    defaultAgent: typeof v.defaultAgent === "string" ? v.defaultAgent : null,
  };
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

export const publicAgent = (a) => ({ id: a.id, name: a.name, description: a.description, initials: a.initials });

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
  const rules = personRules(env, code, person);
  const allowed = allowedAgents(registry, rules);
  const d = pickAgent(registry, allowed, rules, "");
  return json({ agents: allowed.map(publicAgent), default: d.agent ? d.agent.id : null, person: person.name }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const registry = agentRegistry(env);
    const env0 = baseEnv(env, registry);

    if (request.method === "OPTIONS") return withAgentHeader(await worker.fetch(request, env0, ctx));
    if (url.pathname === "/agents") return handleAgents(request, env, registry);
    if (url.pathname === "/health") {
      const res = await worker.fetch(request, env0, ctx);
      const j = await res.json().catch(() => ({}));
      j.agents = registry.length;
      return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
    }
    if (!DL_ROUTES.has(url.pathname)) return worker.fetch(request, env0, ctx);

    // Origin / method / config / bad-code errors: let index.js answer exactly as before (rate limits included).
    const origin = originOf(request, env);
    if (!origin || request.method !== "POST" || !registry.length) return worker.fetch(request, env0, ctx);
    const code = request.headers.get("X-Access-Code") || "";
    const person = await identify(env, code);
    if (!person) return worker.fetch(request, env0, ctx);

    const rules = personRules(env, code, person);
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
      return json(j, res.status, origin);
    }
    return res;
  },
};
