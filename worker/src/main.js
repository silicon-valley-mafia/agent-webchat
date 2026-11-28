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
 * Wider config (TODO #53) and switchable repos (TODO #52), see configEnv(): the config repo may also hold non-secret
 *   agent settings ("agents", with "secretName" pointing at a Worker secret or a key of AGENT_SECRETS), people with a
 *   hashed access code ("codeHash"), and "repos" {logs, artifacts} for where NEW logs / uploads are written.
 *   /token and /resume add {repos}; GET /health adds {config: "off"|"on"|"stale"|"error"}.
 *   #52 part 2: "repos.oldLogs" = older logs repos that History, transcripts and the #49 owner check also read;
 *   GET /health?repos=1 adds {repos: {logs, artifacts, oldLogs: [...]}} = can the tokens read them (true/false only).
 * 💾 Save (TODO #57, src/save.js): POST /save {conversationId} commits the ⬇ Download Markdown into the chat's own
 *   log folder (<session folder>/<Download file name>); every later click overwrites it with the whole conversation.
 */
import worker, { identify, rateLimited, json, people, slugify, oldLogRepos, createOnly, localParts, CONV_RE } from "./index.js";
import { fileRequest } from "./repofile.js";
import { loadConfig, configEntry, personHeader, SECRET_NAME_RE } from "./config.js";
import { saveEnabled, saveExport } from "./save.js";

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

/**
 * TODO #53: the value of a named secret: a Worker secret of that name, else that key of the AGENT_SECRETS secret
 * (one JSON secret {"DL_SPARK": "...", ...}, so new agents need no new workflow step). "" if missing.
 */
export function secretValue(env, name) {
  if (typeof name !== "string" || !SECRET_NAME_RE.test(name)) return "";
  if (typeof env[name] === "string" && env[name]) return env[name];
  const bag = parseJson(env.AGENT_SECRETS) || {};
  return typeof bag[name] === "string" ? bag[name] : "";
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
    const secret = typeof v.secret === "string" && v.secret ? v.secret : typeof v.secretName === "string" ? secretValue(env, v.secretName) : id === defId ? env.DIRECTLINE_SECRET || "" : "";
    if (!secret || typeof secret !== "string") continue;
    const a = {
      id,
      name: String(v.name || (id === defId && env.DEFAULT_AGENT_NAME) || id).slice(0, 60),
      description: String(v.description || "").slice(0, 200),
      initials: String(v.initials || (id === defId && env.DEFAULT_AGENT_INITIALS) || "").slice(0, 3),
      secret,
      num: folderNum(v.num) || (id === defId ? folderNum(env.DEFAULT_AGENT_NUM) || 1 : null),
      // TODO #37b: agents this one can pass messages on to ("➡ Pass on to Coach" chip on the page), e.g. ["coach"]
      routes: Array.isArray(v.routes) ? v.routes.map(String).filter((r) => AGENT_ID_RE.test(r)).slice(0, 5) : [],
      // TODO #45 / #46: starter prompt chips on an empty chat; plan board in this agent's chats
      starters: Array.isArray(v.starters) ? v.starters.filter((x) => typeof x === "string" && x.trim() && x.length <= 300).map((x) => x.trim()).slice(0, 6) : [],
      plans: v.plans === true,
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

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** HMAC-SHA-256(key, msg) as lower-case hex - the "codeHash" format of the config repo (TODO #53). */
export async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(key)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(String(msg))));
}
function sameText(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/**
 * TODO #52 / #53: this request's environment with the config repo applied. index.js is unchanged; it simply sees:
 *   AGENTS        - config "agents" merged over the AGENTS secret (config wins for name/num/routes/secretName;
 *                   a secret value can only come from a Worker secret or AGENT_SECRETS)
 *   LOG_REPO / ARTIFACT_REPO - config "repos" (where NEW logs and uploads go)
 *   ACCESS_CODES  - plus this request's code when it matches a config "codeHash" (HMAC with OWNER_PEPPER). Such a
 *                   person is never admin, gets only the agents the config lists for them, and can't use the
 *                   name (slug) of anyone defined in the secrets.
 * The config itself rides along as __awConfig so every handler uses the same copy.
 */
export async function configEnv(env, cfg, code) {
  const d = cfg && cfg.data;
  if (!d) return { ...env, __awConfig: cfg };
  const out = { ...env, __awConfig: cfg };
  if (d.agents) {
    const base = parseJson(env.AGENTS) || {};
    for (const [id, c] of Object.entries(d.agents)) {
      const m = { ...(base[id] || {}), ...c };
      if (c.secretName) delete m.secret; // the config chose which secret: use exactly that one
      base[id] = m;
    }
    out.AGENTS = JSON.stringify(base);
  }
  if (d.repos && d.repos.logs) out.LOG_REPO = d.repos.logs;
  if (d.repos && d.repos.artifacts) out.ARTIFACT_REPO = d.repos.artifacts;
  if (d.repos && d.repos.oldLogs) out.LOG_REPOS_OLD = d.repos.oldLogs.join(","); // #52 part 2: read only
  const hashed = Object.entries(d.people).filter(([, e]) => e.codeHash);
  if (code && hashed.length && env.OWNER_PEPPER && !(await identify(env, code))) {
    const h = await hmacHex(env.OWNER_PEPPER, code);
    const taken = new Set(people(env).map((p) => p.slug));
    let hit = null;
    for (const [slug, e] of hashed) if (sameText(h, e.codeHash) && !hit) hit = [slug, e]; // no early exit
    if (hit && !taken.has(hit[0])) {
      const [slug, e] = hit;
      const name = e.name && slugify(e.name) === slug ? e.name : slug;
      const codes = parseJson(env.ACCESS_CODES) || {};
      codes[code] = { name, agents: Array.isArray(e.agents) ? e.agents : [] };
      out.ACCESS_CODES = JSON.stringify(codes);
    }
  }
  return out;
}

/** TODO #51: the config branch, or a 503 for non-admins when it is on but has never been readable (fail closed). */
async function configFor(env, person, origin) {
  const cfg = env.__awConfig || (await loadConfig(env));
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
  if (a.starters && a.starters.length) p.starters = a.starters.slice(); // TODO #45
  if (a.plans) p.plans = true; // TODO #46
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
export const OWN_ROUTES = new Set(["/agents", "/file", "/save"]);

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
  // nums: folder number per agent (logs/<N>/), for the History filter (TODO #20)
  return json({ agents: allowed.map(publicAgent), default: d.agent ? d.agent.id : null, person: person.name,
    nums: Object.fromEntries(allowed.map((a) => [a.id, a.num])) }, 200, origin);
}

/** TODO #37a: POST /file -> worker/src/repofile.js (allow-list per code, read-only token). */
/**
 * Hardening 2026-11-28: every 📄 File read, and every refused one, is recorded in the logs repo (create-only):
 *   audit/file-reads/<YYYY-MM-DD>/<HHMMSS>-<person>-<4 hex>.md  - who, which file, sha, size, result, country.
 * No IP address and no file text. Directory listings and "roots" are not recorded.
 * Off: FILE_AUDIT = "off"; also off without LOG_REPO / LOG_REPO_TOKEN. -> a promise, or null when nothing to record.
 */
export function fileAudit(env, person, body, r, request) {
  if (String(env.FILE_AUDIT || "").toLowerCase() === "off" || !env.LOG_REPO || !env.LOG_REPO_TOKEN) return null;
  if (!body || body.op !== "get" || !r) return null;
  const b = r.body || {};
  if (b.type === "dir") return null;
  if (!(b.type === "file" || r.status === 403)) return null;
  const t = localParts(new Date().toISOString(), parseInt(env.LOG_TZ_OFFSET_MIN || "330", 10));
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)), (x) => x.toString(16).padStart(2, "0")).join("");
  const slug = (person && person.slug) || "user";
  const path = "audit/file-reads/" + t.date + "/" + t.time.replace(/:/g, "") + "-" + slug + "-" + rand + ".md";
  const clean = (v) => String(v == null ? "" : v).replace(/[|`\r\n]/g, " ").slice(0, 400);
  const lines = [
    "# File read " + t.date + " " + t.time,
    "",
    "| | |",
    "|---|---|",
    "| Person | " + clean((person && person.name) || slug) + " |",
    "| File | `" + clean(body.repo) + "/" + clean(body.path) + "` |",
    "| Result | " + (b.type === "file" ? "read" : "refused: " + clean(b.error || r.status)) + " |",
  ];
  if (b.type === "file") lines.push("| sha | `" + clean(b.sha) + "` |", "| Size | " + clean(b.size) + " bytes |");
  lines.push("| Country | " + clean((request && request.headers.get("CF-IPCountry")) || "-") + " |", "");
  return createOnly(env, path, lines.join("\n"), "audit: file read by " + slug, { left: 1 }).catch(() => null);
}

async function handleFile(request, env, ctx) {
  const origin = originOf(request, env);
  if (!origin) return json({ error: "origin_not_allowed" }, 403, null);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited("api:" + ip, parseInt(env.API_RATE_LIMIT_PER_MIN || "60", 10))) return json({ error: "rate_limited" }, 429, origin);
  // Hardening 2026-11-28: /file reads private repos, so it gets a tighter limit of its own as well.
  if (rateLimited("file:" + ip, parseInt(env.FILE_RATE_PER_MIN || "30", 10))) return json({ error: "rate_limited" }, 429, origin);
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
  const audit = fileAudit(env, person, body, r, request);
  if (audit) {
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(audit);
    else await audit;
  }
  return json(r.body, r.status, origin);
}

/**
 * TODO #57: POST /save {conversationId} -> src/save.js. Same checks as /export (origin, rate limit, access code, config,
 * X-Agent allow-list); the transcript itself comes from index.js /export, so the #49 ownership check applies too.
 * "readOnly" codes may not save (it writes to the repo). -> {saved, status, path, repo, branch, url, commit, messages}
 */
async function handleSave(request, env, ctx, registry) {
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
  if (!saveEnabled(env)) return json({ saved: false, error: "save_disabled" }, 400, origin);
  const cf = await configFor(env, person, origin);
  if (cf.deny) return cf.deny;
  if (personRole(env, code, person, cf.cfg) === "readOnly") return json({ saved: false, error: "read_only" }, 403, origin);
  const rules = personRules(env, code, person, cf.cfg);
  const pick = pickAgent(registry, allowedAgents(registry, rules), rules, (request.headers.get("X-Agent") || "").trim());
  if (pick.error) return json({ error: pick.error }, pick.status, origin);
  let body = {};
  try { body = (await request.json()) || {}; } catch (e) { body = {}; }
  const id = body.conversationId;
  if (typeof id !== "string" || !CONV_RE.test(id)) return json({ error: "bad_conversation_id" }, 400, origin);
  const a = pick.agent;
  const agentEnv = { ...env, DIRECTLINE_SECRET: a.secret, LOG_AGENT_NUM: String(a.num), LOG_AGENT_ID: a.id, LOG_AGENT_NAME: a.name };
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  const exportReq = new Request(new URL("/export", request.url).toString(), { method: "POST", headers, body: JSON.stringify({ conversationId: id }) });
  const exp = await worker.fetch(exportReq, agentEnv, ctx);
  if (!exp.ok) return exp; // 403 not_owner, 502 directline_error, ... exactly as ⬇ Download would answer
  const j = await exp.json().catch(() => null);
  const r = await saveExport(env, j, person);
  if (r.error) return json({ saved: false, error: r.error }, r.status || 502, origin);
  return json(r, 200, origin);
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

/**
 * TODO #52 part 2: GET /health?repos=1 -> can the Worker's tokens read each configured repo? true / false / null (no
 * repo or no token) only, never names. Cached 5 minutes per isolate, so /health can't be used to burn GitHub quota.
 * A read check only: a token that can read but not write shows up as logging errors (see docs/PORTABLE-REPOS.md).
 */
let repoCheckCache = null;
export function _resetRepoCheck() {
  repoCheckCache = null;
}
export async function repoCheck(env, now = Date.now()) {
  if (repoCheckCache && now - repoCheckCache.at < 300000) return repoCheckCache.v;
  const can = async (repo, token) => {
    if (!repo || !token) return null;
    try {
      const r = await fetch("https://api.github.com/repos/" + repo, {
        headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agent-webchat-logger" },
      });
      return r.ok;
    } catch (e) {
      return false;
    }
  };
  const v = {
    logs: await can(env.LOG_REPO, env.LOG_REPO_TOKEN),
    artifacts: await can(env.ARTIFACT_REPO, env.ARTIFACT_REPO_TOKEN || env.LOG_REPO_TOKEN),
    oldLogs: await Promise.all(oldLogRepos(env).map((r) => can(r, env.LOG_REPO_TOKEN))),
  };
  repoCheckCache = { at: now, v };
  return v;
}

export default {
  async fetch(request, rawEnv, ctx) {
    const url = new URL(request.url);
    // TODO #52 / #53: apply the config repo (agents, repos, hashed codes) once per request; see configEnv().
    const cfg0 = request.method === "OPTIONS" ? null : await loadConfig(rawEnv);
    const env = cfg0 ? await configEnv(rawEnv, cfg0, request.headers.get("X-Access-Code") || "") : rawEnv;
    const registry = agentRegistry(env);
    const env0 = baseEnv(env, registry);

    // Routes main.js answers itself: index.js doesn't know them and would answer their CORS preflight with 404, which
    // made browsers block POST /agents (it sends X-Access-Code) - the picker never appeared. Fixed 2026-11-27.
    if (request.method === "OPTIONS" && OWN_ROUTES.has(url.pathname)) return preflight(request, env);
    if (request.method === "OPTIONS") return withAgentHeader(await worker.fetch(request, env0, ctx));
    if (url.pathname === "/agents") return handleAgents(request, env, registry);
    if (url.pathname === "/file") return handleFile(request, env, ctx);
    if (url.pathname === "/save") return handleSave(request, env, ctx, registry); // TODO #57
    if (url.pathname === "/health") {
      const res = await worker.fetch(request, env0, ctx);
      const j = await res.json().catch(() => ({}));
      j.agents = registry.length;
      // TODO #52 / #53: is the config repo in use, and is it readable? (no names, no contents)
      j.config = !cfg0 || cfg0.off ? "off" : cfg0.error ? "error" : cfg0.stale ? "stale" : "on";
      if (url.searchParams.get("repos") === "1") j.repos = await repoCheck(env); // TODO #52 part 2
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
      // TODO #52: where this chat is logged / uploads go (config "repos" or wrangler.toml), for the page's links
      j.repos = { logs: env.LOG_REPO || "", artifacts: env.ARTIFACT_REPO || "" };
      return json(j, res.status, origin);
    }
    return res;
  },
};
