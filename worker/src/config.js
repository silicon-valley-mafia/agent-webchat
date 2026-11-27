/**
 * TODO #51: per-person settings from a private config branch (owner decision 2026-11-27 23:50 IST, docs/CONFIG.md).
 *
 * Where: <CONFIG_REPO or LOG_REPO> at branch CONFIG_BRANCH (wrangler.toml: agent-webchat-config @ main), file
 * CONFIG_PATH (default config/people.json). Read with CONFIG_TOKEN, else AGENT_SYSTEM_PAT (the agent system's PAT,
 * owner decision 2026-11-28 00:12 IST), else LOG_REPO_TOKEN. Nothing in the Worker ever writes there.
 * Cached per isolate for CONFIG_TTL_SEC (default 60), so an edit takes effect within about a minute, no redeploy.
 *
 * {
 *   "header": { "text": "...", "every": 0 },          optional default session header for everyone
 *   "people": {
 *     "<person slug>": {                                slug = the person's logs folder name, e.g. "deepesh"
 *       "agents": ["spark", "conductor"] | ["*"],       agents this person may open (admin codes: always all)
 *       "defaultAgent": "spark",
 *       "role": "owner" | "admin" | "user" | "readOnly",   advisory (#7); owner/admin only count for admin codes
 *       "files": ["owner/repo/folder/"],                📄 Insert file folders (#37a); replaces OWNER_FILES / "files"
 *       "header": { "text": "...", "every": 10 },       session header (#51): first message, then every N (0 = first only);
 *                                                       null = no header for this person even if a default exists
 *       "codeHash": "<64 hex>", "name": "Ravi"          #53: access code as HMAC-SHA-256(OWNER_PEPPER, code); never admin
 *     }
 *   },
 *   "agents": {                                         #53: non-secret agent settings, merged over the AGENTS secret
 *     "spark": { "name": "SPARK", "initials": "SP", "num": 2, "routes": ["coach"], "secretName": "DL_SPARK" }
 *   },                                                  secretName = a Worker secret, or a key of the AGENT_SECRETS secret
 *   "repos": { "logs": "owner/repo", "artifacts": "owner/repo" }   #52: where NEW logs / uploads are written
 *            + "oldLogs": ["owner/old-logs"]                  #52 part 2: older logs repos, only read (History etc.)
 * }
 * A key set here wins over the same key in ACCESS_CODES; a key left out falls back to ACCESS_CODES.
 * NOT here (they stay Worker secrets): plain access codes, the admin flag, Direct Line secrets, tokens, OWNER_PEPPER.
 * A "secret" key under "agents" is ignored on purpose.
 *
 * Off: CONFIG_BRANCH unset or "off" -> everything comes from the secrets, exactly as before.
 * Missing file or branch (404) = empty config (the secrets apply).
 * GitHub unreachable / bad JSON: the last good copy is used; with none, loadConfig() answers {error} and main.js
 * refuses non-admin codes (503 config_unavailable) instead of falling back to wider secret rules (fail closed).
 */

export const HEADER_MAX = 4000;
const RETRY_MS = 15000;
const SLUG_RE = /^[a-z0-9-]{1,24}$/;

let cache = { key: "", at: 0, data: null, errAt: 0, err: "" };
export function _resetConfigCache() {
  cache = { key: "", at: 0, data: null, errAt: 0, err: "" };
}

export function configToken(env) {
  return env.CONFIG_TOKEN || env.AGENT_SYSTEM_PAT || env.LOG_REPO_TOKEN || "";
}

export function configOn(env) {
  const b = String(env.CONFIG_BRANCH || "").trim();
  return !!(b && b !== "off" && (env.CONFIG_REPO || env.LOG_REPO) && configToken(env));
}

/** Pure: {text, every} or null. A plain string counts as {text}. */
export function normHeader(h) {
  if (typeof h === "string") h = { text: h };
  if (!h || typeof h !== "object" || Array.isArray(h)) return null;
  const text = String(h.text || "").trim().slice(0, HEADER_MAX);
  if (!text) return null;
  const n = Number(h.every);
  return { text, every: Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 0 };
}

const AGENT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** Name of a Worker secret (TODO #53): the config may NAME a secret, never contain one. */
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** owner/repo */
export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * TODO #53: non-secret agent settings. {"spark": {"name","description","initials","num","routes","secretName"}}.
 * A "secret" key is ignored on purpose: Direct Line secrets stay Worker secrets; "secretName" says which one.
 */
function normAgents(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!AGENT_RE.test(id) || !isObj(v)) continue;
    const a = {};
    for (const k of ["name", "description", "initials"]) if (typeof v[k] === "string") a[k] = v[k];
    if (v.num !== undefined) a.num = v.num;
    if (Array.isArray(v.routes)) a.routes = v.routes.map(String).slice(0, 5);
    if (typeof v.secretName === "string" && SECRET_NAME_RE.test(v.secretName)) a.secretName = v.secretName;
    out[id] = a;
  }
  return out;
}

/** TODO #52: where new logs / uploads are written. {"logs": "owner/repo", "artifacts": "owner/repo"} */
function normRepos(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of ["logs", "artifacts"]) if (typeof raw[k] === "string" && REPO_RE.test(raw[k].trim())) out[k] = raw[k].trim();
  // TODO #52 part 2: older logs repos, only READ (History, transcripts, #49 owner records); at most 5
  if (Array.isArray(raw.oldLogs)) {
    const old = [];
    for (const r of raw.oldLogs) {
      const t = typeof r === "string" ? r.trim() : "";
      if (t && REPO_RE.test(t) && old.indexOf(t) < 0 && old.length < 5) old.push(t);
    }
    if (old.length) out.oldLogs = old;
  }
  return out;
}

/** Pure: the validated config from parsed JSON. Unknown keys and bad entries are dropped. */
export function normalizeConfig(raw) {
  const out = { header: normHeader(raw && raw.header), people: {} };
  const ppl = raw && raw.people && typeof raw.people === "object" && !Array.isArray(raw.people) ? raw.people : {};
  for (const [k, v] of Object.entries(ppl)) {
    const slug = String(k).toLowerCase();
    if (!SLUG_RE.test(slug) || !v || typeof v !== "object" || Array.isArray(v)) continue;
    const e = {};
    if (Array.isArray(v.agents)) e.agents = v.agents.map(String).slice(0, 50);
    if (typeof v.defaultAgent === "string") e.defaultAgent = v.defaultAgent;
    if (typeof v.role === "string") e.role = v.role;
    if (Array.isArray(v.files)) e.files = v.files.map(String).slice(0, 50);
    if ("header" in v) e.header = normHeader(v.header);
    // TODO #53: the person's access code as HMAC-SHA-256(OWNER_PEPPER, code), lower-case hex - never the code itself
    if (typeof v.codeHash === "string" && HASH_RE.test(v.codeHash.trim().toLowerCase())) e.codeHash = v.codeHash.trim().toLowerCase();
    if (typeof v.name === "string" && v.name.trim()) e.name = v.name.trim().slice(0, 60);
    out.people[slug] = e;
  }
  const agents = normAgents(raw && raw.agents);
  if (Object.keys(agents).length) out.agents = agents;
  const repos = normRepos(raw && raw.repos);
  if (Object.keys(repos).length) out.repos = repos;
  return out;
}

/** -> {off:true} | {data} | {data, stale:true} | {error}. */
export async function loadConfig(env, now = Date.now()) {
  if (!configOn(env)) return { off: true };
  const repo = env.CONFIG_REPO || env.LOG_REPO;
  const branch = String(env.CONFIG_BRANCH).trim();
  const path = env.CONFIG_PATH || "config/people.json";
  const key = repo + "@" + branch + ":" + path;
  if (cache.key !== key) {
    _resetConfigCache();
    cache.key = key;
  }
  const ttl = Math.max(5, parseInt(env.CONFIG_TTL_SEC || "60", 10) || 60) * 1000;
  if (cache.data && now - cache.at < ttl) return { data: cache.data };
  const fail = (err) => {
    cache.errAt = now;
    cache.err = err;
    return cache.data ? { data: cache.data, stale: true } : { error: err };
  };
  if (cache.errAt && now - cache.errAt < RETRY_MS) return cache.data ? { data: cache.data, stale: true } : { error: cache.err };
  const url = "https://api.github.com/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") +
    "?ref=" + encodeURIComponent(branch);
  let r;
  try {
    r = await fetch(url, {
      headers: {
        Authorization: "Bearer " + configToken(env),
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agent-webchat-config",
      },
    });
  } catch (e) {
    return fail("config_unreachable");
  }
  let data;
  if (r.status === 404) data = normalizeConfig({});
  else if (!r.ok) return fail("config_read_" + r.status);
  else {
    try {
      data = normalizeConfig(JSON.parse(await r.text()));
    } catch (e) {
      return fail("config_bad_json");
    }
  }
  cache.data = data;
  cache.at = now;
  cache.errAt = 0;
  cache.err = "";
  return { data };
}

/** The person's entry ({agents?, defaultAgent?, role?, files?, header?}) or null. */
export function configEntry(cfg, person) {
  if (!cfg || !cfg.data || !person) return null;
  return cfg.data.people[String(person.slug || "").toLowerCase()] || null;
}

/** Session header for this person: their own (null = none), else the default, else null. */
export function personHeader(cfg, person) {
  const e = configEntry(cfg, person);
  if (e && "header" in e) return e.header;
  return (cfg && cfg.data && cfg.data.header) || null;
}
