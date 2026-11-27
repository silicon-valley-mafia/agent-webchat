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

