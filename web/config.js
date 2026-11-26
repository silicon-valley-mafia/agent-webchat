// Public configuration only - NO secrets here (this file is served publicly).
window.AGENT_WEBCHAT_CONFIG = {
  // URL of the deployed Cloudflare Worker token endpoint, e.g.
  // "https://agent-webchat-token.<your-subdomain>.workers.dev/token"
  tokenEndpoint: "REPLACE_WITH_WORKER_URL/token",
  title: "GitHub Agent",
  locale: "en-US",
};
