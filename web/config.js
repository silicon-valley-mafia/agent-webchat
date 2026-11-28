// Public configuration only - NO secrets here (this file is served publicly).
window.AGENT_WEBCHAT_CONFIG = {
  // Cloudflare Worker token endpoint (public URL, not a secret). Other endpoints are derived from it.
  tokenEndpoint: "https://agent-webchat-token.deepeshj-2k6.workers.dev/token",
  title: "GitHub Agent",
  locale: "en-US",

  // Look
  theme: "auto",              // "auto" (follow the device), "light" or "dark"; the 🌓 button overrides per browser
  skin: "classic",            // "classic", "focus" (centered, no reply bubbles) or "contrast" (high contrast); the 🎨 button overrides per browser
  layout: "wide",             // "wide" (full window width) or "narrow" (960 px column); the ↔ button overrides per browser
  accentColor: "#2563eb",     // your bubbles, avatars, buttons
  botAvatarInitials: "GH",
  userAvatarInitials: "",     // empty = initials of the person's name
  botAvatarImage: "",         // optional image URL, e.g. "https://avatars.githubusercontent.com/u/263164968"
  userAvatarImage: "",

  // Features
  voice: true,                // microphone button (Chrome / Edge speech recognition)
  notifications: true,        // 🔔 button: desktop notification when the agent replies in a background tab
  multilineInput: true,       // Enter sends, Shift+Enter adds a new line
  expandedRecentReplies: 3,   // the latest N agent replies are shown in full; older long ones are collapsed
  escapeAngleBrackets: true,  // show "<id>"-style text in replies instead of letting it vanish
  exactTimeOnHover: true,     // web/timestamps.js - hover "5 minutes ago" to see the exact date and time (TODO #36)
  timestampMode: "both",      // "both" = "03:05 · 8 minutes ago" (TODO #57), "relative" = only "5 minutes ago", "absolute" = Web Chat's exact time
  timeFormat: "",             // "" = browser locale, "24h" or "12h" for the time shown on messages (#57)

  // Agent turns, multiple agents, Stop (each feature lives in its own file; false = old behaviour)
  multiAgent: true,           // web/agents.js - agent picker when the Worker offers 2+ agents (docs/AGENTS.md)
  turnHints: true,            // web/turns.js - progress notes don't end "Agent is working" (TODO #42)
  interimGraceMs: 120000,     // after a progress note, wait this long for the final reply before giving up
  debugActivities: true,      // web/turns.js - keep activity metadata (no text) for AgentTurn.summary() in DevTools
  stopButton: true,           // web/stop.js - "⏹ Stop" hides the rest of the current reply (TODO #4)
  voiceDiagnostics: true,     // web/voice.js - explain why dictation gave no text
  groupChat: true,            // web/group.html - 🧪 Group button: one prompt to several agents (TODO #43, experimental)
  groupMaxAgents: 4,          // most agents in one group (2-6); every prompt costs one agent turn per agent
  sessionRail: true,          // web/rail.js - ☰ Chats sidebar: several conversations (any agent) stay open, switch instantly (TODO #23)
  liveSessions: 4,            // conversations kept connected at once in one tab (current + 3); the oldest idle one closes first
  sendRole: true,             // web/role.js - tell the agent the code's role (owner/admin/user/readOnly) at chat start; advisory (TODO #7)
  insertFile: true,           // web/insert.js - 📄 File: insert a .md/.txt from an allowed repo path into the message (TODO #37a)
  routeToggle: true,          // web/route.js - "➡ Pass on to Coach" chip for agents with "routes" in AGENTS (TODO #37b)
  routeMarker: "both",        // "both" = visible "[route: coach]" first line + channelData (the agent's AI only sees text); "channelData" = old way
  sessionHeader: true,        // web/header.js - your session header from the private config branch on message 1, then every N (TODO #51)
  copyPrompt: true,           // web/copyprompt.js - Copy / Reuse under the messages you send (TODO #50)
  starterPrompts: true,       // web/starters.js - prompt chips on an empty chat, for agents with "starters" (TODO #45)
  handoffButton: true,        // web/starters.js - 📝 Hand-off button: asks the agent to write its hand-off file (TODO #47)
  handoffText: "End of session. Write the hand-off file now.",
  planBoard: true,            // web/planboard.js - task table + "Run next task" for YAML plans in replies (TODO #46)
  planBoardAgents: ["conductor"], // agents with the plan board (the Worker can also mark one with "plans": true)
  historyFilter: true,        // web/historyfilter.js - filter History by agent (TODO #20)
  gfmMarkdown: true,          // web/gfm.js - GitHub-style Markdown look for replies, prompts and History (TODO #56)
  userMarkdown: true,         // web/gfm.js - your prompts rendered as Markdown in a blue theme (false = plain text) (#56b)
  agentColors: true,          // web/gfm.css - one background tint per agent column in group chat (#56c)
  codeCopyButtons: true,      // web/gfm.js - Copy button on every code block (TODO #58)

  // Session panel (ⓘ) links - private repos, links only work for people with access
  logTimeZone: "Asia/Kolkata",
  logRepo: "silicon-valley-mafia/agent-webchat-logs",
  artifactRepo: "silicon-valley-mafia/agent-webchat-artifcats-1",

  // Attachments (paperclip, paste, drag & drop) - see docs/README.md "Attachments"
  stageAttachments: true,     // files wait above the send box and go out WITH the typed message (false = send at once)
  saveAttachments: true,      // commit every original to the Worker's ARTIFACT_REPO (agent-webchat-artifcats-1)
  agentMaxFileMB: 3.8,        // per message to the agent; Direct Line rejects uploads over 4 MB
  agentMaxParts: 10,          // bigger files are not sent in chat (still saved to GitHub)
  agentFileTypes: ["docx", "csv", "pdf", "txt", "jpg", "jpeg", "png", "webp", "gif"] // others are zipped
};
