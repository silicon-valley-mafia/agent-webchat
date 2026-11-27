/**
 * TODO #57 "💾 Save" button: the whole conversation so far as ONE Markdown file in the logs repo.
 *
 *   POST /save {conversationId}  (main.js; same X-Access-Code / X-Agent / ownership rules as /export)
 *     -> builds exactly what ⬇ Download gives you (/export) and writes it to
 *          <SAVE_DIR>/<the Download file name>        e.g. saved/2_2026-11-27_1700-deepesh--Conv-9-in.md
 *        in LOG_REPO (LOG_BRANCH). Clicking again later OVERWRITES that file with the whole conversation up to then
 *        (one file per conversation, its git history keeps every earlier save).
 *     <- {saved:true, path, repo, branch, url, status:"created"|"updated"|"unchanged", commit, messages}
 *
 * This is the one place the Worker updates a file instead of create-only: the per-message logs under logs/ are
 * untouched (still create-only). Parallel saves of the same conversation (two tabs, double click) never fail: a 409 /
 * 422 from GitHub (file changed under us) re-reads the current sha and writes again, up to SAVE_ATTEMPTS times.
 * Identical content is not committed again ("unchanged").
 * Vars: SAVE_DIR (default "saved"), SAVE_BUTTON = "off" turns /save off. Needs LOG_REPO + LOG_REPO_TOKEN (write).
 */
import { contentsUrl, ghHeaders, b64utf8 } from "./index.js";

export const SAVE_ATTEMPTS = 4;
/** The /export file name: letters, digits, _ . - only, ends in .md (no folders, no ".."). */
export const SAVE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.md$/;
const DIR_RE = /^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,40}){0,3}$/;

export function saveEnabled(env) {
  return !!(env.LOG_REPO && env.LOG_REPO_TOKEN) && String(env.SAVE_BUTTON || "").toLowerCase() !== "off";
}

export function saveDir(env) {
  const d = String(env.SAVE_DIR || "saved").trim().replace(/^\/+|\/+$/g, "");
  return DIR_RE.test(d) && !d.split("/").includes("..") ? d : "saved";
}

/** Repo path for an /export file name, or null when the name isn't safe. */
export function savePath(env, filename) {
  if (typeof filename !== "string" || !SAVE_NAME_RE.test(filename) || filename.includes("..")) return null;
  return saveDir(env) + "/" + filename;
}

/** Message count from the /export header row "| Messages | N (...) |", or null. */
export function messagesOf(markdown) {
  const m = /^\| Messages \| (\d+)/m.exec(String(markdown || ""));
  return m ? Number(m[1]) : null;
}

/**
 * Create or overwrite one file. -> {status: "created"|"updated"|"unchanged", sha, commit} or {error}.
 * Reads the current sha first (404 = new file); a write that loses a race (409 / 422) re-reads and tries again.
 */
export async function overwriteFile(env, path, content, message) {
  const url = contentsUrl(env, path);
  const branch = env.LOG_BRANCH || "main";
  const b64 = b64utf8(content);
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const g = await fetch(url + "?ref=" + encodeURIComponent(branch), { headers: ghHeaders(env) });
    let sha = null;
    if (g.ok) {
      const cur = await g.json().catch(() => ({}));
      sha = cur.sha || null;
      if (typeof cur.content === "string" && cur.content.replace(/\s/g, "") === b64) return { status: "unchanged", sha, commit: "" };
    } else if (g.status !== 404) {
      return { error: "github_read_" + g.status };
    }
    const req = { message, content: b64, branch };
    if (sha) req.sha = sha;
    const p = await fetch(url, { method: "PUT", headers: ghHeaders(env), body: JSON.stringify(req) });
    if (p.ok) {
      const j = await p.json().catch(() => ({}));
      return { status: sha ? "updated" : "created", sha: (j.content && j.content.sha) || "", commit: (j.commit && j.commit.sha) || "" };
    }
    if (p.status !== 409 && p.status !== 422) return { error: "github_write_" + p.status };
  }
  return { error: "github_conflict" };
}

/** Writes an /export result ({markdown, filename}). -> the /save answer body, or {error, status}. */
export async function saveExport(env, exp, person) {
  const path = savePath(env, exp && exp.filename);
  if (!path || typeof exp.markdown !== "string") return { error: "bad_export", status: 502 };
  const slug = (person && person.slug) || "user";
  const r = await overwriteFile(env, path, exp.markdown, "save(" + slug + "): " + exp.filename);
  if (r.error) return { error: r.error, status: 502 };
  const branch = env.LOG_BRANCH || "main";
  return {
    saved: true,
    status: r.status,
    path,
    repo: env.LOG_REPO,
    branch,
    url: "https://github.com/" + env.LOG_REPO + "/blob/" + encodeURIComponent(branch) + "/" + path.split("/").map(encodeURIComponent).join("/"),
    commit: r.commit,
    messages: messagesOf(exp.markdown),
  };
}
