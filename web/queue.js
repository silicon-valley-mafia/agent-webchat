/* agent-webchat: prompt queue (TODO #35). While the agent is still answering, new messages wait here instead of
 * being posted into a turn that is still running (overlapping turns lost replies, TODO #13). Each queued message is
 * sent on its own once the agent has gone quiet, in order, exactly once. app.js calls window.AgentQueue(deps).
 * deps: cfg, el, button, notice, current(), dispatch(s, action), restage(attachments), setSendBox(s, text). */
(function () {
  "use strict";
  window.AgentQueue = function (D) {
    var MAX_WAIT_MS = D.cfg.queueMaxWaitMs || 120000; // agent silent this long -> send the next one anyway
    var MAX_ITEMS = D.cfg.queueMaxItems || 10;
    var seq = 0;
    function enabled() { return D.cfg.queuePrompts !== false; }
    function items(s) { return (s && s.outbox) || []; }

    /** Returns true when the message was queued (the caller must then NOT pass it on). */
    function hold(s, action) {
      if (!enabled() || !s || !s.pendingSince || !action) return false;
      if (action.meta && action.meta.awQueued) return false;
      s.outbox = s.outbox || [];
      var act = action.payload.activity;
      if (s.outbox.length >= MAX_ITEMS) {
        // never drop input: give the text / files back to the user
        if (act.text) D.setSendBox(s, act.text);
        if (act.attachments && act.attachments.length) D.restage(act.attachments);
        D.notice("Queue is full (" + MAX_ITEMS + " messages) - your message is back in the send box. Wait for the agent or use \"Send next now\".", { autoHideMs: 15000 });
        return true;
      }
      s.outbox.push({ id: ++seq, action: action, text: String(act.text || ""), files: (act.attachments || []).length, at: Date.now() });
      arm(s);
      paint(s);
      return true;
    }
    function arm(s) {
      clearTimeout(s.queueTimer);
      if (!items(s).length) return;
      s.queueTimer = setTimeout(function () { release(s, true); }, MAX_WAIT_MS);
    }
    /** Sends the oldest queued message (marked so the store middleware lets it through). */
    function release(s, force) {
      if (!s || !items(s).length) return false;
      if (s.pendingSince && !force) return false;
      var it = s.outbox.shift();
      clearTimeout(s.queueTimer);
      paint(s);
      D.dispatch(s, Object.assign({}, it.action, { meta: Object.assign({}, it.action.meta, { awQueued: true }) }));
      arm(s);
      return true;
    }
    /** Cancel: the text goes back into the send box and the files back to the staged chips - nothing is lost. */
    function cancel(s, id) {
      var it = null;
      s.outbox = items(s).filter(function (x) { if (x.id === id) it = x; return x.id !== id; });
      if (!it) return;
      var act = it.action.payload.activity;
      if (act.text) D.setSendBox(s, act.text);
      if (act.attachments && act.attachments.length) D.restage(act.attachments);
      arm(s);
      paint(s);
    }
    /** Called when a session stops (New chat / Forget): tell the user what was not sent. */
    function drop(s) {
      var n = items(s).length;
      clearTimeout(s && s.queueTimer);
      if (!n) return 0;
      var texts = s.outbox.map(function (x) { return x.text; }).filter(Boolean);
      s.outbox = [];
      paint(s);
      D.notice(n + " queued message" + (n === 1 ? " was" : "s were") + " not sent" + (texts.length ? ": \"" + texts.join("\" / \"").slice(0, 200) + "\"" : "."), { autoHideMs: 60000 });
      return n;
    }
    function paint(s) {
      var box = D.el.queued;
      if (!box || (s && s !== D.current())) return;
      var list = items(s);
      box.innerHTML = "";
      box.hidden = !list.length;
      if (!list.length) return;
      var head = document.createElement("div");
      head.className = "bar";
      var t = document.createElement("span");
      t.className = "muted";
      t.textContent = "Queued - sent one at a time when the agent finishes (" + list.length + "):";
      head.appendChild(t);
      head.appendChild(D.button("Send next now", function () { release(s, true); }, "primary"));
      box.appendChild(head);
      var chips = document.createElement("div");
      chips.className = "chips";
      list.forEach(function (x, i) {
        var c = document.createElement("div");
        c.className = "chip";
        var l = document.createElement("span");
        l.textContent = (i + 1) + ". " + (x.text ? x.text.slice(0, 80) + (x.text.length > 80 ? "…" : "") : "(no text)") + (x.files ? " · 📎" + x.files : "");
        l.title = x.text;
        c.appendChild(l);
        var b = D.button("✕", function () { cancel(s, x.id); }, "x");
        b.title = "Cancel - put it back in the send box";
        b.setAttribute("aria-label", "Cancel queued message " + (i + 1));
        c.appendChild(b);
        chips.appendChild(c);
      });
      box.appendChild(chips);
    }
    return { enabled: enabled, hold: hold, release: release, cancel: cancel, drop: drop, paint: paint, items: items };
  };
})();
