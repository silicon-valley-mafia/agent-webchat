import io

D = '.github/p60/'


def rd(p):
    return io.open(p, encoding='utf-8').read()


def wr(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def rep(s, old, new, what):
    n = s.count(old)
    assert n == 1, (what, n)
    return s.replace(old, new)


# ---------------- worker/src/repofile.js ----------------
p = 'worker/src/repofile.js'
s = rd(p)
s = rep(s, ' * Limits: text files only, FILE_MAX_BYTES (default 30720 = 30 KB), no "..", no ".github/", 1 GitHub request per call.\n */',
        ' * Limits: text files only, FILE_MAX_BYTES (default 30720 = 30 KB), no "..", no ".github/", 1 GitHub request per call.\n'
        ' * Hardening (2026-11-28, the read token may cover many repos, so the Worker itself must hold the line):\n'
        ' *   - default branch only: "ref" is refused (an old commit or another branch could still hold something deleted later);\n'
        ' *   - a symlink is refused: GitHub answers a symlink with its TARGET, which may lie outside the allowed folder;\n'
        ' *   - secret-looking names (secret(s), credential(s), password(s), passwd, api key(s), private key(s), .env) are\n'
        ' *     never served or listed, even inside an allowed folder. Off: FILE_SENSITIVE_CHECK = "off";\n'
        ' *   - main.js adds its own per-IP limit (FILE_RATE_PER_MIN, 30) and an audit record per read (fileAudit).\n'
        ' */', 'doc')
s = rep(s, 'const REF_RE = /^[A-Za-z0-9._\\/-]{1,100}$/;\n',
        '/** Names that look like they hold a secret: never served or listed (hardening 2026-11-28). */\n'
        'export const SENSITIVE_RE = /(^|[\\/._ -])(secrets?|credentials?|passwords?|passwd|api[-_]?keys?|private[-_]?keys?|\\.env)([\\/._ -]|$)/i;\n'
        'export function sensitive(env, path) {\n'
        '  return String((env && env.FILE_SENSITIVE_CHECK) || "").toLowerCase() !== "off" && SENSITIVE_RE.test(String(path || ""));\n'
        '}\n', 'REF_RE')
s = rep(s, '  const ref = body.ref ? String(body.ref) : "";\n  if (ref && !REF_RE.test(ref)) return { status: 400, body: { error: "bad_ref" } };\n',
        '  // Default branch only: an old commit or another branch could still hold something removed from it later.\n'
        '  if (body.ref) return { status: 400, body: { error: "bad_ref", hint: "default branch only" } };\n'
        '  if (sensitive(env, path)) return { status: 403, body: { error: "sensitive_name" } };\n', 'ref')
s = rep(s, '.map(encodeURIComponent).join("/") +\n    (ref ? "?ref=" + encodeURIComponent(ref) : "");\n',
        '.map(encodeURIComponent).join("/");\n', 'url')
s = rep(s, '      .filter((e) => e.name.toLowerCase() !== ".github")\n',
        '      .filter((e) => e.name.toLowerCase() !== ".github")\n      .filter((e) => !sensitive(env, e.path))\n', 'dir filter')
s = rep(s, '  if (!j || j.type !== "file") return { status: 400, body: { error: "not_a_file" } };\n',
        '  if (!j || j.type !== "file") return { status: 400, body: { error: "not_a_file" } };\n'
        '  // A symlink makes GitHub answer with its TARGET (type "file", the target\'s path and name), which may be anywhere\n'
        '  // in the repo: only serve exactly the path that was asked for.\n'
        '  if ((j.path !== undefined && j.path !== path) || (j.name !== undefined && j.name !== path.split("/").pop())) {\n'
        '    return { status: 403, body: { error: "path_not_allowed" } };\n'
        '  }\n', 'symlink')
s = rep(s, 'body: { type: "file", repo, path, ref: ref || null, sha,', 'body: { type: "file", repo, path, sha,', 'body ref')
wr(p, s)

# ---------------- worker/src/main.js ----------------
p = 'worker/src/main.js'
s = rd(p)
s = rep(s, 'import worker, { identify, rateLimited, json, people, slugify, oldLogRepos } from "./index.js";',
        'import worker, { identify, rateLimited, json, people, slugify, oldLogRepos, createOnly, localParts } from "./index.js";', 'import')
s = rep(s, 'if (url.pathname === "/file") return handleFile(request, env);', 'if (url.pathname === "/file") return handleFile(request, env, ctx);', 'call')
s = rep(s, 'async function handleFile(request, env) {', rd(D + 'audit.js') + 'async function handleFile(request, env, ctx) {', 'def')
s = rep(s, '''  const r = await fileRequest(env, code, body, c && Array.isArray(c.files) ? c.files : null);
  return json(r.body, r.status, origin);''',
        '''  const r = await fileRequest(env, code, body, c && Array.isArray(c.files) ? c.files : null);
  const audit = fileAudit(env, person, body, r, request);
  if (audit) {
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(audit);
    else await audit;
  }
  return json(r.body, r.status, origin);''', 'audit call')
# own per-IP limit for /file, right after the shared api limit inside handleFile
i = s.index('async function handleFile(request, env, ctx) {')
j = s.index('if (rateLimited("api:" + ip, parseInt(env.API_RATE_LIMIT_PER_MIN || "60", 10))) return json({ error: "rate_limited" }, 429, origin);', i)
k = s.index('\n', j) + 1
s = s[:k] + '  // Hardening 2026-11-28: /file reads private repos, so it gets a tighter limit of its own as well.\n' \
    '  if (rateLimited("file:" + ip, parseInt(env.FILE_RATE_PER_MIN || "30", 10))) return json({ error: "rate_limited" }, 429, origin);\n' + s[k:]
wr(p, s)

# ---------------- tests ----------------
p = 'worker/test/repofile.test.js'
s = rd(p)
wr(p, s.rstrip('\n') + '\n' + rd(D + 'tests.js'))
print('patched')
