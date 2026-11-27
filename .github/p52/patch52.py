import io, os

D = '.github/p52/'

def rd(p):
    return io.open(p, encoding='utf-8').read()

def wr(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

def rep(s, old, new, what):
    n = s.count(old)
    assert n == 1, (what, n)
    return s.replace(old, new)

def cut(s, start, end, new, what, back_to_doc=False):
    a = s.find(start)
    assert a >= 0 and s.count(start) == 1, (what, 'start')
    if back_to_doc:
        a = s.rfind('/**', 0, a)
        assert a >= 0, (what, 'doc')
    b = s.find(end, a + 1)
    assert b > a and s.count(end) == 1, (what, 'end')
    return s[:a] + new + s[b:]

# ---- worker/src/owners.js ----
p = 'worker/src/owners.js'
s = rd(p)
s = rep(s, 'function url(env, path) {\n  return "https://api.github.com/repos/" + env.LOG_REPO + "/contents/"',
        'function url(env, path, repo) {\n  return "https://api.github.com/repos/" + (repo || env.LOG_REPO) + "/contents/"', 'owners url')
s = cut(s, 'export async function readOwner(env, conversationId) {', '/**\n * -> null when allowed', rd(D + 'readowner.js'), 'readOwner', True)
wr(p, s)

# ---- worker/src/index.js ----
p = 'worker/src/index.js'
s = rd(p)
s = rep(s, 'import { ownershipOn, ownerId, recordOwner, checkOwner } from "./owners.js";',
        'import { ownershipOn, ownerId, recordOwner, checkOwner, oldLogRepos } from "./owners.js";', 'index import')
s = rep(s, 'export { ownershipOn, ownerId, ownerPath, recordOwner, readOwner, checkOwner, _resetOwnerCache } from "./owners.js";',
        'export { ownershipOn, ownerId, ownerPath, recordOwner, readOwner, checkOwner, _resetOwnerCache, oldLogRepos } from "./owners.js";', 'index export')
s = rep(s, 'async function readSessionFolder(env, folder) {\n  const [owner, name] = String(env.LOG_REPO).split("/");',
        'async function readSessionFolder(env, folder, repo) {\n  const [owner, name] = String(repo || env.LOG_REPO).split("/");', 'readSessionFolder')
s = rep(s, 'messages,agent?}]}', 'messages,agent?,repo?}]}', 'doc history')
s = rep(s, ' *   /transcript  {path: session folder} -> {markdown}  (one GraphQL call reads every file in the folder)\n',
        ' *   /transcript  {path: session folder} -> {markdown}  (one GraphQL call reads every file in the folder)\n'
        ' *   TODO #52 part 2: /history, /transcript and the #49 owner check also read the older logs repos in\n'
        ' *   LOG_REPOS_OLD (comma-separated; from the config repo "repos.oldLogs"); history items found only there get {repo}.\n', 'doc transcript')
s = cut(s, 'async function handleHistory(env, origin, person) {', 'async function handleTranscript(env, origin, person, body) {', rd(D + 'history.js'), 'history')
s = cut(s, 'async function handleTranscript(env, origin, person, body) {', 'const ROUTES = {', rd(D + 'transcript.js'), 'transcript')
wr(p, s)

# ---- worker/src/config.js ----
p = 'worker/src/config.js'
s = rd(p)
s = rep(s, '  for (const k of ["logs", "artifacts"]) if (typeof raw[k] === "string" && REPO_RE.test(raw[k].trim())) out[k] = raw[k].trim();\n',
        '  for (const k of ["logs", "artifacts"]) if (typeof raw[k] === "string" && REPO_RE.test(raw[k].trim())) out[k] = raw[k].trim();\n'
        '  // TODO #52 part 2: older logs repos, only READ (History, transcripts, #49 owner records); at most 5\n'
        '  if (Array.isArray(raw.oldLogs)) {\n'
        '    const old = [];\n'
        '    for (const r of raw.oldLogs) {\n'
        '      const t = typeof r === "string" ? r.trim() : "";\n'
        '      if (t && REPO_RE.test(t) && old.indexOf(t) < 0 && old.length < 5) old.push(t);\n'
        '    }\n'
        '    if (old.length) out.oldLogs = old;\n'
        '  }\n', 'normRepos')
s = rep(s, '"repos": { "logs": "owner/repo", "artifacts": "owner/repo" }   #52: where NEW logs / uploads are written\n',
        '"repos": { "logs": "owner/repo", "artifacts": "owner/repo" }   #52: where NEW logs / uploads are written\n'
        ' *            + "oldLogs": ["owner/old-logs"]                  #52 part 2: older logs repos, only read (History etc.)\n', 'config doc')
wr(p, s)

# ---- worker/src/main.js ----
p = 'worker/src/main.js'
s = rd(p)
s = rep(s, 'import worker, { identify, rateLimited, json, people, slugify } from "./index.js";',
        'import worker, { identify, rateLimited, json, people, slugify, oldLogRepos } from "./index.js";', 'main import')
s = rep(s, '  if (d.repos && d.repos.artifacts) out.ARTIFACT_REPO = d.repos.artifacts;\n',
        '  if (d.repos && d.repos.artifacts) out.ARTIFACT_REPO = d.repos.artifacts;\n'
        '  if (d.repos && d.repos.oldLogs) out.LOG_REPOS_OLD = d.repos.oldLogs.join(","); // #52 part 2: read only\n', 'configEnv')
s = rep(s, 'GET /health adds {config: "off"|"on"|"stale"|"error"}.\n',
        'GET /health adds {config: "off"|"on"|"stale"|"error"}.\n'
        ' *   #52 part 2: "repos.oldLogs" = older logs repos that History, transcripts and the #49 owner check also read;\n'
        ' *   GET /health?repos=1 adds {repos: {logs, artifacts, oldLogs: [...]}} = can the tokens read them (true/false only).\n', 'main doc')
s = rep(s, '      j.config = !cfg0 || cfg0.off ? "off" : cfg0.error ? "error" : cfg0.stale ? "stale" : "on";\n',
        '      j.config = !cfg0 || cfg0.off ? "off" : cfg0.error ? "error" : cfg0.stale ? "stale" : "on";\n'
        '      if (url.searchParams.get("repos") === "1") j.repos = await repoCheck(env); // TODO #52 part 2\n', 'health')
s = rep(s, '\nexport default {\n', '\n' + rd(D + 'repocheck.js') + 'export default {\n', 'repoCheck')
wr(p, s)

# ---- web/sessions.js ----
p = 'web/sessions.js'
s = rd(p)
s = rep(s, '(D.cfg.logRepo || "silicon-valley-mafia/agent-webchat-logs")',
        '((s.repos && s.repos.logs) || D.cfg.logRepo || "silicon-valley-mafia/agent-webchat-logs")', 'sessions logs')
s = rep(s, '(D.cfg.artifactRepo || "silicon-valley-mafia/agent-webchat-artifcats-1")',
        '((s.repos && s.repos.artifacts) || D.cfg.artifactRepo || "silicon-valley-mafia/agent-webchat-artifcats-1")', 'sessions art')
wr(p, s)

# ---- web/app.js ----
p = 'web/app.js'
s = rd(p)
s = rep(s, 'name: t.name || "", admin: !!t.admin, startedAt: Date.now(),',
        'name: t.name || "", admin: !!t.admin, repos: t.repos || null, startedAt: Date.now(),', 'app repos')
s = rep(s, '" msg" + (item.messages === 1 ? "" : "s");',
        '" msg" + (item.messages === 1 ? "" : "s") + (item.repo ? "  \u00b7  older logs repo" : "");', 'app history')
wr(p, s)

# ---- tests ----
p = 'worker/test/config53.test.js'
s = rd(p)
wr(p, s.rstrip('\n') + '\n' + rd(D + 'tests.js'))
print('patched')
