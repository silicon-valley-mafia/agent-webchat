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

