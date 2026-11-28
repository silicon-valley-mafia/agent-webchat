/* agent-webchat: TODO #45 (starter prompts) + TODO #47 (hand-off button). Loaded before app.js; app.js is unchanged.
 *
 * #45 Starter prompts: an agent may list "starters" (up to 6 short prompts) in the config repo's "agents" block or in
 *     the AGENTS secret; the Worker passes them on in POST /agents. While the open chat has no message from you yet,
 *     they show as chips above the send box; a click sends that prompt (through the normal send path, so the queue,
 *     the session header and logging all apply). Agents without starters show nothing.
 *     Off switch: starterPrompts: false in web/config.js.
 * #47 Hand-off button: "📝 Hand-off" in the header sends handoffText (default "End of session. Write the hand-off
 *     file now.") as a normal message, so it is logged like any other; agents answer with an HO-YYYYMMDD-NN id.
 *     Asks for confirmation first. Off switch: handoffButton: false.
 * Console: AgentStarters.state().
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var MAX = 6;
  var HANDOFF = "End of session. Write the hand-off file now.";
  var api = {};

  /** Pure: a clean list of starter prompts (strings, trimmed, non-empty, at most 6, each at most 300 characters). */
  api.clean = function (list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX; i++) {
      var t = typeof list[i] === "string" ? list[i].trim() : "";
      if (t && t.length <= 300 && out.indexOf(t) < 0) out.push(t);
    }
    return out;
  };
  /** Pure: true when the activity list has no message sent by the user. */
  api.isEmpty = function (activities) {
    var a = activities || [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x && x.type === "message" && x.from && x.from.role === "user") return false;
    }
    return true;
  };

  function app() { return root.__agentWebchat || null; }
  function cur() { var a = app(); return a && a.cur ? a.cur() : null; }
  /** Agent of the open chat: the one remembered for its conversation (web/agents.js), else the current pick. */
  function agentOf(s) {
    var A = root.AgentAgents;
    var st = A && A.state ? A.state() : null;
    if (!st || !st.enabled) return null;
    var map = {};
    try { map = JSON.parse(root.localStorage.getItem("agentConvAgent") || "{}") || {}; } catch (e) {}
    var id = (s && s.conversationId && map[s.conversationId]) || st.current || st.selected;
    for (var i = 0; i < st.agents.length; i++) if (st.agents[i].id === id) return st.agents[i];
    return null;
  }
  api.agentOf = agentOf;
  function visibleBox() {
    var all = root.document.querySelectorAll(".webchat__send-box-text-box__html-text-area, .webchat__send-box-text-box__input, .webchat__send-box textarea, .webchat__send-box input[type='text']");
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) return all[i];
    return all[0] || null;
  }
  /** Puts text in the visible send box and presses Send (the normal path: queue, header, logging). */
  api.send = function (text) {
    var box = visibleBox();
    if (!box) return false;
    var s = cur();
    if (s && s.store && typeof s.store.dispatch === "function") {
      s.store.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: text } });
    } else {
      var proto = box.tagName === "TEXTAREA" ? root.HTMLTextAreaElement : root.HTMLInputElement;
      var desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value");
      if (desc && desc.set) desc.set.call(box, text); else box.value = text;
      box.dispatchEvent(new root.Event("input", { bubbles: true }));
    }
    var scope = (box.closest && box.closest(".webchat__send-box")) || root.document;
    var btn = scope.querySelector(".webchat__send-button");
    setTimeout(function () {
      if (btn) btn.click();
      else box.dispatchEvent(new root.KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }, 0);
    return true;
  };

  root.AgentStarters = api;
  var doc = root.document;
  if (!doc || typeof root.MutationObserver !== "function") return;

  var css = doc.createElement("style");
  css.textContent =
    "#aw-starters{display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px 2px;justify-content:center}" +
    "#aw-starters[hidden]{display:none}" +
    ".aw-starter{font:inherit;font-size:13px;padding:4px 12px;border-radius:14px;border:1px solid currentColor;" +
    "background:transparent;color:inherit;cursor:pointer;max-width:100%;text-align:left;opacity:.85}.aw-starter:hover{opacity:1}";
  (doc.head || doc.documentElement).appendChild(css);

  var shown = "";
  function paintStarters() {
    var bar = doc.getElementById("aw-starters");
    if (cfg.starterPrompts === false) return;
    var s = cur();
    var a = agentOf(s);
    var list = a ? api.clean(a.starters) : [];
    var empty = false;
    try { empty = !!(s && s.store && api.isEmpty(s.store.getState().activities)); } catch (e) {}
    var b0 = visibleBox();
    var sendBox = b0 && b0.closest ? b0.closest(".webchat__send-box") : null;
    if (!list.length || !empty || !sendBox) { if (bar) bar.hidden = true; shown = ""; return; }
    var key = (s.conversationId || "") + "|" + list.join("\u0000");
    if (bar && shown === key && bar.nextSibling === sendBox && !bar.hidden) return;
    if (!bar) { bar = doc.createElement("div"); bar.id = "aw-starters"; bar.setAttribute("aria-label", "Starter prompts"); }
    bar.innerHTML = "";
    list.forEach(function (t) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "aw-starter";
      b.textContent = t;
      b.title = "Send: " + t;
      b.addEventListener("click", function () { bar.hidden = true; api.send(t); });
      bar.appendChild(b);
    });
    if (bar.nextSibling !== sendBox) sendBox.parentNode.insertBefore(bar, sendBox);
    bar.hidden = false;
    shown = key;
  }

  function paintHandoff() {
    if (cfg.handoffButton === false) return;
    var b = doc.getElementById("handoffbtn");
    var s = cur();
    if (!b) {
      var anchor = doc.getElementById("download");
      if (!anchor || !anchor.parentNode) return;
      b = doc.createElement("button");
      b.id = "handoffbtn";
      b.type = "button";
      b.textContent = "\uD83D\uDCDD Hand-off";
      b.title = "Ask the agent to write its hand-off file now (sent as a normal message)";
      b.addEventListener("click", function () {
        var text = cfg.handoffText || HANDOFF;
        if (root.confirm && !root.confirm("Send to the agent:\n\n" + text)) return;
        api.send(text);
      });
      anchor.parentNode.insertBefore(b, anchor);
    }
    b.hidden = !(s && s.conversationId);
  }

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; paintStarters(); paintHandoff(); }, 200);
  }
  api.state = function () {
    var s = cur(), a = agentOf(s);
    return { agent: a ? a.id : null, starters: a ? api.clean(a.starters) : [], shown: !!shown, handoff: cfg.handoffButton !== false };
  };
  function start() {
    var target = doc.getElementById("app") || doc.body;
    new root.MutationObserver(schedule).observe(target, { childList: true, subtree: true });
    setInterval(schedule, 3000); // the agent list can arrive after the first paint
    schedule();
  }
  if (doc.body) start(); else doc.addEventListener("DOMContentLoaded", start);
})(typeof window !== "undefined" ? window : globalThis);
