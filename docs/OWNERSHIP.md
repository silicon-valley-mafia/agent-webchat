# Conversation ownership check (TODO #49)

Who may reopen a conversation. Without this, anyone with a valid access code who knows (or guesses) a conversation
id could reconnect to it (`/resume`), download it (`/export`) or copy it into their own log folder (`/log`).
It matters because SPARK can ask CONDUCTOR to write to GitHub: a chat with either agent is a write path.

## Rule

| Who | `/resume`, `/export`, `/log` for a conversation |
|---|---|
| The access code that started it (`/token`) | ✅ |
| Owner code (`ACCESS_CODE`) and codes with `"admin": true` | ✅ every conversation |
| Any other code | ❌ `403 forbidden` ("That transcript belongs to someone else.") |
| Conversations started **before** the check was turned on (no record) | admins only |

`/history` and `/transcript` were already limited to your own sessions (by person) and are unchanged.
The agent picker limits (`ACCESS_CODES` `"agents"`, [AGENTS.md](AGENTS.md)) still decide which agents a code may open.

## How it works

- `/token` writes `owners/<conversation>.json` in the logs repo (create-only, like the transcripts):
  `{"owner": "<owner id>", "agent": "<agent id>", "created": "<time>"}`.
- **Owner id** = HMAC-SHA-256 of the access code with the Worker secret `OWNER_PEPPER` (first 16 bytes, hex).
  The access code itself is never stored. Changing `OWNER_PEPPER` makes existing records unmatchable (= admin-only).
- Records are cached in the Worker's memory, so most checks need no GitHub call; a cold check reads one small file.
- If GitHub can't be read, non-admins get `503 owner_check_unavailable` (fail closed). If the record can't be
  written at `/token`, the chat still starts (`ownerRecorded: false`) but only admins can reopen it later.

## Turn it on

1. Repo secret **`OWNER_PEPPER`**: a random string of at least 32 characters (e.g. `openssl rand -hex 32`).
2. Run **"Token Worker - test and deploy"**. The status step prints `Ownership check: ON`.
3. Needs transcript logging (`LOG_REPO_TOKEN`); without it the check stays off.

**Off switch:** Worker variable `OWNERSHIP_CHECK = "off"`, or delete `OWNER_PEPPER`.

Code: `worker/src/owners.js`, hooks in `worker/src/index.js`. Tests: `worker/test/owners.test.js`.
