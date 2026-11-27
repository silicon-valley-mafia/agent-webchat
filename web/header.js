/* agent-webchat: TODO #51 - session header from the private config branch (docs/CONFIG.md).
 *
 * The Worker answers /token and /resume with header: {text, every} when the person's entry in the config branch has
 * one. This file puts that text on top of the first message of a chat and then of every N-th message
 * (every: 0 = first message only; every: 10 = messages 1, 11, 21, ...):
 *
 *   [session header]
 *   <text>
 *   [end of header]
 *
 *   <your message>
 *
 * It is plain text inside the message, so every agent gets it without a Copilot Studio change, and the transcript
 * shows it. Messages are counted per conversation in localStorage (agentHeaderCount), so a reload keeps the count.
 * How: wraps window.fetch (remembers the header per Direct Line token) and WebChat.createDirectLine (like role.js).
 * Off switch: sessionHeader: false in web/config.js. app.js is unchanged.
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var KEY = "agentHeaderCount";
  var MAX_CONV = 300;
  var byToken = {};
  var api = {};

  function ls(k, v) {
    try {
      var s = root.localStorage;
      if (!s) return null;
      if (v === undefined) return s.getItem(k);
      s.setItem(k, v);
    } catch (e) {}
    return null;
  }
  api.counts = function () { try { return JSON.parse(ls(KEY) || "{}") || {}; } catch (e) { return {}; } };
  /** Messages already sent in this conversation (through this page). */
  api.count = function (conv) { return (conv && api.counts()[conv]) || 0; };
  api.bump = function (conv) {
    if (!conv) return 0;
    var m = api.counts();
    var n = (m[conv] || 0) + 1;
    delete m[conv];
    m[conv] = n;
    var keys = Object.keys(m);
    for (var i = 0; i < keys.length - MAX_CONV; i++) delete m[keys[i]];
    ls(KEY, JSON.stringify(m));
    return n;
  };
  /** Pure: does the message after n sent ones get the header? */
  api.due = function (n, every) { return n === 0 || (every > 0 && n % every === 0); };
  /** Pure: a message activity with the header on top (anything else returned as it is). */
  api.wrap = function (activity, text) {
    if (!activity || activity.type !== "message" || !text) return activity;
    var out = {};
    for (var k in activity) out[k] = activity[k];
    out.text = "[session header]\n" + text + "\n[end of header]" + (activity.text ? "\n\n" + activity.text : "");
    return out;
  };
  api.remember = function (token, conv, header) {
    if (!token || !conv || !header || typeof header.text !== "string" || !header.text) return;
    var keys = Object.keys(byToken);
    if (keys.length > 20) delete byToken[keys[0]];
    var every = Number(header.every);
    byToken[token] = { conv: conv, text: header.text, every: every > 0 ? Math.floor(every) : 0 };
  };
  api.forToken = function (token) { return byToken[token] || null; };
  root.AgentHeader = api;
  if (cfg.sessionHeader === false) return;

  var base = cfg.tokenEndpoint && cfg.tokenEndpoint.indexOf("REPLACE_WITH") !== 0 ? cfg.tokenEndpoint.replace(/\/token\/?$/, "") : "";
  var origFetch = root.fetch;
  if (base && typeof origFetch === "function") {
    root.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var p = origFetch.apply(this, arguments);
      if (url !== base + "/token" && url !== base + "/resume") return p;
      return p.then(function (r) {
        if (!r || !r.ok || !r.clone) return r;
        return r.clone().json().then(function (j) {
          if (j && j.token && j.header) api.remember(j.token, j.conversationId, j.header);
          return r;
        }, function () { return r; });
      });
    };
  }

  var W = root.WebChat;
  if (W && typeof W.createDirectLine === "function") {
    var orig = W.createDirectLine;
    W.createDirectLine = function (opts) {
      var dl = orig.apply(this, arguments);
      var h = api.forToken(opts && opts.token);
      if (!h || !dl || typeof dl.postActivity !== "function") return dl;
      var post = dl.postActivity;
      dl.postActivity = function (activity) {
        if (activity && activity.type === "message") {
          if (api.due(api.count(h.conv), h.every)) activity = api.wrap(activity, h.text);
          api.bump(h.conv);
        }
        return post.call(dl, activity);
      };
      return dl;
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
