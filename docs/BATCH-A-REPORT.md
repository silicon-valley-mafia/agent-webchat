# Batch A report (SPARK / CONDUCTOR webchat features)

_2026-11-27 23:10 IST, GitHub bridge agent (account silicon-valley-mafia). Everything below is merged into `dev` and is **not deployed**. Deploy only after the owner says "deploy now" (flow in [BRANCHES.md](BRANCHES.md))._

## 1. Pull requests (all into `dev`, squash-merged)

| Order | Item | PR | Merge commit on `dev` |
|---|---|---|---|
| 0 | Split `app.js`: per-reply tools to `web/replies.js` | [#23](https://github.com/silicon-valley-mafia/agent-webchat/pull/23) | `bf06302` |
| 1 | #49 conversation ownership check | [#24](https://github.com/silicon-valley-mafia/agent-webchat/pull/24) | `c30a2e8` |
| 2 | #7 role to the agent (advisory) | [#25](https://github.com/silicon-valley-mafia/agent-webchat/pull/25) | `182076e` |
| – | Bug: CORS preflight for `/agents` returned 404, so the picker never showed 2+ agents | [#26](https://github.com/silicon-valley-mafia/agent-webchat/pull/26) | `cc5973c` |
| 3 | #37a 📄 Insert file | [#27](https://github.com/silicon-valley-mafia/agent-webchat/pull/27) | `30521f2` |
| 4 | #37b ➡ "Pass on to Coach" toggle | [#28](https://github.com/silicon-valley-mafia/agent-webchat/pull/28) | `908a045` |
| 5 | #20 agent number in upload folders | [#29](https://github.com/silicon-valley-mafia/agent-webchat/pull/29) | `e925ec4` |

## 2. Testing

| What | Result |
|---|---|
| Local `node --test` (all Worker + page harness tests, run by the session that built the batch) | **54/54 pass** |
| CI "Token Worker - test and deploy" → `test` job on PR #28 (final head `7e886b1`) | ✅ success (deploy job skipped, as for every PR) |
| CI `test` job on PR #29 (final head `85102c1`, incl. the 5 new tests in `worker/test/agentuploads.test.js`) | ✅ success |
| CI `check` job (web check) on PR #28 and PR #29 | ✅ success |
| PR #29 files | git blob SHAs checked after the push against the hand-off pack (5 of 5 match) |
| **Browser** | **Not tested yet.** Nothing in Batch A has run in a real browser or against the live Worker. |

Owner checks after deploy:
1. A second access code gets **403** on `/resume` of a conversation it didn't start (#49); the owner code still opens it.
2. In Copilot Studio, `System.Activity.ChannelData.awRole` shows the role at chat start (#7).
3. 📄 File shows only the allowed folders; a file over 30 KB is refused with its size (#37a).
4. In a SPARK chat, the ➡ chip sets `channelData.awRoute = "coach"`, and the state survives a reload (#37b).
5. An upload in a SPARK chat lands in `agent-webchat-artifcats-1/webchat-uploads/2/…`; uploads to the default agent go to `webchat-uploads/1/…` (#20).
6. ☰ Chats: SPARK → CONDUCTOR → SPARK returns to the same SPARK chat (#23, PR #22).

## 3. Off switches

| Item | Off switch |
|---|---|
| #49 ownership check | Worker var `OWNERSHIP_CHECK = "off"`; also off while `OWNER_PEPPER` is unset (and without `LOG_REPO_TOKEN`) |
| #7 role | `sendRole: false` in `web/config.js` |
| #37a Insert file | `insertFile: false` in `web/config.js` (or remove `FILE_READ_TOKEN`) |
| #37b Pass on to Coach | `routeToggle: false` in `web/config.js` |
| #20 upload folders | none of its own. With no `AGENTS`, an older page, or `multiAgent: false`, uploads use the old flat path |

## 4. TODO lines

All in [TODO-3.md](TODO-3.md), section "Status of Batch A":
- 🔵 On dev: step 0 split (PR #23), #49 (PR #24), #7 (PR #25), preflight fix (PR #26), #37a (PR #27), #37b (PR #28), #20 upload folders (PR #29).
- #44 row: the "Open" note about upload folders is closed by PR #29.
- **New #50**: copy button on user-sent prompts, off switch `copyPrompt: false` (not started).
- Numbering: #45–#48 keep the brief's meaning (starter prompts, plan board, hand-off button, file return check); next free number is **#51**.

PRs #23–#27 were merged without their TODO line; the lines were added in PR #28. `docs/TODO-3.md` on `main` and `dev` is now the same file, so the deploy merge has no conflict there.

## 5. Owner setup before "deploy now"

Repo secrets (**agent-webchat → Settings → Secrets and variables → Actions**):

| Secret | Value / note |
|---|---|
| `OWNER_PEPPER` | 32 or more random characters, e.g. `openssl rand -hex 32`. The deploy step refuses shorter values. Changing it later makes existing owner records unmatchable (they become admin-only). |
| `FILE_READ_TOKEN` | Fine-grained token with **Contents: Read-only** on exactly the repos allowed below. Never reuse the logging token (it can write). |
| `OWNER_FILES` | JSON array of the owner's allowed folders (`owner/repo/` or `owner/repo/folder/`). The exact list (6 folders) is in the private note `agent-webchat-logs/handoff/notes/2026-11-27-agent-features-brief-and-batch-a.md` §9, because private repo names must not appear in this public repo. |
| `AGENTS` | Add `spark` (`"num": 2`, `"routes": ["coach"]`) and `conductor` (`"num": 3`), each with its own Direct Line secret. The Coach's entry must have the id `coach`. Keep both new agents on the owner's code only (`ACCESS_CODES` `agents` lists) until #49 is live. |

Then:
1. Run **Actions → Token Worker - test and deploy → Run workflow**. The status step should print `Ownership check: ON`, `Insert file: ON`, `Extra agents: ON`.
2. Add agents 2 (SPARK) and 3 (CONDUCTOR) to `logs/AGENTS.md` in `agent-webchat-logs`.

## 6. Notes

- `web/files.js` calls the global `fetch(...)` at call time, so uploads go through the `web/agents.js` wrapper and get `X-Agent` (checked for PR #29).
- The brief (`READ-AGENT-FEATURES-BRIEF.md`) and the reply (`AGENT-FEATURES-BRIEF-REPLY.md`) were saved to the private note above and removed from `main`; the full texts stay in git history (commit `7de8ef3`).
- Coach hand-off HO-20261127-01 has been read. Its open points for the owner: finish both agents in Copilot Studio and register them; confirm whether RFAST and GP are connected to CONDUCTOR; confirm the `agent-plans` repo; after #7 is live, SPARK v5 rule "route writes to CONDUCTOR only when role = owner".
