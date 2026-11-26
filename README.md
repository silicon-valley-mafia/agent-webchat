# agent-webchat

A web chat page for the Copilot Studio agent `nauto22_githubagent_Zlk0_w`, hosted on GitHub Pages. It connects to the agent over **Direct Line** (no Microsoft sign-in), behind an access code, and can save every conversation to the private repo `silicon-valley-mafia/agent-webchat-logs`.

```
Browser (GitHub Pages: web/)
  │ 1. POST /token  (header X-Access-Code)
  ▼
Cloudflare Worker (worker/)      ← holds DIRECTLINE_SECRET + GITHUB_LOG_TOKEN, never sent to the browser
  │ 2. POST {DIRECTLINE_DOMAIN}/v3/directline/tokens/generate  (Authorization: Bearer <secret>)
  ▼
  3. returns a single-conversation token
Browser ── 4. Bot Framework Web Chat talks to Direct Line with that token ──▶ agent
Browser ── 5. POST /log {conversationId}, 4 s after each message ──▶ Worker
           Worker reads the conversation from Direct Line itself and writes
           logs/YYYY-MM-DD/HHMM-<conversationId>.md (IST) to the private log repo
```

The Worker answers `/token` and `/log` only when all of these pass:
1. **The request comes from an allowed origin** (`ALLOWED_ORIGINS`; plain curl requests are rejected).
2. **The access code matches** `ACCESS_CODE`. The comparison is constant-time.
3. **The per-IP rate limit isn't exceeded**: `/token` 10/min, `/log` 30/min. Wrong guesses on either endpoint count against the `/token` limit.

> ⚠️ **Security:** the agent runs with **No authentication**, so anyone who gets the
> access code can use the agent, including its GitHub write tools. Keep the code
> private and rotate it if it leaks. Keep **Require secured access** ON in Copilot Studio,
> otherwise anyone who knows the agent ID can bypass this page (and the access code) entirely.

## Page features
- Access code typed once, remembered in the browser (**Forget code** removes it).
- **New chat** starts a fresh conversation; the previous one is closed and its transcript flushed.
- File uploads (multiple files) through the paperclip button.
- Transcript status in the header: `Saving…` / `Saved ✓` / `Not saved` (blank if logging is off).

## Transcript logging (optional)
- Transcripts are **read server-side from Direct Line** (with the secret), so the log contains exactly what the agent saw and said. They are not copied from the browser.
- Each conversation is one Markdown file, updated in place as the chat goes on. Unchanged transcripts are not re-committed.
- Uploaded files are recorded by name, type and Direct Line URL (those URLs expire); the file bytes are not stored.
- Typing indicators and the start event are omitted. Adaptive cards are kept as JSON.

To enable it:
1. Create a **fine-grained personal access token** (GitHub → Settings → Developer settings → Fine-grained tokens):
   - Repository access: **Only select repositories → `agent-webchat-logs`**
   - Permissions: **Contents → Read and write** (Metadata read-only is added automatically)
2. Add it to this repo as the Actions secret **`GITHUB_LOG_TOKEN`**.
3. Run **Token Worker - test and deploy** (Actions → Run workflow). `/health` then shows `"logging":true`.

## One-time setup

### 1. Copilot Studio (agent side)
1. **Settings → Security → Authentication → No authentication**, then **Publish**.
   (With "Authenticate with Microsoft" the agent replies "You don't have access to talk to this bot".)
2. **Settings → Security → Web channel security**: copy **Secret 1**, and turn **Require secured access** ON (takes up to 2 hours).
3. If the agent is in a regional environment and token generation returns 403,
   set `DIRECTLINE_DOMAIN` in `worker/wrangler.toml` to the regional host.

### 2. Token Worker (Cloudflare free plan)
Add the repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers"), `CLOUDFLARE_ACCOUNT_ID`,
`DIRECTLINE_SECRET`, `ACCESS_CODE` (and optionally `GITHUB_LOG_TOKEN`), then run **Token Worker - test and deploy**.
Check `https://agent-webchat-token.deepeshj-2k6.workers.dev/health`.

### 3. GitHub Pages
**Settings → Pages → Source: GitHub Actions**. The token endpoint is set in `web/config.js`.
The site is `https://silicon-valley-mafia.github.io/agent-webchat/`.

> Use **Run workflow** (not *Re-run* on an old run): re-running an old run redeploys that old commit.

## Tests
```bash
cd worker && node --test test/token.test.js test/log.test.js   # 28 tests, no network needed
```

## Files
| Path | Purpose |
|---|---|
| `web/index.html` | Access-code gate, Bot Framework Web Chat, transcript auto-save |
| `web/config.js` | Public configuration (token endpoint URL), no secrets |
| `worker/src/index.js` | Token broker + transcript logger |
| `worker/test/*.test.js` | Origin, access code, rate limits, logging, conflicts, path-injection, secret non-leakage |
| `.github/workflows/pages.yml` | Deploys `web/` to Pages |
| `.github/workflows/worker.yml` | Tests the Worker and deploys it (and the log token, if set) |
