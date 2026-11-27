/**
 * TODO #37a: read a text file (.md / .markdown / .txt) from an allowed GitHub repo path, for "📄 Insert file".
 *
 *   POST /file {op: "roots"}                    -> {roots: ["owner/repo/prefix/", ...], maxBytes}
 *   POST /file {op: "get", repo, path, ref?}    -> file:      {type:"file", repo, path, sha, size, text, header}
 *                                                  directory: {type:"dir", repo, path, entries:[{name, path, type}]}
 *
 * Allow-list (who may read what), never from the request:
 *   - owner code (ACCESS_CODE): Worker secret OWNER_FILES = JSON array of "owner/repo/" or "owner/repo/prefix/";
 *   - other codes: "files": [...] in their ACCESS_CODES entry; no entry = nothing (owner decision 2026-11-27);
 *   - TODO #51: "files" in the person's entry in the config branch (src/config.js) replaces both (main.js passes it).
 * Token: Worker secret FILE_READ_TOKEN - a fine-grained PAT with Contents: READ only on those repos. Without it the
 *   route answers {error: "file_disabled"}. LOG_REPO_TOKEN is never used here (it can write).
 * Limits: text files only, FILE_MAX_BYTES (default 30720 = 30 KB), no "..", no ".github/", 1 GitHub request per call.
 */

export const FILE_EXT_RE = /\.(md|markdown|txt)$/i;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const PATH_RE = /^[A-Za-z0-9_.\/ ()+@,-]{0,400}$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,100}$/;

function parseJson(s, want) {
  try {
    const v = JSON.parse(s || "null");
    return want === "array" ? (Array.isArray(v) ? v : null) : v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

/** "owner/repo/prefix/" normalised: no leading slash, ends with "/". Invalid -> "". */
export function normRoot(p) {
  let s = String(p || "").trim().replace(/^\/+/, "");
  if (!s) return "";
  if (!s.endsWith("/")) s += "/";
  const parts = s.split("/");
  if (parts.length < 3 || !REPO_RE.test(parts[0] + "/" + parts[1])) return "";
  if (parts.some((x) => x === "." || x === "..")) return "";
  return s;
}

/** Allowed roots for this code. */
export function fileRoots(env, code) {
  let list = null;
  if (env.ACCESS_CODE && code === env.ACCESS_CODE) list = parseJson(env.OWNER_FILES, "array");
  else {
    const v = (parseJson(env.ACCESS_CODES) || {})[code];
    list = v && typeof v === "object" && Array.isArray(v.files) ? v.files : null;
  }
  return (list || []).map(normRoot).filter(Boolean);
}

/** Path checks that don't depend on the allow-list. -> "" ok, else an error code. */
export function badPath(repo, path) {
  if (!REPO_RE.test(repo || "")) return "bad_repo";
  const p = String(path || "");
  if (!PATH_RE.test(p) || p.startsWith("/") || p.includes("//")) return "bad_path";
  const segs = p.split("/").filter(Boolean);
  if (segs.some((s) => s === "." || s === ".." || s.toLowerCase() === ".github")) return "bad_path";
  return "";
}

/** Is repo/path inside a root? Directories (dir=true) are also allowed when they lead to a root. */
export function allowed(roots, repo, path, dir) {
  const p = String(path || "").replace(/\/+$/, "");
  const full = p ? repo + "/" + p : repo;
  const asDir = full + "/";
  return roots.some((r) => (dir ? asDir.startsWith(r) || r.startsWith(asDir) : full.startsWith(r)));
}

function decodeB64Utf8(b64) {
  const bin = atob(String(b64 || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * -> {status, body}. Caller has already checked origin, rate limit and the access code.
 * rootsOverride (TODO #51): the person's "files" from the config branch; null = OWNER_FILES / ACCESS_CODES as before.
 */
export async function fileRequest(env, code, body, rootsOverride) {
  const maxBytes = parseInt(env.FILE_MAX_BYTES || "30720", 10);
  if (!env.FILE_READ_TOKEN) return { status: 200, body: { error: "file_disabled" } };
  const roots = Array.isArray(rootsOverride) ? rootsOverride.map(normRoot).filter(Boolean) : fileRoots(env, code);
  const op = body && body.op;
  if (op === "roots") return { status: 200, body: { roots, maxBytes } };
  if (op !== "get") return { status: 400, body: { error: "bad_op" } };
  if (!roots.length) return { status: 403, body: { error: "no_file_access" } };

  const repo = String(body.repo || "");
  const path = String(body.path || "").replace(/\/+$/, "");
  const bad = badPath(repo, path);
  if (bad) return { status: 400, body: { error: bad } };
  const ref = body.ref ? String(body.ref) : "";
  if (ref && !REF_RE.test(ref)) return { status: 400, body: { error: "bad_ref" } };
  // A directory may be listed if it is inside a root or leads to one; a file must be inside a root.
  if (!allowed(roots, repo, path, true)) return { status: 403, body: { error: "path_not_allowed" } };

  const url = "https://api.github.com/repos/" + repo + "/contents/" + path.split("/").filter(Boolean).map(encodeURIComponent).join("/") +
    (ref ? "?ref=" + encodeURIComponent(ref) : "");
  let r;
  try {
    r = await fetch(url, {
      headers: {
        Authorization: "Bearer " + env.FILE_READ_TOKEN,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agent-webchat-insert-file",
      },
    });
  } catch (e) {
    return { status: 502, body: { error: "github_unreachable" } };
  }
  if (r.status === 404) return { status: 404, body: { error: "not_found" } };
  if (!r.ok) return { status: 502, body: { error: "github_read_" + r.status } };
  const j = await r.json();

  if (Array.isArray(j)) {
    const entries = j
      .filter((e) => e && (e.type === "dir" || (e.type === "file" && FILE_EXT_RE.test(e.name))))
      .filter((e) => e.name.toLowerCase() !== ".github")
      .filter((e) => allowed(roots, repo, e.path, e.type === "dir"))
      .map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size }))
      .sort((a, b) => (a.type === b.type ? (a.name < b.name ? -1 : 1) : a.type === "dir" ? -1 : 1))
      .slice(0, 300);
    return { status: 200, body: { type: "dir", repo, path, entries } };
  }
  if (!j || j.type !== "file") return { status: 400, body: { error: "not_a_file" } };
  if (!allowed(roots, repo, path, false)) return { status: 403, body: { error: "path_not_allowed" } };
  if (!FILE_EXT_RE.test(j.name || path)) return { status: 415, body: { error: "not_text", hint: ".md, .markdown or .txt only" } };
  if (j.size > maxBytes) return { status: 413, body: { error: "file_too_large", size: j.size, maxBytes } };
  const text = j.encoding === "base64" ? decodeB64Utf8(j.content) : String(j.content || "");
  const sha = String(j.sha || "");
  return {
    status: 200,
    body: { type: "file", repo, path, ref: ref || null, sha, size: j.size, text, header: "[file: " + repo + "/" + path + "@" + sha.slice(0, 7) + "]" },
  };
}
