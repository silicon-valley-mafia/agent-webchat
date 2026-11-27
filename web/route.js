/* agent-webchat: TODO #37b "➡ Pass on to Coach" toggle (brief: SPARK forwards such messages to the VLSI Coach).
 *
 * - Shown only in chats whose agent lists routes in the Worker's AGENTS registry, e.g.
 *     "spark": { ..., "routes": ["coach"] }     (the route id is what the agent receives; label from the agent list)
 * - When on, every message you send in that chat carries channelData.awRoute = "coach" (the agent decides what to do;
 *   SPARK forwards it). The page does not forward anything itself and costs no extra request.
 * - Fix 2026-11-28 (owner test): a Copilot Studio agent's AI never sees channelData (only a topic reading
 *   System.Activity.ChannelData can), so SPARK answered "I don't see that tag". The message text now also starts
 *   with a visible line "[route: coach]" that the agent's instructions can act on. routeMarker in config.js:
 *   "both" (default: text line + channelData), "text" (same; channelData is always added) or "channelData" (old way).
 * - Remembered per conversation (localStorage agentRoute), so it survives a reload and each chat keeps its own state.
 * - Messages queued while the agent works (#35) keep the state they had when you pressed Enter.
 * Off switch: routeToggle: false in web/config.js. app.js unchanged.
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var KEY = "agentRoute";
  var api = {};

  function ls(k, v) {
    try { if (v === undefined) return root.localStorage.getItem(k); if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  api.map = function () { try { return JSON.parse(ls(KEY) || "{}") || {}; } catch (e) { return {}; } };
  /** conversationId -> route id ("" = off). Keeps the newest 200. */
  api.set = function (conv, route) {
    if (!conv) return;
    var m = api.map();
    delete m[conv];
    if (route) m[conv] = route;
    var keys = Object.keys(m);
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(function (k) { delete m[k]; });
    ls(KEY, JSON.stringify(m));
  };
  api.get = function (conv) { return (conv && api.map()[conv]) || ""; };
  /** Pure: an outgoing message activity with the route added (never overrides one already set). */
  api.tag = function (activity, route, mode) {
    if (!route || !activity || activity.type !== "message") return activity;
    if (activity.channelData && activity.channelData.awRoute) return activity;
    var out = {};
    for (var k in activity) out[k] = activity[k];
    out.channelData = Object.assign({}, activity.channelData, { awRoute: route });
    // mode "both" / "text": a visible first line the agent's AI can read (it never sees channelData)
    if (mode === "both" || mode === "text") out.text = "[route: " + route + "]" + (activity.text ? "\n" + activity.text : "");
    return out;
  };
  /** Pure: conversation id from a Web Chat store state (first activity that has one). */
  api.convOf = function (state) {
    var acts = (state && state.activities) || [];
    for (var i = 0; i < acts.length; i++) if (acts[i] && acts[i].conversation && acts[i].conversation.id) return acts[i].conversation.id;
    return "";
  };
  root.AgentRoute = api;
  if (cfg.routeToggle === false) return;

  function current() { var A = root.__agentWebchat; return A && A.cur ? A.cur() : null; }
  function agentOf(conv) {
    var AA = root.AgentAgents, st = AA && AA.state ? AA.state() : null;
    if (!st || !st.agents) return null;
    var map = {};
    try { map = JSON.parse(ls("agentConvAgent") || "{}") || {}; } catch (e) {}
    var id = (conv && map[conv]) || st.current;
    for (var i = 0; i < st.agents.length; i++) if (st.agents[i].id === id) return st.agents[i];
    return null;
  }
  function nameOf(routeId) {
    var AA = root.AgentAgents, st = AA && AA.state ? AA.state() : null;
    var list = (st && st.agents) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === routeId) return list[i].name;
    return routeId === "coach" ? "Coach" : routeId;
  }

  // ---- outgoing messages: middleware placed BEFORE app.js's (so the queue keeps the tagged action) ----
  var W = root.WebChat;
  if (W && typeof W.createStore === "function" && !W.__awRoute) {
    try { W.__awRoute = true; } catch (e) {}
    var cs = W.createStore;
    W.createStore = function () {
      var args = Array.prototype.slice.call(arguments);
      if (!args.length) args.push({});
      var holder = {};
      args.splice(1, 0, function (storeApi) {
        return function (next) {
          return function (action) {
            if (action && action.type === "DIRECT_LINE/POST_ACTIVITY" && action.payload && action.payload.activity) {
              var s = current();
              var conv = s && s.store && s.store === holder.store ? s.conversationId : api.convOf(storeApi.getState());
              var route = api.get(conv);
              var a2 = api.tag(action.payload.activity, route, cfg.routeMarker || "both");
              if (a2 !== action.payload.activity) action = Object.assign({}, action, { payload: Object.assign({}, action.payload, { activity: a2 }) });
            }
            return next(action);
          };
        };
      });
      holder.store = cs.apply(this, args);
      return holder.store;
    };
  }

  // ---- the chip above the send box ----
  if (typeof document === "undefined") return;
  var chip = document.createElement("div");
  chip.id = "awroute";
  chip.hidden = true;
  chip.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 12px;font-size:13px";
  var label = document.createElement("label");
  label.style.cssText = "display:inline-flex;gap:6px;align-items:center;cursor:pointer;padding:2px 10px;border:1px solid #8885;border-radius:999px";
  var box = document.createElement("input");
  box.type = "checkbox";
  var text = document.createElement("span");
  label.appendChild(box);
  label.appendChild(text);
  chip.appendChild(label);
  var hint = document.createElement("span");
  hint.style.cssText = "opacity:.7";
  chip.appendChild(hint);
  var anchor = document.getElementById("staged") || document.getElementById("queued");
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(chip, anchor);
  else document.body.appendChild(chip);

  var shown = { conv: "", route: "" };
  box.addEventListener("change", function () {
    if (!shown.conv || !shown.route) return;
    api.set(shown.conv, box.checked ? shown.route : "");
    paint();
  });
  function paint() {
    var s = current();
    var conv = s && s.conversationId;
    var a = conv && agentOf(conv);
    var routes = a && Array.isArray(a.routes) ? a.routes : [];
    if (!conv || !routes.length) { chip.hidden = true; shown.conv = ""; return; }
    var route = routes[0];
    shown.conv = conv;
    shown.route = route;
    var on = api.get(conv) === route;
    box.checked = on;
    text.textContent = "➡ Pass on to " + nameOf(route);
    hint.textContent = on ? "on for this chat: every message is marked for " + nameOf(route) : "";
    label.style.background = on ? "#2563eb22" : "";
    chip.hidden = false;
  }
  setInterval(paint, 1000);
  api.paint = paint;
})(typeof window !== "undefined" ? window : globalThis);
