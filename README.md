# agent-webchat

A web chat page for the Copilot Studio agent `nauto22_githubagent_Zlk0_w`, hosted on GitHub Pages. It connects to the agent over **Direct Line**, so users don't need Microsoft sign-in.

```
Browser (GitHub Pages: web/)
  │ 1. POST /token  (header X-Access-Code)
  ▼
Cloudflare Worker (worker/)      ← holds DIRECTLINE_SECRET, never sent to the browser
  │ 2. POST {DIRECTLINE_DOMAIN}/v3/directline/tokens/generate  (Bearer secret)
  ▼
  3. returns a single-conversation token
Browser ── 4. Bot Framework Web Chat talks to Direct Line with that token ──▶ agent
```

The Worker hands out a token only when all of these pass:
1. **The request comes from an allowed origin** (`ALLOWED_ORIGINS`; plain curl requests are rejected).
2. **The access code matches** `ACCESS_CODE`. The comparison is constant-time.
3. **The per-IP rate limit isn't exceeded** (`RATE_LIMIT_PER_MIN`, default 10). Wrong guesses count toward the limit too.

> ⚠️ **Security:** the agent runs with **No authentication**, so anyone who gets the
> access code can use the agent, including its GitHub write tools. Keep the code
> private, rotate it if it leaks (`wrangler secret put ACCESS_CODE`), and consider a
> read-only copy of the agent for this page.
> The rate limiter is best-effort, per Worker isolate. For a hard limit, add a
> Cloudflare rate-limiting rule.

## One-time setup

### 1. Copilot Studio (agent side)
1. **Channels:** make sure a **Mobile app / Native app (Direct Line)** channel is listed.
   If you only see Demo website / Web app / Teams, the agent type doesn't expose
   Direct Line and this setup won't work with it.
2. **Settings → Security → Authentication → No authentication**, then **Publish**.
3. **Settings → Security → Web channel security**:
   - Copy **Secret 1**.
   - Turn on **Require secured access**. This can take up to 2 hours to apply.
4. If the agent is in a regional environment and token generation returns 403,
   set `DIRECTLINE_DOMAIN` in `worker/wrangler.toml` to the regional host.

### 2. Token Worker (Cloudflare, free plan works)
Option A, manual:
```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put DIRECTLINE_SECRET   # paste Secret 1
npx wrangler secret put ACCESS_CODE         # choose a long passphrase
npx wrangler deploy                         # prints https://agent-webchat-token.<you>.workers.dev
```
Option B, through GitHub Actions: add the repo secrets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `DIRECTLINE_SECRET` and `ACCESS_CODE`, then re-run **Token Worker - test and deploy**.

Check that it's up: `https://<worker>/health` should return `{"ok":true,"configured":true}`.

### 3. GitHub Pages
1. **Settings → Pages → Build and deployment → Source: GitHub Actions** (one-time step).
2. **Settings → Secrets and variables → Actions → Variables**: add
   `TOKEN_ENDPOINT` = `https://agent-webchat-token.<you>.workers.dev/token`.
3. Re-run **Deploy web chat to GitHub Pages**. The site is
   `https://silicon-valley-mafia.github.io/agent-webchat/`.

If the site is served from another origin (a custom domain, for example), add it to `ALLOWED_ORIGINS`.

## Tests
```bash
cd worker && node --test test/token.test.js   # 13 tests, no network needed
```

## Files
| Path | Purpose |
|---|---|
| `web/index.html` | Access-code gate and Bot Framework Web Chat |
| `web/config.js` | Public configuration (token endpoint URL), no secrets |
| `worker/src/index.js` | Token broker |
| `worker/test/token.test.js` | Tests for origin, access code, rate limit, error paths and secret non-leakage |
| `.github/workflows/pages.yml` | Deploys `web/` to Pages |
| `.github/workflows/worker.yml` | Tests the Worker, and deploys it if the Cloudflare secrets exist |
