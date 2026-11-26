// Public configuration only - NO secrets here (this file is served publicly).
window.AGENT_WEBCHAT_CONFIG = {
  // Cloudflare Worker token endpoint (public URL, not a secret). Other endpoints are derived from it.
  tokenEndpoint: "https://agent-webchat-token.deepeshj-2k6.workers.dev/token",
  title: "GitHub Agent",
  locale: "en-US",

  // Look
  theme: "auto",              // "auto" (follow the device), "light" or "dark"; the 🌓 button overrides per browser
  accentColor: "#2563eb",     // your bubbles, avatars, buttons
  botAvatarInitials: "GH",
  userAvatarInitials: "",     // empty = initials of the person's name
  botAvatarImage: "",         // optional image URL, e.g. "https://avatars.githubusercontent.com/u/263164968"
  userAvatarImage: "",

  // Features
  voice: true,                // microphone button (Chrome / Edge speech recognition)
  notifications: true,        // 🔔 button: desktop notification when the agent replies in a background tab

  // Attachments (paperclip, paste, drag & drop) - see docs/README.md "Attachments"
  saveAttachments: true,      // commit every original to the Worker's ARTIFACT_REPO (artifacts-10)
  agentMaxFileMB: 3.8,        // per message to the agent; Direct Line rejects uploads over 4 MB
  agentMaxParts: 10,          // bigger files are not sent in chat (still saved to GitHub)
  agentFileTypes: ["docx", "csv", "pdf", "txt", "jpg", "jpeg", "png", "webp", "gif"] // others are zipped
};
