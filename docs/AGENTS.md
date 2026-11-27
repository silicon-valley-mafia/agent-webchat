# Multiple agents and per-user access (TODO #11 / #20 / #7)

The page can talk to several Copilot Studio agents. Each agent has its own Direct Line secret, kept only in the
Worker. Each person (access code) can be limited to some agents.

**Nothing changes until you add a second agent.** With only `DIRECTLINE_SECRET` set, there is one agent
("GitHub Agent") and no picker.

## 1. Add an agent

1. In Copilot Studio, open the agent -> **Settings -> Security -> Web channel security** -> copy a Direct Line secret.
2. In GitHub: **agent-webchat -> Settings -> Secrets and variables -> Actions -> New repository secret**,
   name **`AGENTS`**, value (JSON, one entry per extra agent):

   ```json
   {
     "coach": { "name": "VLSI Coach", "description": "Study help and logs", "initials": "VC", "secret": "<Direct Line secret>" }
   }
   ```

   - Agent id (`coach`): lower case letters, digits, `-` or `_`, up to 32 characters.
   - The existing agent stays as id `github` (`DEFAULT_AGENT_ID` / `DEFAULT_AGENT_NAME` in `worker/wrangler.toml`).
3. Re-run **Actions -> Token Worker - test and deploy -> Run workflow** (or push any change under `worker/`).
   The deploy step checks the JSON and uploads it as a Worker secret.

## 2. Decide who sees which agent

`ACCESS_CODES` (repo secret) accepts two optional keys per person:

```json
{
  "ravi-123": { "name": "Ravi", "agents": ["coach"], "defaultAgent": "coach" },
  "asha-456": "Asha",
  "team-789": { "name": "Team", "agents": ["github", "coach"] }
}
```

| Entry | Agents |
|---|---|
| Owner (`ACCESS_CODE`) and `"admin": true` | all |
| Plain name (`"Asha"`) or no `agents` key | all |
| `"agents": ["coach"]` | only those listed; `"*"` = all |
| `"defaultAgent"` | picked for that person's first new chat |

The Worker enforces this: a code can't get a token for an agent it isn't allowed, even by editing the request
(`403 agent_not_allowed`).

## 3. Using it

- With 2+ agents allowed, a **picker** appears next to the title. Choosing an agent starts a **new chat** with it.
- Earlier chats with other agents stay in **History** and the recent-sessions list. Opening one reconnects to the
  agent it was started with. The page remembers which agent each conversation belongs to.
- Title, tab title and the agent's avatar initials follow the open conversation's agent.
- Transcripts keep working as before (same `logs/` folders). Each reply is labelled with the agent's own name.

## Limits / notes

- One agent per conversation. Switching agent = new chat (keeping several live chats in one tab is #23).
- A conversation started in another browser and never opened here has no agent record. It goes to the first agent
  (the GitHub agent, which every older conversation used).
- Off switch on the page: `multiAgent: false` in `web/config.js`. Worker: set `main = "src/index.js"` in `wrangler.toml`.
- Code: `worker/src/main.js` (Worker front; `index.js` unchanged), `web/agents.js` (page; `app.js` unchanged),
  tests in `worker/test/agents.test.js`.
