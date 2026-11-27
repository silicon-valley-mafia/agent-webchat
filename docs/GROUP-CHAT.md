# 🧪 Group chat (experimental, TODO #43)

One prompt goes to several agents at once and you see every agent's reply side by side.

**Open it:** the **🧪 Group** button in the main chat header, or `group.html` next to the main page.

## Needs
- **At least 2 agents** for your access code. Agents come from the `AGENTS` repo secret (see [AGENTS.md](AGENTS.md)); with only the default agent the page says a group isn't possible yet.
- The same access code as the main chat (it is read from this browser; otherwise the page asks for it).

## How it works
| Step | What happens |
|---|---|
| Pick agents | Chips for the agents your code may use. Pick **2–4** (`groupMaxAgents`, max 6). The last pick is remembered. |
| Start group | One `/token` per agent (with `X-Agent`) → **one Direct Line conversation per agent** (agents are never mixed in one conversation). Each gets the normal `startConversation` greeting. |
| Send | Enter sends to **All agents**; **Send to** → "Only …" sends a follow-up to one agent. Shift+Enter adds a line. |
| Replies | **Columns** on wide screens, **tabs** below 800 px (a • marks unread replies). Each column shows its own state: working… / working… (progress note) / ✓ replied · first reply N s. |
| End of turn | Same rule as the main chat (#42, `web/turns.js`): progress notes keep an agent "working" for up to `interimGraceMs` (**120 s**); a final reply closes it after **3 s** quiet. A slow agent never blocks the others. |
| Logs | Each conversation is logged like a normal chat (`/log` with `X-Agent`), when the agent's turn ends and when the page closes. Conversation → agent is saved, so **History** on the main page can reopen any member with the right agent. |
| Download | One Markdown file: each prompt, then every agent's replies under it, with the time to the first reply. |

## Not in this experiment
Attachments (use the main chat), Stop, Copy/collapse buttons, resuming a whole group after a refresh (single conversations can be reopened from History), agents seeing each other's answers.

## Costs and limits
- Every prompt costs **one agent turn per agent** (Copilot Studio credits × N).
- Starting a group uses N `/token` calls (Worker limit **10 /token per minute per IP**).
- `/log` runs per agent per turn (Cloudflare Free **100,000 requests/day**).

## Off switch and debugging
- `groupChat: false` in `web/config.js` hides the 🧪 Group button and disables the page.
- Console on the group page: `AgentGroup.state()` (agents, conversation ids, working state, reply counts).
- Groups started in this browser are listed in `localStorage.agentGroups` (id, time, agent + conversation id per member).

## Open questions for the owner
Columns vs one thread (built: columns + tabs on mobile), max agents (built: 4), pass other agents' answers back automatically (a "discuss" round), pick best / merge answers, presets.
