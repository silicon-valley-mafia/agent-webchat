/* agent-webchat: TODO #7 - tell the agent the access code's role at the start of a conversation.
 *
 * The Worker decides the role (/token and /resume answer {role}: "owner" | "admin" | "user" | "readOnly"); the page
 * never chooses it. This file adds it to the "startConversation" event the page sends when a new chat opens:
 *   channelData.awRole = "<role>"   and   value.role = "<role>"
 * In Copilot Studio read it in the Conversation Start topic as System.Activity.ChannelData.awRole
 * (or System.Activity.Value.role).
 *
 * ADVISORY ONLY: the agent can't verify it (anyone can send events to Direct Line with a valid token); access control is
 * the Worker's per-code agent list + the ownership check (#49). See docs/AGENTS.md section 5.
 *
 * How: wraps window.fetch (remembers the role per Direct Line token) and WebChat.createDirectLine (adds the role to
 * that connection's startConversation event only; every other activity is untouched). app.js is unchanged.
 * Off switch: sendRole: false in web/config.js.
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var ROLES = { owner: 1, admin: 1, user: 1, readOnly: 1 };
  var byToken = {};
  var api = { roles: Object.keys(ROLES) };

  /** Pure: the startConversation event with the role added (other activities returned as they are). */
  api.tag = function (activity, role) {
    if (!activity || activity.type !== "event" || activity.name !== "startConversation" || !ROLES[role]) return activity;
    var value = activity.value && typeof activity.value === "object" ? activity.value : {};
    var out = {};
    for (var k in activity) out[k] = activity[k];
    out.channelData = Object.assign({}, activity.channelData, { awRole: role });
    out.value = Object.assign({}, value, { role: role });
    return out;
  };
  api.remember = function (token, role) {
    if (!token || !ROLES[role]) return;
    var keys = Object.keys(byToken);
    if (keys.length > 20) delete byToken[keys[0]];
    byToken[token] = role;
  };
  api.roleFor = function (token) { return byToken[token] || ""; };
  api.last = "";
  root.AgentRole = api;
  if (cfg.sendRole === false) return;

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
          if (j && j.token && ROLES[j.role]) { api.remember(j.token, j.role); api.last = j.role; }
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
      var role = api.roleFor(opts && opts.token);
      if (!role || !dl || typeof dl.postActivity !== "function") return dl;
      var post = dl.postActivity;
      dl.postActivity = function (activity) { return post.call(dl, api.tag(activity, role)); };
      return dl;
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
