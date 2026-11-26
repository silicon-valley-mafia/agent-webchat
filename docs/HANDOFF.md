# Hand-off for the next coding agent / session

_Last updated: 2026-11-27 05:02 IST (2026-11-26 23:32 UTC), end of owner session with the GitHub bridge agent (account `silicon-valley-mafia`)._

This file is the starting point for whoever picks up `agent-webchat` next (a coding agent, the GitHub bridge, or Deepesh). Read it, then `docs/TODO.md` (the backlog) and `docs/README.md` (how the app works).

## 1. What the project is (one paragraph)

`agent-webchat` is a static web page (GitHub Pages, `web/`) that talks to a Copilot Studio agent over **Microsoft Direct Line** using Bot Framework **Web Chat**, plus a **Cloudflare Worker** (`worker/`) that issues Direct Line tokens behind an access-code gate, writes per-message transcripts to the private repo `silicon-valley-mafia/agent-webchat-logs`, and saves original attachments to the private repo `silicon-valley-mafia/agent-webchat-artifcats-1` (name is spelled `artifcats`). Browser does all file processing (zip/split to 3.8 MB parts, SHA-256); the Worker only streams bytes to GitHub.

## 2. State at hand-off

- **Code:** unchanged this session. No open PRs. Last code PRs: #1–#4 (all closed). PR #3/#4 still need the owner's deploy + browser test (TODO #6).
- **Docs changed this session (all committed to `main`):** `docs/TODO.md` items **#10–#24** added/updated; this `HANDOFF.md`; `docs/agents/*` (agent drafts + plan template).
- **Artifacts repo cleanup (owner request, 04:31 IST):** removed `webchat-uploads/2026-11-27/deepesh--7uI78wWemueA9ZbnqGUP3s-in/042725-3vo0/` (`temp OCR.pdf`, 20,258,531 bytes + MANIFEST) and `.../043010-63j2/` (MANIFEST only; `temp.mp4` 45,579,336 bytes had never saved). Commits `f69ce06`, `4ffa316`, `e7c7d8c`. The PDF blob is **still in git history** (normal delete); a history rewrite (`git filter-repo` + force-push) would be needed to purge it. Transcripts in `agent-webchat-logs` still mention both files.
- **Session used for testing:** Direct Line conversation `7uI78wWemueA9ZbnqGUP3s-in` (user Deepesh, admin). Screenshots from it are in `agent-webchat-artifcats-1/webchat-uploads/2026-11-27/deepesh--7uI78wWemueA9ZbnqGUP3s-in/` (`041513-3cjd`, `041521-ngoi` = blank captures; `041942-vdn6`, `041958-97r7` = #13/#14 evidence; `045903-8qi0` = #24 evidence).

## 3. Suggested order of work

**Quick wins (small, low risk, do first, one PR each or one combined PR):**
1. **#16 Shift+Enter** — add `sendBoxTextWrap: true` to Web Chat `styleOptions` in `web/app.js`.
2. **#14 dark-mode link colour** — CSS for links in bubbles under `[data-theme="dark"]` (e.g. `#93c5fd`).
3. **#24(a) angle brackets vanish** — escape `<`/`>` outside code before Markdown rendering.
4. **#24(b) squeezed tables** + **#15 fluid width** — remove `#app { max-width: 960px }`, raise `bubbleMaxWidth`, table CSS (min cell width, horizontal scroll).
5. **#22 session id button** — `s.conversationId` already exists in `web/app.js`.
6. **#24(c) upload banner** — dismissible/auto-hide, accurate wording, "Retry save"; attachment note should say "saving…" until the Worker confirms.

**High-priority bug:**
7. **#10 attachment + text in one message** — `sendFiles(files)` in `web/app.js` sends immediately; stage files and send with the typed text (interim: include send-box text in the same activity).

**Next (needs a little design):**
8. **#13** "agent is working" state / queue next message / reconcile with `/transcript`.
9. **#17** copy buttons (plain + Markdown) and **#19** collapsible replies (latest 2–3 expanded) — both need an `activityMiddleware` (none exists yet).
10. **#21** Clear chat (same session).

**Bigger features (design first, owner decisions pending):**
11. **#20** multi-agent registry + per-user visible agents, **#23** switch agents in one tab keeping sessions, **#18** UI redo (umbrella), **#9** relay, **#7** per-user rules, **#12** voice verification, **#5** attachment cap, **#3/#4** thinking/stop.

## 4. Rules for whoever changes code

- **No secrets in the repo or in `web/config.js`** (it is public). Direct Line secrets, GitHub tokens, access codes live as Worker secrets.
- Code changes: work on a branch and open a PR (don't push code straight to `main`); `docs/` notes have been committed directly to `main` this session.
- Keep everything working that #18 lists under "Keep working" (access code gate, New chat, history/resume/download, dark mode, notifications, voice, paste/drop/paperclip with zip parts + artifact save, transcript logging).
- Cloudflare Workers **Free** limits: 100,000 requests/day per account (resets 00:00 UTC = 05:30 IST), 10 ms CPU per request, 50 subrequests per request; Error 1027 when the daily limit is exceeded. Every chat message already costs ≥ 1 Worker request (log call), every attachment more.
- Web Chat / Direct Line facts used in the TODOs: hidden `startConversation` event is posted once per new chat (not on resume) with `locale`, `localTimezone`, `from {id, name}` — no `value` object; agent-side file input supports DOCX, CSV, PDF, TXT, JPG, PNG, WebP, non-animated GIF up to 15 MB per file (PDF ≤ 40 pages); the page splits agent copies at 3.8 MB per message, max 10 parts.
- Concurrent writers: several agents/sessions may write to the same repos. Re-read a file's SHA right before updating it, and re-apply your change if it moved; don't overwrite other sessions' edits.

## 5. Agent drafts (for TODO #20 / #23)

Drafted by the "Studio – VLSI Internship Coach" agent during this session, saved in `docs/agents/`:

- `docs/agents/README.md` — overview, history (v1 SPARK/FORGE → v2 RELAY/CONDUCTOR), Copilot Studio requirements and limits.
- `docs/agents/relay.md` — Agent A, **RELAY** (Haiku): thin front door that calls the Coach.
- `docs/agents/conductor.md` — Agent B, **CONDUCTOR** (Sonnet): GitHub work + "plan, then delegate".
- `docs/agents/plan-template.md` — plan file format (proposed repo `silicon-valley-mafia/agent-plans`, not created yet).

Names are **provisional** (owner: "names not fixed"; FY family; prefix `FY-` vs `VX-` undecided).

## 6. Open questions for the owner (blocking the agent work)

From the Coach (answer **Q2 and Q3 first** — they decide whether RELAY is needed):
1. Plans in a new private repo `agent-plans` (recommended) or `agent-webchat/plans/`?
2. **Will the webchat ever sign users in with Entra?** Without it the Coach's SharePoint / Work IQ knowledge probably won't work through the webchat (it currently uses an access code only). **Test this first.**
3. **Is RELAY still needed** once the Coach can be picked directly in the webchat (#20)? RELAY adds a hop, credits, and possible rephrasing.
4. Does the Coach always draft plans, or may CONDUCTOR plan non-study work itself?
5. Approval level: ask before each batch, or one "yes" per plan? May delegated agents open PRs themselves?
6. Which agents can own tasks (Coach, RFAST, GP only, or also RELAY / future agents)?
7. Keep Haiku for RELAY and Sonnet for CONDUCTOR?
8. Log plan-run results automatically into the internship learning records (Coach task at the end of each plan)?

Also still open from earlier in the session:
- What RFAST and GP are actually set up to do (the Coach couldn't query them; it guessed RFAST = quick, GP = general/deep).
- #18: look & feel / reference design / chosen approach (Web Chat restyle, Fluent theme, or custom UI e.g. `assistant-ui` on Direct Line).
- #19: should the user's own long prompts collapse too?
- #15 was interpreted as "make the window fluid/resizable" — confirm.
- Purge the deleted `temp OCR.pdf` from the artifacts repo history? (needs force-push)
- Root cause of the 43.5 MB `temp.mp4` save failure (check Worker logs for 04:30:10 IST).

## 7. Session log (2026-11-27, IST)

| Time | What happened | Result |
|---|---|---|
| 04:15 | Two blank screenshots pasted; paste sends immediately | TODO #10 |
| 04:17 | Future scope: more agents, agent picker, "spoke" to Coach | TODO #11 |
| 04:18 | Speak option needs debugging/verification | TODO #12 |
| 04:19 | Message sent while agent was working; reply seemed lost; screenshot | TODO #13, #14 |
| 04:21 | Don't fix chat window size/ratio | TODO #15 |
| 04:22 | Can't send attachment + prompt together (confirmed) | #10 marked high priority |
| 04:23–04:26 | Q&A: who writes logs (Worker, triggered by page), Cloudflare request usage | — |
| 04:27 | `temp OCR.pdf` (19.3 MB) sent as 6 zip parts; parts 3 and 6 never arrived, others out of order | — |
| 04:30 | `temp.mp4` (43.5 MB) — not sent to agent (type/size), GitHub save failed (MANIFEST "Saved: NO") | #24(c) |
| 04:31 | Owner asked to delete video + PDF uploads | Done (see §2) |
| 04:31 | Shift+Enter for new line | TODO #16 |
| 04:33/04:38 | Research: APIs and chat front-ends (OpenAI Responses/ChatKit, Anthropic Messages, Copilot Studio Direct Line/Agents SDK, assistant-ui, AI Elements, Open WebUI, LibreChat, LobeChat …) | notes in #18/#20 |
| 04:33 | Copy buttons (plain + Markdown) | TODO #17 |
| 04:34 | UI has to be redone | TODO #18 (umbrella) |
| 04:40/04:43 | Collapse replies; latest 2–3 shown in full | TODO #19 |
| 04:49 | Message to Coach: build 2 FY-family agents (Sonnet + Haiku, GitHub MCP only) | Drafts v1 SPARK/FORGE |
| 04:50 | Multiple agent integrations + per-user visible agents | TODO #20 |
| 04:53 | Clear chat (same session) + show session id | TODO #21, #22 |
| 04:57 | To Coach: names not fixed; one agent mainly calls Coach, other mixed with plan-then-delegate | Drafts v2 RELAY/CONDUCTOR |
| 04:58 | Switch agents in one tab keeping sessions | TODO #23 |
| 04:59 | Screenshot: `<id>` stripped, squeezed table, stale upload banner | TODO #24 |
| 05:02 | End of session; save everything | this file + `docs/agents/` |

## 8. Where things are

| What | Where |
|---|---|
| Backlog | `docs/TODO.md` (#1–#24) |
| How it works / setup | `docs/README.md` |
| Agent drafts + plan template | `docs/agents/` |
| Page code | `web/app.js` (Web Chat, sessions, `sendFiles`, `getSpeechFactory`, `startConversation`), `web/files.js` (zip/split/hash, `beginArtifact`), `web/config.js` (public config), `web/app.css`, `web/index.html` |
| Worker | `worker/` (`src/artifacts.js`, `wrangler.toml`, tests in `worker/test/`) |
| Transcripts | `silicon-valley-mafia/agent-webchat-logs` (private, written by the Worker) |
| Original uploads | `silicon-valley-mafia/agent-webchat-artifcats-1` (private) |
