# agent-webchat

A web chat for the Copilot Studio agent `nauto22_githubagent_Zlk0_w`, hosted on GitHub Pages at
**https://silicon-valley-mafia.github.io/agent-webchat/**. It talks to the agent over **Direct Line** (no Microsoft sign-in), sits behind
per-person access codes, and saves every conversation to the private repo `silicon-valley-mafia/agent-webchat-logs`.

```
Browser (GitHub Pages: web/)  ──POST /token, /resume, /log, /export, /history, /transcript──▶  Cloudflare Worker (worker/)
                                                                     holds DIRECTLINE_SECRET, ACCESS_CODE(S), GITHUB_LOG_TOKEN
Browser ── Bot Framework Web Chat ⇄ Direct Line (single-conversation token) ⇄ agent
Worker  ── reads conversations from Direct Line, writes logs/YYYY-MM-DD/HHMM-<person>--<conversation>.md ──▶ private log repo
```

## Features
| Feature | How it works |
|---|---|
| **Access codes, per person** | `ACCESS_CODE` = owner (admin, named `OWNER_NAME`). `ACCESS_CODES` adds more people. The code is typed once and remembered in the browser. **Forget code** removes it. |
| **Continue after refresh** | Reopening the page re-attaches to your last conversation (if it's under 24 h old) through `/resume`. The Worker calls Direct Line *reconnect* with the secret. The chat polls once, so the earlier messages replay. If Microsoft has already expired the conversation, a new chat starts and the old one stays in History. |
| **History** | Lists saved transcripts, newest first. Admins see everyone; other people see only their own. **View** renders the transcript, **Continue** re-attaches to that conversation, and **⬇** downloads it. |
| **Download** | **⬇ Download** saves the current chat as Markdown. The Worker renders it from Direct Line, so this works even with logging off. |
| **Transcript logging** | 4 s after each message (and on New chat or tab hide), the Worker re-reads the conversation from Direct Line and upserts one file per conversation. Unchanged files aren't re-committed; write conflicts are retried. |
| **File uploads** | Paperclip button, multiple files. Logs record name, type and Direct Line URL (these URLs expire), not the file bytes. |
| **Dark mode** | 🌓 button cycles auto → light → dark (saved per browser). Switching re-attaches the open chat in the new theme. |
| **Avatars & colours** | `accentColor`, `botAvatarInitials`, `botAvatarImage`, `userAvatarImage` in `web/config.js`. User initials default to the person's name. |
| **Voice input** | Microphone button where the browser supports speech recognition (Chrome, Edge). Set `voice: false` to hide it. |
| **Notifications** | 🔔 button. When the agent replies while the tab is in the background, you get a desktop notification and the tab title shows an unread count. |

### Adding people
Add a repo secret **`ACCESS_CODES`** containing a JSON object, then run **Token Worker - test and deploy**:
```json
{ "mango-river-7421": "Ravi", "blue-kite-0815": { "name": "Asha", "admin": true } }
```
- The workflow validates the JSON before uploading it and fails with a clear message if it's malformed.
- Each person's name goes into the Direct Line user, the transcript header and the log file name.
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
   - optional: `GITHUB_LOG_TOKEN`, a fine-grained PAT with only `agent-webchat-logs` selected and **Contents: Read and write**
3. **Actions → Token Worker - test and deploy → Run workflow.** Then check
   `https://agent-webchat-token.deepeshj-2k6.workers.dev/health`, which should show `{"ok":true,"configured":true,"logging":true,"people":N}`.
4. **Settings → Pages → Source: GitHub Actions.** The token endpoint is set in `web/config.js`.

> Use **Run workflow**, not *Re-run* on an old run. Re-running an old run redeploys that old commit.

## Tests
```bash
cd worker && node --test test/token.test.js test/log.test.js test/features.test.js   # 51 tests, no network
```

## Files
| Path | Purpose |
|---|---|
| `web/index.html`, `web/app.css`, `web/app.js` | Page shell, styles (light and dark), client logic |
| `web/config.js` | Public settings: endpoint, look, features. No secrets |
| `worker/src/index.js` | Token broker, resume, logging, export, history, transcripts, per-person codes |
| `worker/test/*.test.js` | 51 tests: auth, rate limits, logging, conflicts, history ACL, path validation, resume, secret non-leakage |
| `.github/workflows/pages.yml` | Deploys `web/` to Pages |
| `.github/workflows/worker.yml` | Tests and deploys the Worker, plus the optional secrets when present |
