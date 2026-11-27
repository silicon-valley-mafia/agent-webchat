/**
 * TODO #51: per-person settings from a private config branch (owner decision 2026-11-27 23:50 IST, docs/CONFIG.md).
 *
 * Where: <CONFIG_REPO or LOG_REPO> at branch CONFIG_BRANCH (wrangler.toml: "config"), file CONFIG_PATH
 * (default config/people.json). Read with LOG_REPO_TOKEN; nothing in the Worker ever writes to this branch.
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
 *       "header": { "text": "...", "every": 10 }        session header (#51): first message, then every N (0 = first only);
 *     }                                                 null = no header for this person even if a default exists
 *   }
 * }
 * A key set here wins over the same key in ACCESS_CODES; a key left out falls back to ACCESS_CODES.
 * NOT here (they stay Worker secrets): access codes, the admin flag, Direct Line secrets, tokens, OWNER_PEPPER.
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

export function configOn(env) {
  const b = String(env.CONFIG_BRANCH || "").trim();
  return !!(b && b !== "off" && (env.CONFIG_REPO || env.LOG_REPO) && env.LOG_REPO_TOKEN);
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
    out.people[slug] = e;
  }
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
        Authorization: "Bearer " + env.LOG_REPO_TOKEN,
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
