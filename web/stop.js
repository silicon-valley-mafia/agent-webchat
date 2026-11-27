/* agent-webchat: "Stop showing this response" (TODO #4) + Web Chat 4.19 style-option compatibility.
 * Research (handoff/notes/2026-11-27-research-todo-1-4.md): Direct Line has no cancel / steer API for Copilot Studio,
 * so Stop is honest about what it does: it HIDES the rest of the current turn's replies on this page; the agent and
 * its tools may still be working, and the transcript log keeps everything.
 *  - A "⏹ Stop" button appears next to "Agent is working" (Esc does the same while it is visible).
 *  - Hidden: agent messages that reply to the stopped user message (replyToId), plus agent messages that arrive
 *    after Stop until you send your next message. "Show" in the banner brings them back.
 *  - Queued prompts (#35) are NOT released by Stop; they go when the agent really finishes (TODO #42 rule).
 * Installs by wrapping WebChat.createStore (tracks activities) and WebChat.renderWebChat (adds an activity
 * middleware in front of app.js's). app.js is unchanged. Off switch: stopButton: false in config.js.
 * Compat: Web Chat 4.19 deprecated bubbleMaxWidth (removal on/after 2026-10-08) in favour of
 * bubbleMessageMaxWidth / bubbleAttachmentMaxWidth; the renderWebChat wrapper copies the old value across. */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};

  /** Pure state machine, exported for tests. */
  function createState() {
    return { lastUserId: "", stopped: null, hidden: {}, stoppedIds: {} };
  }
  function isBot(a) { return !!(a && a.from && a.from.role === "bot"); }
  function isUser(a) { return !!(a && a.from && a.from.role === "user"); }
  /** Every incoming activity passes through here (store middleware). */
  function onIncoming(st, a) {
    if (!a) return;
    if (a.type === "message" && isUser(a) && a.id) { st.lastUserId = a.id; st.stopped = null; return; }
    if (a.type !== "message" || !isBot(a) || !a.id) return;
    if ((a.replyToId && st.stoppedIds[a.replyToId]) || st.stopped) st.hidden[a.id] = true;
  }
  function onUserSend(st) { st.stopped = null; }
  function stop(st) {
    st.stopped = { userId: st.lastUserId, at: Date.now() };
    if (st.lastUserId) st.stoppedIds[st.lastUserId] = true;
    return st.stopped;
  }
  function unhide(st) { st.hidden = {}; st.stoppedIds = {}; st.stopped = null; }
  function shouldHide(st, a) { return !!(a && a.id && st.hidden[a.id]); }

  /** Web Chat style options: keep the page's bubble width on 4.19+ (bubbleMaxWidth is deprecated there). */
  function compatStyle(o) {
    if (!o || typeof o.bubbleMaxWidth !== "number") return o;
    var out = {};
    for (var k in o) out[k] = o[k];
    if (out.bubbleMessageMaxWidth === undefined) out.bubbleMessageMaxWidth = o.bubbleMaxWidth;
    if (out.bubbleAttachmentMaxWidth === undefined) out.bubbleAttachmentMaxWidth = o.bubbleMaxWidth;
    return out;
  }
  function compose(outer, inner) {
    if (!inner) return outer;
    return function () {
      var a = outer.apply(this, arguments), b = inner.apply(this, arguments);
      return function (next) { return a(b(next)); };
    };
  }

  var api = { createState: createState, onIncoming: onIncoming, onUserSend: onUserSend, stop: stop, unhide: unhide,
    shouldHide: shouldHide, compatStyle: compatStyle, compose: compose };
  root.AgentStop = api;
  var W = root.WebChat, doc = root.document;
  if (!W || W.__awStop || !doc) return;
  try { W.__awStop = true; } catch (e) {}

  var st = createState();
  var store = null;
  api.state = function () { return st; };

  // ---- track activities (store middleware appended after app.js's) ----
  if (typeof W.createStore === "function") {
    var cs = W.createStore;
    W.createStore = function () {
      var args = Array.prototype.slice.call(arguments);
      if (!args.length) args.push({});
      args.push(function () {
        return function (next) {
          return function (action) {
            var t = action && action.type;
            if (t === "DIRECT_LINE/INCOMING_ACTIVITY" && action.payload) onIncoming(st, action.payload.activity);
            else if (t === "DIRECT_LINE/POST_ACTIVITY" && action.payload && action.payload.activity && action.payload.activity.type === "message") onUserSend(st);
            return next(action);
          };
        };
      });
      st = createState(); // new conversation / store
      store = cs.apply(this, args);
      return store;
    };
  }
  // ---- hide stopped replies (activity middleware in front of app.js's) + style compat ----
  var ours = function () {
    return function (next) {
      return function () {
        var card = arguments[0];
        if (cfg.stopButton !== false && card && shouldHide(st, card.activity)) return false;
        return next.apply(null, arguments);
      };
    };
  };
  if (typeof W.renderWebChat === "function") {
    var rw = W.renderWebChat;
    W.renderWebChat = function (props, el) {
      var p = {};
      for (var k in props) p[k] = props[k];
      p.activityMiddleware = compose(ours, props && props.activityMiddleware);
      p.styleOptions = compatStyle(props && props.styleOptions);
      return rw.call(this, p, el);
    };
  }
  if (cfg.stopButton === false) return;

  // ---- UI ----
  function refresh() { // same trick as app.js Clear chat: an invisible local event makes Web Chat re-run middleware
    if (!store) return;
    try {
      store.dispatch({ type: "DIRECT_LINE/INCOMING_ACTIVITY", payload: { activity: { type: "event", name: "aw/refresh",
        id: "aw-refresh-" + Date.now(), from: { id: "aw-page", role: "bot" }, timestamp: new Date().toISOString(), channelData: {} } } });
    } catch (e) {}
  }
  function banner(text, withShow) {
    var box = doc.getElementById("notice"), t = doc.getElementById("noticetext"), close = doc.getElementById("noticeclose");
    if (!box || !t) return;
    Array.prototype.slice.call(box.children).forEach(function (c) { if (c !== t && c !== close) c.remove(); });
    t.textContent = text;
    box.hidden = false;
    if (!withShow) return;
    var b = doc.createElement("button");
    b.type = "button";
    b.textContent = "Show";
    b.title = "Show the hidden replies again";
    b.addEventListener("click", function () { unhide(st); refresh(); box.hidden = true; t.textContent = ""; b.remove(); });
    box.insertBefore(b, close || null);
  }
  function doStop() {
    stop(st);
    refresh();
    banner("Stopped showing this response. The agent or its tools may still be working - your queued messages are sent when it really finishes. The full reply stays in the transcript.", true);
  }
  var work = doc.getElementById("workstate");
  if (!work || !work.parentNode) return;
  var btn = doc.createElement("button");
  btn.type = "button";
  btn.id = "stopbtn";
  btn.textContent = "⏹ Stop";
  btn.title = "Stop showing this response (Esc). The agent can't be cancelled from here - it may keep working.";
  btn.hidden = true;
  btn.addEventListener("click", doStop);
  work.parentNode.insertBefore(btn, work.nextSibling);
  var paint = function () { btn.hidden = work.hidden || !!st.stopped; };
  if (root.MutationObserver) new root.MutationObserver(paint).observe(work, { attributes: true, attributeFilter: ["hidden"] });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !btn.hidden && !e.defaultPrevented) { e.preventDefault(); doStop(); paint(); }
  });
  btn.addEventListener("click", paint);
})(typeof window !== "undefined" ? window : globalThis);
