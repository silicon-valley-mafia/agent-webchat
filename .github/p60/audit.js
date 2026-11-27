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

