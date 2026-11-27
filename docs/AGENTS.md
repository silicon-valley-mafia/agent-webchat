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
     "coach": { "name": "VLSI Coach", "description": "Study help and logs", "initials": "VC", "num": 2, "secret": "<Direct Line secret>" }
   }
   ```

   - Agent id (`coach`): lower case letters, digits, `-` or `_`, up to 32 characters.
   - `num`: the agent's **transcript folder number** in `agent-webchat-logs` (see section 4). Give every agent its own
     number from 2 up and never change or reuse it.
   - The existing agent stays as id `github` (`DEFAULT_AGENT_ID` / `DEFAULT_AGENT_NAME` in `worker/wrangler.toml`),
     folder number 1.
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
- Each reply is labelled with the agent's own name. The 🧪 **Group** page sends one prompt to several agents
  ([GROUP-CHAT.md](GROUP-CHAT.md)).

## 4. Transcripts per agent (TODO #44)

Each agent logs into its **own numbered folder** in `agent-webchat-logs`:

```
logs/AGENTS.md                                   <- index: which number is which agent (kept by hand)
logs/1/AGENT.md                                  <- written by the Worker the first time agent 1 is logged
logs/1/2026-11-27/1705-deepesh--<conversation>/  <- one session (0000-session.md, 0001-...-user.md, ...)
logs/2/AGENT.md
logs/2/2026-11-27/1710-deepesh--<conversation>/
logs/2026-11-27/0140-deepesh--<conversation>/    <- older sessions (before 2026-11-27 17:00 IST), all agent 1
```

| Number | Comes from |
|---|---|
| `1` | the default agent (`DIRECTLINE_SECRET`); change with the `DEFAULT_AGENT_NUM` Worker var |
| `2`, `3`, ... | `"num"` of each `AGENTS` entry |
| missing / duplicate `num` | the lowest free number from 2 up, in `AGENTS` order (set `num` explicitly so numbers never shift) |

Where the number is written down, so a folder is never ambiguous:
- `logs/<N>/AGENT.md` names the agent (id, name, first conversation). The Worker creates it once (create-only, like all
  log files) and never changes it.
- Each session's `0000-session.md` has an **Agent** row: name, id and folder.
- `logs/AGENTS.md` is the human index of all numbers. Update it when you add an agent.

History, transcripts and Download read both the old flat folders and the numbered ones. History items from numbered
folders carry `agent: <N>`. Download file names start with the number (`2_2026-11-27_...md`).

## Limits / notes

- One agent per conversation. Switching agent = new chat (keeping several live chats in one tab is #23).
- A conversation started in another browser and never opened here has no agent record. It goes to the first agent
  (the GitHub agent, which every older conversation used).
- Off switch on the page: `multiAgent: false` in `web/config.js`. Worker: set `main = "src/index.js"` in `wrangler.toml`
  (logs then go to the old flat `logs/<day>/` folders again).
- Code: `worker/src/main.js` (Worker front: registry, numbers), `worker/src/index.js` (logging), `web/agents.js`
  (page; `app.js` unchanged), tests in `worker/test/agents.test.js` and `worker/test/agentlogs.test.js`.
