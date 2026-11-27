# Chats sidebar: several conversations in one tab (TODO #23) + exact times (TODO #36)

## ☰ Chats sidebar (`web/rail.js`, `web/rail.css`)

Like the chat list in ChatGPT, Claude or Copilot. Open it with **☰** at the top left. It is open by default on wide
screens and slides over the chat on screens narrower than 900 px.

| Part | What it does |
|---|---|
| **+ New chat** (Alt+N) | Starts a new conversation. With 2+ agents (`AGENTS` secret, [AGENTS.md](AGENTS.md)) pick the agent in the box above it first. **The chat you were in stays open.** |
| **Open in this tab** | Conversations that stay **connected** while you look at another one. Click one to switch **instantly**: same Direct Line connection and Web Chat store, so there's no reconnect (`/resume`), nothing is replayed, the draft is kept, and replies that arrived meanwhile are already there. Shows the agent's initials, your first message as the title, how long ago it was active, **…** while the agent is working and a red count of **unread replies**. **✕** closes one (it moves to Recent). |
| **Recent** | Conversations remembered on this browser (up to `recentSessions`, 8). Click = continue it (one `/resume`, like History → Continue). |
| Alt+↑ / Alt+↓ | Switch between the open chats. |

- **Limit:** `liveSessions` (default **4**: the one you see + 3 in the background, max 8). When a new chat would go over,
  the open chat that has been **idle longest** is closed (a chat whose agent is still working is closed last).
- **Background chats keep working:** their replies are logged as usual, queued prompts (#35) are still sent when the
  agent finishes, and the 🔔 desktop notification still fires when the tab is hidden.
- **Switching agent:** each chat remembers its agent; the title and avatar follow the chat you open.
- **Costs:** each open chat is one Direct Line connection (resumed ones poll every 1.5 s). Opening a chat from Recent
  uses one `/token`-bucket request (Worker limit **10 per minute per IP**). Nothing extra for switching between open chats.
- **Not kept across a page refresh:** after a refresh the current chat reconnects as before and the others are under
  Recent (one click to continue).
- **Off switch:** `sessionRail: false` in `web/config.js` (New chat then ends the old conversation, as before).
- **Console:** `AgentRail.state()`.
- Stored in this browser: `agentRailOpen` (sidebar open/closed), `agentRailMeta` (title + last activity per
  conversation, newest 200).

## Exact time on hover (`web/timestamps.js`)

Web Chat still shows "Just now" / "5 minutes ago". **Hover** it (or **tap** it on a phone) to see the exact date and
time with seconds and time zone, e.g. `Fri, 27 Nov 2026, 17:08:08 IST`. It is the message's **server** timestamp, the
same clock the transcripts in `agent-webchat-logs` use.

- `timestampMode: "absolute"` shows the exact time instead of "… ago" (Web Chat's own setting).
- `exactTimeOnHover: false` turns the hover off.
- How it works: the page has no access to Web Chat's React internals (CDN bundle), so a small pass matches each
  bubble's text to the message in Web Chat's store and puts the time in the status's tooltip. A message with only a
  card or file and no text may have no tooltip.
- Console: `AgentTime.scan()` (returns how many timestamps it labelled).
