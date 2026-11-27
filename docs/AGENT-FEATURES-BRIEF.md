# Brief: webchat features for the new agents (SPARK, CONDUCTOR)

_Written 2026-11-27 (IST) for the GitHub agent. Names decided 2026-11-27 17:03 IST: **SPARK** and **CONDUCTOR** (earlier drafts called agent 1 RELAY). Read this whole file, then `docs/TODO.md`, `docs/TODO-2.md`, `docs/TODO-3.md` and `docs/AGENTS.md` before starting._

## 1. Context

Two new Copilot Studio agents are being added to the agent picker:

| Agent | Webchat id | Model | Job |
|---|---|---|---|
| **SPARK** | `spark` | Haiku | Quick all-rounder: short answers and GitHub reads; hands deep questions to the VLSI Coach. Read-only. |
| **CONDUCTOR** | `conductor` | Sonnet | GitHub work. Writes a plan file, shows it, waits for "yes", then runs tasks or delegates them. Only agent allowed to write. |

The owner builds the agents in Copilot Studio. **Your job is the webchat side only**: the page (`web/`) and the Worker (`worker/`). Do not edit agent instructions.

Multi-agent is already live (PR #17): repo secret `AGENTS`, `ACCESS_CODES` with `agents` / `defaultAgent`, picker shown with 2+ agents, switching agent starts a new chat.

## 2. Rules for this work

1. **Feature PRs go into `dev`, not `main`.** `dev` is promoted to `main` in batches. Docs-only changes may go straight to `main`.
2. Open PRs already waiting on `dev`: #18 (#42 turn-end), #19 (#4 Stop, Web Chat 4.19.2), #20 (#43 group chat). Base new work on `dev` so you build on them.
3. **One push call holds about 66.7 KB.** `web/app.js` is ~64.7 KB, so put new features in **new files** (`web/<feature>.js`) and add only a small hook to `app.js`.
4. Every feature gets an **off switch** in config, like `multiAgent:false` and `groupChat:false`.
5. Nothing private in this public repo: no access codes, secrets, conversation contents or personal data.
6. Update the matching TODO entry (status line) in the same PR. Add new TODO numbers in `docs/TODO-3.md` from **#44** on.
7. Show the owner a plan before each batch and wait for approval. No force-push, no direct push to `main` for code.

## 3. Batch A (do first)

| Item | What to build | Done when |
|---|---|---|
| **#37a Insert `.md` from a repo** | A button that lets the user pick an allowed repo path. The Worker fetches the file and inserts it into the prompt with a `[file: owner/repo/path@sha]` header. Size cap with a clear message when exceeded. | The agent receives the file text plus header; the log shows the path and sha. |
| **#37b "Pass on to Coach" toggle** | A per-message toggle that sets `channelData.awRoute = "coach"`. Visible in the composer; remembered per chat. | Activity sent with `awRoute`; toggle state survives reload. |
| **#7 role to the agent** | Pass the access-code role (`owner`, `admin`, `user`, `readOnly`) in the `startConversation` event (`channelData` or `value`). The Worker decides it, never the page. | Agent can read the role; read-only codes are marked. |
| **#20 agent id in paths** | Add the agent id to log and upload paths, e.g. `logs/<agent>/<date>/…`. Keep old paths readable. | New sessions log under their agent folder; History still lists old ones. |

## 4. Batch B

| Item | What to build | Done when |
|---|---|---|
| **#44 (new) Conversation ownership check** | `/resume` and `/export` only work for conversations started with the same access code (owner and `admin:true` codes can see all). Store the code's id (not the code) with the conversation record. | Another code gets 403 for a conversation it did not start. **Needed before CONDUCTOR is shared with anyone.** |
| **#23 switch agents in one tab** | Keep one session per agent; switching back resumes it instead of starting a new chat. | Coach → CONDUCTOR → Coach returns to the same Coach chat. |
| **#20 History filter by agent** | Filter chips in History by agent id. | Filter works on new-path logs. |
| **#45 (new) Per-agent starter prompts** | Optional `starters: [..]` per agent in the `AGENTS` registry, shown as chips on an empty chat. | Chips appear for agents that define them; none otherwise. |

## 5. Batch C

| Item | What to build | Done when |
|---|---|---|
| **#46 (new) Plan board** | If a message contains a plan file link or a fenced YAML task list (`tasks:` with `id`, `title`, `status`), render a status table with a **Run next task** button that sends `run plan <id>`. | Table renders from the YAML; button sends the text. |
| **#47 (new) Hand-off button** | One click sends: "End of session. Write the hand-off file now." | Sent as a normal message, logged. |
| **#38 📌 pinned context** | Saved text block added to the next message (or every message, user's choice). | Pinned text appears in the sent activity, editable and clearable. |
| **#39 + #34b guardrails / continue with context** | On an `MCS-xxxx` error or "blocked" reply, offer "Save state and continue": ask the agent for a state summary, then start a new chat seeded with it. | One click moves a long run into a fresh chat with context. |
| **#3 Activity panel** | Collapse an agent's interim progress messages into one expandable panel per turn. | A long CONDUCTOR turn shows one panel plus the final answer. |

## 6. Later, design first (do not start without approval)

- **#32 Worker MCP / REST API** (`get_transcript`, `create_plan`, `send_to_agent`, `run_job`).
- **#41 MCS-4041** after resume/refresh. Note: the logs show it also on the first message of a fresh chat and several times in a row after a redeploy, so a single retry is not a fix.

## 7. Not your work

- **#2 PR form**: needs an Adaptive Card topic inside the agent in Copilot Studio; the owner does this.
- Agent instructions, models, tools, and the plans repository location: owner decisions.

## 8. Report back

After each batch: PR link(s) into `dev`, what was tested and how, any off switch added, and the TODO lines updated.
