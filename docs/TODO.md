# Future work (noted 2026-11-27, not started)

| # | Type | Item | Notes / starting points |
|---|---|---|---|
| 1 | Idea / fallback | **Stream the agent's reply from the log into the chat window** | Alternative path if Direct Line streaming hits limits: the Worker already writes every message to `agent-webchat-logs` (create-only, one file per message). The page could poll `/history` + `/transcript` (or a new "since N" endpoint) and render new message files as they land. Explore only if the live Direct Line path proves limiting. |
| 2 | To do | **GitHub PR pop-up from the agent** | In the Copilot / Copilot Studio UI the agent shows a pop-up (form) to create a GitHub pull request. Find out how it is delivered (Adaptive Card? MCP app UI / `ui://` resource? `invoke` activity?) and whether Web Chat over Direct Line receives it. Probably needs a renderer / attachment middleware in `web/app.js`. |
| 3 | Idea | **"Show thinking" option** | Check whether Copilot Studio emits reasoning / plan / tool-call activities over Direct Line (e.g. `typing` with text, `event` activities, `channelData` streaming info). If yes, add a toggle that shows them collapsed under each reply. |
| 4 | Test | **Steer / pause / interrupt a response** | Test whether sending a new message mid-response, or a custom `event` activity, stops or redirects the agent over Direct Line. Document what works; add a Stop button only if supported. |
| 5 | To do | **Remove the 1 GiB hard cap on saved attachments** | `ARTIFACT_MAX_BYTES` (default 1 GiB in `worker/src/artifacts.js` and `worker/wrangler.toml`) plus `MAX_PARTS = 100` (100 × 70 MiB ≈ 6.8 GiB). Remove/raise both; also the browser reads each part into memory and hashes the whole file only up to 256 MiB, so very large files need a streaming hash. |
| 6 | Pending (owner) | **Deploy + browser test of PR #3/#4** | Paste screenshot, drop >10 MB file, drop `.v` file, paperclip PDF; check `/health` (`logging`, `artifacts`), `agent-webchat-logs/logs/`, `agent-webchat-artifcats-1/webchat-uploads/`. Not yet done. |
| 7 | Idea | **Per-user custom rules (users are separated by access code)** | Extend `ACCESS_CODES` entries, e.g. `{"code": {"name": "Ravi", "rules": {...}}}`. Possible rules: allowed features (uploads on/off, history, download), max attachment size, which repo attachments go to, rate limit, expiry date of the code, read-only (no agent GitHub write tools — would need the agent to receive the person/role, e.g. via the Direct Line user name or a `startConversation` event value, and topics/instructions that honour it). Worker enforces what it can (uploads, history, limits); agent-side rules need Copilot Studio support. |
| 8 | Question → document | **Where does file processing happen?** | Current answer (as built, PR #3): see below. Confirm in browser DevTools during the first live test and keep this section up to date. |
| 9 | Idea | **Relay workflow: a relay Worker / page** | Owner's idea (2026-11-27), scope to be defined. Possible readings to clarify first: (a) a relay Worker/page that forwards messages between this web chat and other agents/chats (bridge, so other sessions can drive the agent); (b) a relay that sits between the page and Direct Line so all traffic passes through the Worker (enables server-side logging, per-user rules #7, "show thinking" #3, interrupt #4, and hides the Direct Line token from the browser); (c) a GitHub Actions–based relay (e.g. `repository_dispatch` jobs) for long-running work. Watch Cloudflare Free limits: 10 ms CPU, 50 subrequests, 100k requests/day; WebSockets/Durable Objects for (b). |

## Where file processing happens (as built)

| Step | Where it runs |
|---|---|
| Reading the pasted / dropped / picked file | **Your browser** (`web/files.js`, `web/app.js`) |
| Deciding as-is / zip / zip parts for the agent, building the ZIPs (CRC32, deflate via the browser's `CompressionStream`), splitting into ≤ 3.8 MB pieces | **Your browser** |
| SHA-256 of the file and each part, base64-encoding each 70 MiB part for GitHub | **Your browser** (Web Crypto, `FileReader`) |
| Sending the agent copy | Browser → **Microsoft Direct Line** (Bot Framework service) → the Copilot Studio agent, which reads the file on Microsoft's side |
| Saving the original | Browser → **Cloudflare Worker** (only checks the access code, picks the path and **streams the bytes straight through** — it does not unpack, hash or decode them) → **GitHub REST API**, which stores the file in `agent-webchat-artifcats-1` |
| Writing `MANIFEST.md` | Cloudflare Worker (small text, from the hashes the browser computed) |
| GitHub Actions | **Not involved** in file processing — Actions only runs tests and deploys the Worker and the Pages site |
| GitHub Pages | Only serves the static page files; it never sees your attachments |
