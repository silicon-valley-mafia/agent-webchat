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

  // Agent turns, multiple agents, Stop (each feature lives in its own file; false = old behaviour)
  multiAgent: true,           // web/agents.js - agent picker when the Worker offers 2+ agents (docs/AGENTS.md)
  turnHints: true,            // web/turns.js - progress notes don't end "Agent is working" (TODO #42)
  interimGraceMs: 120000,     // after a progress note, wait this long for the final reply before giving up
  debugActivities: true,      // web/turns.js - keep activity metadata (no text) for AgentTurn.summary() in DevTools
  stopButton: true,           // web/stop.js - "⏹ Stop" hides the rest of the current reply (TODO #4)
  voiceDiagnostics: true,     // web/voice.js - explain why dictation gave no text
  groupChat: true,            // web/group.html - 🧪 Group button: one prompt to several agents (TODO #43, experimental)
  groupMaxAgents: 4,          // most agents in one group (2-6); every prompt costs one agent turn per agent

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
