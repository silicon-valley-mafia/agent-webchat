# agent-webchat

A web chat for the Copilot Studio GitHub agent, hosted on GitHub Pages at
**https://silicon-valley-mafia.github.io/agent-webchat/**. It talks to the agent over **Direct Line** (no Microsoft sign-in), sits behind
per-person access codes, and saves every conversation to the private repo `silicon-valley-mafia/agent-webchat-logs`.

```
Browser (GitHub Pages: web/)  ──POST /token, /resume, /log, /export, /history, /transcript──▶  Cloudflare Worker (worker/)
                                                                     holds DIRECTLINE_SECRET, ACCESS_CODE(S), LOG_REPO_TOKEN
Browser ── Bot Framework Web Chat ⇄ Direct Line (single-conversation token) ⇄ agent
Worker  ── reads conversations from Direct Line, CREATES files (never edits) ──▶ private log repo
Browser ──POST /artifact, /artifact/put (attachments)──▶ Worker ── streams ──▶ agent-webchat-artifcats-1
```

### Log layout (one folder per day, one folder per session, write-only)
```
logs/
  2026-11-27/                                   ← one folder per day (IST)
    0140-deepesh--<conversationId>/             ← one folder per session: start time, person, conversation
      0000-session.md                           ← person, conversation ID, user ID, start time
      0001-014005-user.md                       ← one file per message: index, time, sender
      0002-014009-agent.md
      ...
    0905-ravi--<conversationId>/
```
- Files are only ever **created**. The logger never reads back, edits or deletes a log file (only History/View read). A create for a path that already exists is refused by GitHub (422) and skipped, so nothing is overwritten.
- The page remembers how many messages are already written (`since`), so each save only creates the new ones.
- One save writes at most 40 files (Cloudflare free plan: 50 sub-requests per request). Longer backlogs are written over several saves; the page continues automatically.

## Features
| Feature | How it works |
|---|---|
| **Access codes, per person** | `ACCESS_CODE` = owner (admin, named `OWNER_NAME`). `ACCESS_CODES` adds more people. The code is typed once and remembered in the browser. **Forget code** removes it. |
| **Continue after refresh** | Reopening the page re-attaches to your last conversation (if it's under 24 h old) through `/resume`. The Worker calls Direct Line *reconnect* with the secret. The chat polls once, so the earlier messages replay. If Microsoft has already expired the conversation, a new chat starts and the old one stays in History. |
| **History** | Lists saved sessions (folders), newest first, with message counts. Admins see everyone; other people see only their own. **View** joins the session's files into one transcript (a single GraphQL read), **Continue** re-attaches to that conversation, and **⬇** downloads it as one Markdown file. |
| **Download** | **⬇ Download** saves the current chat as Markdown. The Worker renders it from Direct Line, so this works even with logging off. |
| **Transcript logging** | 4 s after each message (and on New chat or tab hide), the Worker re-reads the conversation from Direct Line and creates one file per new message in the session's folder (see *Log layout*). Parallel-write conflicts (409) are retried. |
| **Attachments** | Paperclip, **paste** (Ctrl+V an image or copied file) and **drag & drop** anywhere on the page. Each file is adapted to the agent's limits and the original is committed to `agent-webchat-artifcats-1`. See *Attachments* below. |
| **Dark mode** | 🌓 button cycles auto → light → dark (saved per browser). Switching re-attaches the open chat in the new theme. |
| **Avatars & colours** | `accentColor`, `botAvatarInitials`, `botAvatarImage`, `userAvatarImage` in `web/config.js`. User initials default to the person's name. |
| **Voice input** | Microphone button where the browser supports speech recognition (Chrome, Edge). Set `voice: false` to hide it. |
| **Notifications** | 🔔 button. When the agent replies while the tab is in the background, you get a desktop notification and the tab title shows an unread count. |

## Attachments
Every file you attach (paperclip, paste, drag & drop) goes two ways:

1. **To the agent, adapted to its limits.** One message can carry at most **4 MB** over Direct Line (the channel's upload cap; this is why a 10 MB file failed before). The page keeps every message under `agentMaxFileMB` (3.8 MB):

   | File | What the agent receives |
   |---|---|
   | Supported type (`agentFileTypes`: docx, csv, pdf, txt, jpg, jpeg, png, webp, gif) and ≤ 3.8 MB | the file as-is |
   | Other type, or too large but compresses to ≤ 3.8 MB | `name.zip` |
   | Still too large | `name.part01of03.zip`, `name.part02of03.zip`, … one per message. Each is an ordinary zip holding one raw slice: unzip all, then join the slices in order |
   | Would need more than `agentMaxParts` (10) messages | not sent in chat; the agent gets the GitHub path instead |

   A note is added to your message telling the agent what was changed and where the original is.
2. **To GitHub, untouched.** The original is committed to **`silicon-valley-mafia/agent-webchat-artifcats-1`** (create-only, like the logs):
   ```
   webchat-uploads/2026-11-27/deepesh--<conversationId>/030700-ab12/
     report.pdf                     ← whole file, if ≤ 70 MiB
     video.mp4.part01of03 …         ← raw 70 MiB parts, if larger
     MANIFEST.md                    ← uploader, sizes, SHA-256 of file and each part, join commands
   ```
   Rejoin: `cat video.mp4.part01of03 video.mp4.part02of03 video.mp4.part03of03 > video.mp4` (Windows: `copy /b a.part01of03+a.part02of03+a.part03of03 a`).

**Limits behind these numbers**
| Limit | Value | Effect here |
|---|---|---|
| Direct Line upload, per message | 4 MB | agent copy split into ≤ 3.8 MB messages |
| Copilot Studio file input | 15 MB per file; types DOCX, CSV, PDF, TXT, JPG, PNG, WebP, non-animated GIF; 30,000 characters per file without code interpreter; PDFs up to 40 pages | other types are zipped (whether the agent can open a zip depends on the agent; the GitHub copy always works) |
| Cloudflare request body (Free plan) | 100 MB | GitHub parts are 70 MiB, because base64 makes a 70 MiB part ~93 MiB on the wire. This is stricter than GitHub's own rule, so anything over 70 MiB (not only over 95 MB) is split |
| GitHub file size | 100 MB per file | never reached (parts are 70 MiB) |
| Worker `ARTIFACT_MAX_BYTES` | 1 GiB per attachment | larger files are not saved (a notice says so) |
| Browser | the whole file is read into memory once per part | very large files (> ~1 GB) can be slow |

The Worker never decodes file bytes (the Free plan allows 10 ms CPU per request). It checks the access code, chooses the path itself (person from the code, folder from a server-issued upload ID), and streams the browser's request straight to GitHub.

## Access codes and secrets: exact formats
| Secret (repo → Settings → Secrets and variables → Actions) | Required | Format | Example |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | Cloudflare API token, template **Edit Cloudflare Workers** | `AbCd…` (40 chars) |
| `CLOUDFLARE_ACCOUNT_ID` | yes | 32 hex chars from the Cloudflare dashboard | `0123456789abcdef0123456789abcdef` |
| `DIRECTLINE_SECRET` | yes | Copilot Studio → Settings → Security → Web channel security → Secret 1 (paste as-is) | long base64-like string |
| `ACCESS_CODE` | yes | any text, one line, no surrounding spaces. This is the **owner/admin** code (name = `OWNER_NAME` in `wrangler.toml`) | `river-mango-7421-kite` |
| `ACCESS_CODES` | no | **JSON object**: code → name, or code → `{"name": "...", "admin": true}` | see below |
| `LOG_REPO_TOKEN` | no | fine-grained PAT, `github_pat_…`, repositories **agent-webchat-logs and agent-webchat-artifcats-1**, permission **Contents: Read and write** | `github_pat_11ABC…` |
| `ARTIFACT_REPO_TOKEN` | no | only if agent-webchat-artifcats-1 should use a different PAT than `LOG_REPO_TOKEN` (same format, Contents: Read and write on agent-webchat-artifcats-1) | `github_pat_11XYZ…` |

Rules for codes:
- Use 16+ characters; letters, digits and `-` are safest (they are typed into a password box and sent in an HTTP header, so **no line breaks**; avoid non-ASCII).
- Every code must be different. Two people with the same code would be recorded as the first one.
- Secret names can't start with `GITHUB_` (GitHub rejects them).

### Adding people
Add a repo secret **`ACCESS_CODES`** containing a JSON object, then run **Token Worker - test and deploy**:
```json
{ "mango-river-7421": "Ravi", "blue-kite-0815": { "name": "Asha", "admin": true } }
```
- Keys are the codes, values are the names. Use straight double quotes, no trailing comma.
- `admin: true` lets that person see everyone's history; others see only their own.
- The workflow validates the JSON before uploading it and fails with a clear message if it's malformed.
- Each person's name goes into the Direct Line user, the transcript header, the log folder and the upload folder.
- To remove someone, delete their entry and re-run the workflow.

## Security
- Every POST endpoint needs an allowed `Origin`, a valid access code, and stays under a per-IP rate limit:
  - `/token` and `/resume`: 10/min
  - all other endpoints: 60/min
  - wrong codes on any endpoint count against the 10/min limit
- Codes are compared in constant time across *all* configured codes.
- Transcript paths are validated against a strict pattern, so there is no path traversal. Non-admins can't read other people's logs.
- ⚠️ The agent runs with **No authentication**: whoever holds a code can use the agent's GitHub write tools.
- Keep **Require secured access** ON in Copilot Studio (Settings → Security → Web channel security). Otherwise anyone who knows the agent ID can skip this page entirely.

## Setup
1. **Copilot Studio:** set **Authentication: No authentication** and Publish. Under **Web channel security**, copy Secret 1 and turn **Require secured access** ON.
2. **Repo secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
   - `CLOUDFLARE_ACCOUNT_ID`
   - `DIRECTLINE_SECRET`
   - `ACCESS_CODE`
   - optional: `ACCESS_CODES`
   - optional: `LOG_REPO_TOKEN`, a fine-grained PAT with `agent-webchat-logs` and `agent-webchat-artifcats-1` selected and **Contents: Read and write**
3. **Actions → Token Worker - test and deploy → Run workflow.** Then check
   `https://agent-webchat-token.deepeshj-2k6.workers.dev/health`, which should show `{"ok":true,"configured":true,"logging":true,"artifacts":true,"people":N}`.
4. **Settings → Pages → Source: GitHub Actions.** The token endpoint is set in `web/config.js`.

> Use **Run workflow**, not *Re-run* on an old run. Re-running an old run redeploys that old commit.

## Tests
```bash
cd worker && node --test test/*.test.js   # 82 tests, no network (files.test.js covers web/files.js)
```

## Files
| Path | Purpose |
|---|---|
| `web/index.html`, `web/app.css`, `web/app.js` | Page shell, styles (light and dark), client logic |
| `web/files.js` | Attachments: type/size rules, ZIP writer (stored/deflate), splitting, upload to the Worker |
| `web/config.js` | Public settings: endpoint, look, features. No secrets |
| `worker/src/index.js` | Token broker, resume, logging, export, history, transcripts, per-person codes |
| `worker/test/*.test.js` | 82 tests: auth, rate limits, write-only logging, chunking, conflicts, history ACL, path validation, resume, secret non-leakage, attachment paths/streaming/manifests, ZIP round-trips |
| `.github/workflows/pages.yml` | Deploys `web/` to Pages |
| `.github/workflows/worker.yml` | Tests and deploys the Worker, plus the optional secrets when present |
| `docs/TODO.md` | Future work: stream replies from the log, GitHub PR pop-up support, "show thinking", steer/interrupt test, remove the 1 GiB attachment cap |
