/**
 * TODO #49 (brief #44): conversation ownership. /resume, /export and /log only work for the access code that
 * started the conversation; admins (ACCESS_CODE owner and "admin": true codes) can open every conversation.
 *
 * - On / when the Worker secret OWNER_PEPPER is set and logging is configured (LOG_REPO + LOG_REPO_TOKEN).
 *   Off switch: OWNERSHIP_CHECK = "off" (Worker var) or remove OWNER_PEPPER.
 * - Owner id = HMAC-SHA-256(OWNER_PEPPER, access code), first 16 bytes as hex. The code itself is never stored.
 * - /token creates owners/<conversation>.json in LOG_REPO (create-only, like the logs):
 *     {"owner": "<owner id>", "agent": "<agent id>", "created": "<ISO time>"}
 * - Conversations without a record (started before this was turned on) are admin-only (owner decision 2026-11-27).
 * - Records are cached in isolate memory, so most checks cost no GitHub request.
 */

const cache = new Map(); // conversationId -> owner id ("" = no record)
const CACHE_MAX = 2000;

export function _resetOwnerCache() {
  cache.clear();
}

export function ownershipOn(env) {
  return Boolean(env.OWNER_PEPPER && env.LOG_REPO && env.LOG_REPO_TOKEN && String(env.OWNERSHIP_CHECK || "").toLowerCase() !== "off");
}

/** 32 hex chars; never the code. */
export async function ownerId(env, code) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.OWNER_PEPPER)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(code || ""))));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ownerPath(conversationId) {
  return "owners/" + String(conversationId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) + ".json";
}

function remember(conversationId, owner) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(conversationId, owner);
}

function url(env, path, repo) {
  return "https://api.github.com/repos/" + (repo || env.LOG_REPO) + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
}

function headers(env, accept) {
  return {
    Authorization: "Bearer " + env.LOG_REPO_TOKEN,
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-webchat-logger",
    "Content-Type": "application/json",
  };
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Create owners/<conversation>.json. -> {recorded: true} | {error} (never throws). */
export async function recordOwner(env, conversationId, owner, agentId) {
  if (!conversationId) return { error: "no_conversation" };
  const body = JSON.stringify({ owner, agent: agentId || "", created: new Date().toISOString() }, null, 2) + "\n";
  const req = JSON.stringify({ message: "owner: " + ownerPath(conversationId).slice(7), content: b64(body), branch: env.LOG_BRANCH || "main" });
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetch(url(env, ownerPath(conversationId)), { method: "PUT", headers: headers(env), body: req });
    } catch (e) {
      return { error: "github_unreachable" };
    }
    if (r.ok) { remember(conversationId, owner); return { recorded: true }; }
    if (r.status === 422) { cache.delete(conversationId); return { error: "exists" }; } // never overwrite
    if (r.status !== 409) return { error: "github_write_" + r.status };
  }
  return { error: "github_conflict" };
}

const REPO_NAME_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/**
 * TODO #52 part 2: older logs repos (Worker var LOG_REPOS_OLD, comma-separated; main.js sets it from the config repo's
 * "repos": {"oldLogs": [...]}). Only read (History, transcripts, owner records), never written. The current LOG_REPO
 * is never in the list; at most 5.
 */
export function oldLogRepos(env) {
  const cur = String(env.LOG_REPO || "");
  const out = [];
  for (const part of String(env.LOG_REPOS_OLD || "").split(",")) {
    const r = part.trim();
    if (r && r !== cur && REPO_NAME_RE.test(r) && out.indexOf(r) < 0 && out.length < 5) out.push(r);
  }
  return out;
}

/**
 * -> owner id, "" (no record) or null (couldn't read). Looks in the current logs repo, then in each older one
 * (TODO #52 part 2: owner records are not copied when the logs repo is switched). An older repo that can't be read
 * counts as "no record there"; the current one must be readable (fail closed, as before).
 */
export async function readOwner(env, conversationId) {
  if (cache.has(conversationId)) return cache.get(conversationId);
  const repos = [env.LOG_REPO].concat(oldLogRepos(env));
  for (let i = 0; i < repos.length; i++) {
    let r;
    try {
      r = await fetch(url(env, ownerPath(conversationId), repos[i]) + "?ref=" + encodeURIComponent(env.LOG_BRANCH || "main"), {
        headers: headers(env, "application/vnd.github.raw"),
      });
    } catch (e) {
      if (i === 0) return null;
      continue;
    }
    if (r.status === 404) continue;
    if (!r.ok) {
      if (i === 0) return null;
      continue;
    }
    let j = null;
    try { j = JSON.parse(await r.text()); } catch (e) { j = null; }
    const owner = j && typeof j.owner === "string" ? j.owner : "";
    remember(conversationId, owner);
    return owner;
  }
  remember(conversationId, "");
  return "";
}

/**
 * -> null when allowed, else {error, status}. person = {admin, owner} (owner id computed by the caller).
 * Admins always pass. No record -> admin-only. GitHub unreadable -> 503 (fail closed).
 */
export async function checkOwner(env, conversationId, person) {
  if (!ownershipOn(env) || (person && person.admin)) return null;
  const owner = await readOwner(env, conversationId);
  if (owner === null) return { error: "owner_check_unavailable", status: 503 };
  if (owner && person && person.owner && owner === person.owner) return null;
  return { error: "forbidden", status: 403 };
}
