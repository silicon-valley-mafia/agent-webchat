// Public configuration only - NO secrets here (this file is served publicly).
// If the repo variable TOKEN_ENDPOINT is set, the Pages workflow only replaces the
// placeholder; a real URL committed here is used as-is.
window.AGENT_WEBCHAT_CONFIG = {
  // Cloudflare Worker token endpoint (public URL, not a secret)
  tokenEndpoint: "https://agent-webchat-token.deepeshj-2k6.workers.dev/token",
  title: "GitHub Agent",
  locale: "en-US",
};
