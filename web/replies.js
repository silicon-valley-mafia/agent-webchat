/* agent-webchat: per-reply tools (Copy, Copy MD, Expand, Hide; TODO #17 / #19) and the collapse plan.
 * Moved out of app.js unchanged (Batch A step 0: app.js was ~1 KB below the push limit).
 * window.AgentReplies(ctx) -> { rememberReply, decorate, scheduleDecorate, setAll, copyText } */
(function () {
  "use strict";
  window.AgentReplies = function (ctx) {
    var U = ctx.U, K = ctx.K, el = ctx.el, jsonGet = ctx.jsonGet, button = ctx.button;
    var PREVIEW_PX = ctx.PREVIEW_PX, KEEP_EXPANDED = ctx.KEEP_EXPANDED;
    // ---------------- replies: copy (TODO #17) + collapse (TODO #19) ----------------
    function rememberReply(s, a) {
      if (s.replyIndex[a.id]) { s.replyIndex[a.id].text = a.text; s.replyIndex[a.id].key = U ? U.letterKey(a.text) : ""; return; }
      var r = { id: a.id, text: a.text, key: U ? U.letterKey(a.text) : "", ts: a.timestamp };
      s.replyIndex[a.id] = r;
      s.replies.push(r);
    }
    function manualStates(s) { return jsonGet(sessionStorage, K.collapse + (s.conversationId || ""), {}); }
    function setManual(s, id, state) {
      var m = manualStates(s);
      if (state) m[id] = state; else delete m[id];
      try { sessionStorage.setItem(K.collapse + (s.conversationId || ""), JSON.stringify(m)); } catch (e) {}
    }
    function copyText(text, btn) {
      var done = function () {
        var old = btn.textContent;
        btn.textContent = "Copied ✓";
        setTimeout(function () { btn.textContent = old; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text) && done(); });
      }
      if (legacyCopy(text)) done();
      return Promise.resolve();
    }
    function legacyCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      return ok;
    }
    function bubbleContent(b) { return b.querySelector(".webchat__bubble__content") || b; }
    function visibleText(b) { return (bubbleContent(b).innerText || "").trim(); }
    function replyMarkdown(s, b) {
      var r = b.__awId && s.replyIndex[b.__awId];
      return r ? r.text : visibleText(b);
    }

    function addTools(s, b) {
      var bar = document.createElement("div");
      bar.className = "aw-tools";
      var stub = document.createElement("span");
      stub.className = "aw-stub";
      bar.appendChild(stub);
      var cp = button("Copy", function () { copyText(visibleText(b), cp); }, "aw-copy");
      cp.title = "Copy as plain text"; cp.setAttribute("aria-label", "Copy reply as plain text");
      var md = button("Copy MD", function () { copyText(replyMarkdown(s, b), md); }, "aw-copy");
      md.title = "Copy the original Markdown"; md.setAttribute("aria-label", "Copy reply as Markdown");
      var tg = button("Expand", function () {
        var st = b.__awState === "expanded" ? "collapsed" : "expanded";
        setManual(s, b.__awId, st);
        decorate(s);
      }, "aw-toggle");
      var hd = button("Hide", function () {
        setManual(s, b.__awId, b.__awState === "hidden" ? "expanded" : "hidden");
        decorate(s);
      }, "aw-hide");
      [cp, md, tg, hd].forEach(function (x) { bar.appendChild(x); });
      b.appendChild(bar);
      b.__awTools = { bar: bar, stub: stub, toggle: tg, hide: hd };
    }

    /** Finds bot bubbles in the transcript, adds the tool bar once, then applies the collapse plan. */
    function decorate(s) {
      if (!s || !s.mount || s !== ctx.current()) return;
      var bubbles = Array.prototype.slice.call(s.mount.querySelectorAll(".webchat__bubble:not(.webchat__bubble--from-user)"));
      var used = {}, ids = [], long = {}, byId = {};
      bubbles.forEach(function (b) { if (b.__awId && b.__awId.indexOf("dom-") !== 0) used[b.__awId] = true; });
      bubbles.forEach(function (b) {
        var text = visibleText(b);
        if (!text && !b.__awTools) return;
        if (!b.__awId || b.__awId.indexOf("dom-") === 0) {
          var id = U ? U.matchReply(text, s.replies, used) : null;
          if (id) used[id] = true;
          b.__awId = id || "dom-" + (U ? U.letterKey(text, 60) : text.slice(0, 60));
        }
        if (!b.__awTools) addTools(s, b);
        ids.push(b.__awId);
        byId[b.__awId] = b;
        var c = bubbleContent(b);
        long[b.__awId] = c.scrollHeight > PREVIEW_PX + 40;
      });
      var plan = U ? U.collapsePlan(ids, KEEP_EXPANDED, manualStates(s), long) : {};
      ids.forEach(function (id) {
        var b = byId[id], st = plan[id] || "expanded", c = bubbleContent(b), t = b.__awTools;
        b.__awState = st;
        c.classList.toggle("aw-collapsed", st === "collapsed");
        c.classList.toggle("aw-hidden", st === "hidden");
        c.style.setProperty("--aw-preview", PREVIEW_PX + "px");
        t.toggle.hidden = !long[id] || st === "hidden";
        t.toggle.textContent = st === "collapsed" ? "Show more" : "Show less";
        t.toggle.setAttribute("aria-expanded", st === "expanded" ? "true" : "false");
        t.hide.textContent = st === "hidden" ? "Show" : "Hide";
        var lines = (visibleText(b).match(/\n/g) || []).length + 1;
        t.stub.textContent = st === "hidden" ? "Reply hidden · " + lines + " line" + (lines === 1 ? "" : "s") : "";
      });
      if (el.expandAll) el.expandAll.hidden = !ids.some(function (id) { return long[id]; });
    }
    function scheduleDecorate(s) {
      clearTimeout(s.decorateTimer);
      s.decorateTimer = setTimeout(function () { decorate(s); }, 120);
    }
    function setAll(s, state) {
      var m = manualStates(s);
      Array.prototype.forEach.call(s.mount.querySelectorAll(".webchat__bubble:not(.webchat__bubble--from-user)"), function (b) {
        if (b.__awId) m[b.__awId] = state;
      });
      try { sessionStorage.setItem(K.collapse + (s.conversationId || ""), JSON.stringify(m)); } catch (e) {}
      decorate(s);
    }

    return { rememberReply: rememberReply, decorate: decorate, scheduleDecorate: scheduleDecorate, setAll: setAll, copyText: copyText };
  };
})();
