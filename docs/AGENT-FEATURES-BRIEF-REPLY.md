# Reply to the brief (SPARK, CONDUCTOR webchat features)

_From the GitHub agent (bridge, account silicon-valley-mafia), 2026-11-27 17:45 IST. Brief read in full and renamed to [READ-AGENT-FEATURES-BRIEF.md](READ-AGENT-FEATURES-BRIEF.md) (content unchanged). Per rule 7, **nothing in Batch A has been built yet: this is the plan, waiting for owner approval.**_

## 1. Where the brief and the repo differ (owner to confirm)

| Brief | Actual state (2026-11-27 17:45 IST) | Proposal |
|---|---|---|
| **#44** = conversation ownership check | **#44 is taken**: per-agent log folders, PR #21, on `dev` (`b2de31d`). The brief also uses #45–#48. | Ownership check becomes **#49**. #45–#48 keep the brief's meaning. |
| **#20** agent id in paths, `logs/<agent>/<date>/…` | Logs already go to **numbered** folders `logs/<N>/<date>/<HHMM>-<person>--<conversation>/` (owner's request 16:52 IST); `logs/<N>/AGENT.md` + index `agent-webchat-logs/logs/AGENTS.md`; old flat paths still readable. Upload paths have **no** agent yet. | Keep numbers; register `spark` with `"num": 2`, `conductor` with `"num": 3` in `AGENTS` (never reuse a number; update the index). Remaining work: **upload paths** `webchat-uploads/<N>/…`. |
| **#23** in Batch B | **Built**: PR #22 on `dev` (`d4871fc`) — ☰ Chats sidebar, up to 4 live chats per tab (any agent), switching back re-attaches the same live conversation (no `/resume`, no new chat). Docs: `docs/SESSIONS.md`. | Treat as done; the "SPARK → CONDUCTOR → SPARK" check is the owner test after deploy. Note: the picker still starts a new chat when switching agent; the sidebar is the way to return. |
| Open PRs on `dev`: #18–#20 | #18, #19, #20, #21, #22 are all **merged into `dev`**, not live. | Batch A branches from `dev` `d4871fc`. |
| **#37b** SPARK forwards `awRoute` | Earlier recommendation was page-side routing (no relay credits). | Follow the brief: the page only marks the message; SPARK forwards. |
| Rule 3: `app.js` ~64.7 KB | Now **65,598 B** (~1 KB below the push limit). | First PR of Batch A = **split `app.js`** (move history/session helpers to `web/history.js`, no behaviour change). |

## 2. Batch A plan (one PR each into `dev`, each with an off switch, TODO line updated in the same PR)

| Order | Item | What | Off switch | Test |
|---|---|---|---|---|
| 0 | Split `app.js` | Pure move to `web/history.js`; `app.js` drops to ~55 KB. | — | Existing CI + harness. |
| 1 | **#49** ownership check (Worker) | Owner id = short **HMAC of the access code** (new Worker secret `OWNER_PEPPER`; the code is never stored), written in the session header in the logs repo (create-only, no KV). `/resume`, `/export`, `/transcript` → **403** if it doesn't match; `owner` / `admin:true` codes see all. Old sessions without an owner record: **owner/admin only** (fail closed). | `OWNERSHIP_CHECK=off` | Second code 403, admin 200, old session admin-only. |
| 2 | **#7** role to the agent | `ACCESS_CODES` entry `role`: `owner` / `admin` / `user` / `readOnly` (default `user`; `admin:true` → `admin`). Worker returns a **signed** role with `/token`; page sends it in `startConversation` as `channelData.awRole` + `value.role`. Short check snippet for Copilot Studio in `docs/AGENTS.md`. | `sendRole: false` | Worker tests for each role; page harness checks the event. |
| 3 | **#37a** 📄 Insert file | Worker `/file`: read-only token, allow-list per code (`files: ["owner/repo/prefix/**"]`, default none), text files only, **30 KB** cap with a clear message, rejects `..` / `.github/**`. Page `web/insert.js`: pick path → preview → into the send box with `[file: owner/repo/path@sha]`; log keeps path + sha. | `insertFile: false` | Allowed path 200, other 403, 31 KB rejected. |
| 4 | **#37b** "Pass on to Coach" | `web/route.js`: chip in the composer → `channelData.awRoute = "coach"`; remembered per conversation (survives reload); shown on the bubble; only for agents with `"routes": ["coach"]` in `AGENTS` (SPARK). | `routeToggle: false` | Activity carries `awRoute`; state after reload. |
| 5 | **#20** uploads | `webchat-uploads/<N>/…`; old paths readable. | — | Worker tests. |

**Deploy:** one promotion `dev` → `main` for the whole batch (Pages + Worker once), after the owner says "deploy now". Until #49 is live, keep SPARK and CONDUCTOR on the owner's code only (brief §3).

## 3. Batch B / C notes

- **#45** starters, **#48** file return check, **#20** History filter: ready to plan after Batch A; #48 needs a real SPARK chat that returns a file.
- **#38** design notes are in the private note `agent-webchat-logs/handoff/notes/2026-11-27-considerations-37-38.md` (visible chip, once by default, per-agent presets, ~4 KB cap, new `web/pin.js`).
- **#41**: noted that MCS-4041 also appears on fresh chats and after redeploys — a retry is not a fix; stays design-first.
- **#32**: research is running in parallel (4 agents, 2 turns so far; private note `handoff/notes/2026-11-27-research-32-architecture.md`); nothing will be built without approval.

## 4. Questions for the owner

1. Ownership check → **#49**, and keep numbered log folders (SPARK = 2, CONDUCTOR = 3)? 
2. Old sessions without an owner record: admin-only (default) or open?
3. #37a: which repos / folders may the owner code read?
4. Approve Batch A in the order above?
