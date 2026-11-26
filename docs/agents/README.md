# Agent drafts for agent-webchat (FY family)

_Status: **draft**, names **provisional**. Drafted 2026-11-27 by the "Studio – VLSI Internship Coach" agent at Deepesh's request, relayed and saved by the GitHub bridge. Related backlog: `docs/TODO.md` #11, #20, #23._

## Owner's brief (2026-11-27)

- 04:49 IST: "Deepesh will make an agent in the FY family — which will not have Work IQ tools — which will be integrated in this agent-webchat. That agent can be similar to RFAST and GP; will go with 2 agents, 1 Sonnet and 1 Haiku. It's OK if you name them RFAST2 etc., but it's your call. Either way they will not have Work IQ tools so they can't see SharePoint files (maybe OneDrive files also they won't have access), only GitHub MCP probably. Build the drafts so we can readily build when we catch up."
- 04:57 IST: "Those 2 agents — names not fixed. Most of the time I will use one just to call you [the Coach]; another one will be mixed. Maybe I might tell you to draft an action plan in one prompt which you may save somewhere, and in the next prompt this webchat agent might delegate those pre-assigned tasks to all agents as per your previous plan. Not sure — it's one possible use plan."

## Versions

| Version | Agent A | Agent B | Notes |
|---|---|---|---|
| v1 (04:49) | **SPARK** (`VX-RFAST2`, Haiku) — fast GitHub helper, RFAST-like | **FORGE** (`VX-GP2`, Sonnet) — deep GitHub worker, GP-like | Superseded; FORGE's GitHub rules live on in CONDUCTOR |
| **v2 (04:57, current)** | **RELAY** (Haiku) — front door that calls the Coach → [`relay.md`](relay.md) | **CONDUCTOR** (Sonnet) — mixed use + plan-then-delegate → [`conductor.md`](conductor.md) | Plan format → [`plan-template.md`](plan-template.md) |

Webchat ids / avatars (proposal): `relay` / `RL`; `conductor` / `CD`. (v1 used `spark`/`SP` amber, `forge`/`FG` indigo.) Naming prefix `FY-` vs `VX-` undecided.

## Common settings (both agents)

- **No Work IQ, no SharePoint, no OneDrive, no Outlook/Teams/calendar, no web search.** If a request needs M365 data the agent says so and offers: paste it, upload it, or commit it to GitHub and give the path.
- **Knowledge sources:** none (the GitHub repos, read live via MCP, are the knowledge).
- **File uploads:** on — DOCX, CSV, PDF, TXT, JPG, PNG, WebP, non-animated GIF, max 15 MB per file. The webchat splits files over 3.8 MB into zip parts; agents may not be able to read those — say so and ask for a smaller file or a repo path.
- **Channel:** Web channel security on; **each agent gets its own Direct Line secret**, stored as a Cloudflare Worker secret (never in `web/config.js`).
- **Conversation Start topic:** the page posts a hidden `startConversation` event once per **new** chat (not on resume) with `locale`, `localTimezone` and `from {id, name}` — **no `value` object**. Use `System.Activity.From.Name` (user name), `System.Activity.LocalTimezone` (IANA tz, e.g. `Asia/Calcutta`; if not in the picker, fall back to `System.Conversation.LocalTimeZone`), `System.Activity.Locale` (default `en-US`). No name → greet with "Hi 👋". Resumed chats get no event — don't re-greet, don't assume name/timezone.

## Copilot Studio requirements and limits (from the Coach, 2026-11-27)

- To call another agent ("connected agent"): target in the **same environment**, **published**, **"Allow other agents to connect"** on, owned by / shared with the maker; add it under **Agents → Add an agent** with a clear description (the orchestrator routes on the description). Check the context-inclusion setting.
- **Delegation is one level deep only**: a connected agent cannot call another connected agent. So the orchestrator (CONDUCTOR) must be the top-level agent the user talks to in the webchat; the Coach, when called, can't call RFAST/GP. (The Coach hit this itself on 2026-11-27.)
- The calling orchestrator writes the task description itself and **may rephrase** the user's message — verbatim relay isn't guaranteed; test it.
- Connected agents have no input/output parameter mapping inside topics (child agents do) — so structured data travels in the plan file on GitHub.
- Each hop consumes Copilot Credits; connected-agent calls may not show in the called agent's activity tab — audit from the caller's transcript and the plan's Log.
- **Biggest risk:** the Coach relies on SharePoint knowledge / Work IQ under the signed-in user's identity. The webchat uses an access code over Direct Line (no Entra sign-in), so the Coach's M365 knowledge may not work there at all, whether called via RELAY or selected directly. **Test first**; if it fails: add Entra sign-in to the webchat, or run the Coach in GitHub-only mode there.

Coach's sources for these points: Microsoft Learn "Connected agents overview" and "Multi-agent orchestration patterns and best practices"; community/blog posts on connected vs child agents, credits and authentication (links in the 2026-11-27 session transcript).

## Open questions

See `docs/HANDOFF.md` §6 (answer Q2 Entra sign-in and Q3 is RELAY needed first).
