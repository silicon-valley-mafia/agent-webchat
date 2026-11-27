# Per-person settings in a private config repo (TODO #51)

Who may open which agent, which folders the 📄 File button shows, and a **session header** (your standing rules for
the agents) live in one private file you can edit on GitHub. No redeploy is needed; the Worker picks up changes within
about **60 seconds**.

| | |
|---|---|
| Repo / branch | **`agent-webchat-config`** (private), branch `main` (moved there from `agent-webchat-logs@config` on 2026-11-28) |
| File | `config/people.json` |
| Read by | the token Worker, with the repo secret **`AGENT_SYSTEM_PAT`** (the agent system's PAT; the Worker only sends GET requests with it and never writes to this repo). Fallbacks: `CONFIG_TOKEN`, then `LOG_REPO_TOKEN`. |
| Who may edit | only the owner (anyone who can push to this repo can change these rules) |
| Set in | `worker/wrangler.toml`: `CONFIG_REPO`, `CONFIG_BRANCH` (optional `CONFIG_PATH`, `CONFIG_TTL_SEC`) |

The same `AGENT_SYSTEM_PAT` also reads the 📄 File folders when `FILE_READ_TOKEN` is not set, always inside the
`files` allow-list below. It is a broad token, so keep the Worker's other secrets just as private.

## The file

```json
{
  "header": { "text": "Rules for everyone (optional)", "every": 0 },
  "people": {
    "deepesh": {
      "agents": ["*"],
      "defaultAgent": "spark",
      "role": "owner",
      "files": ["owner/repo/folder/", "owner/other-repo/"],
      "header": { "text": "My standing rules for every agent", "every": 10 }
    },
    "ravi": { "agents": ["github"], "role": "user", "files": [], "header": null }
  }
}
```

- **Key = the person's name as a slug**: lower case, other characters become `-` (the same name as their log
  folders, e.g. `deepesh`). The owner code's name is `OWNER_NAME` in `wrangler.toml`.
- **`agents`**: agent ids this person may open (`["*"]` = all). Codes with `"admin": true` (and the owner code) always
  get every agent. **`defaultAgent`**: the agent a new chat starts with.
- **`role`**: label sent to the agent at chat start (#7). Advisory; `owner`/`admin` only count for admin codes.
- **`files`**: the folders the 📄 File button may read (#37a). This replaces the `OWNER_FILES` secret and the
  `"files"` key in `ACCESS_CODES`. The button reads them with `FILE_READ_TOKEN` or, without it, `AGENT_SYSTEM_PAT`.
- **`header`**: text put on top of your **first message** in a chat and then **every N-th message** (`every: 10` =
  messages 1, 11, 21, ...; `every: 0` = first message only). `null` = no header, even if a default `header` exists.
  The agent sees it as part of your message, so it works with every agent without a Copilot Studio change, and it
  shows in your bubble and in the transcript:

  ```
  [session header]
  <text>
  [end of header]

  <your message>
  ```

A key you set here wins over the same key in `ACCESS_CODES`; a key you leave out falls back to `ACCESS_CODES`.

## What stays secret (never in this file)

Access codes and which code belongs to which person, the `admin` flag, Direct Line secrets, all tokens, and
`OWNER_PEPPER`. Someone who reads this file still can't get in.

## When GitHub can't be read

- No file, no branch, or a token without access to the repo (GitHub answers 404): treated as an empty config, so the
  secrets apply as before.
- GitHub down, or the file is not valid JSON: the Worker keeps using the last good copy. If it never had one, codes
  without `"admin": true` get `503 config_unavailable` (fail closed), and the owner/admin codes still work.

## Off switches

- Worker: `CONFIG_BRANCH = "off"` (or remove it) in `worker/wrangler.toml` makes everything come from the secrets.
- 📄 File: `insertFile: false` in `web/config.js`, or remove both `FILE_READ_TOKEN` and `AGENT_SYSTEM_PAT`.
- Page: `sessionHeader: false` in `web/config.js` stops the header from being added.

Code: `worker/src/config.js`, hooks in `worker/src/main.js`, `web/header.js`. Tests: `worker/test/config.test.js`.
