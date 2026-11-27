/* agent-webchat: session info panel (TODO #22) + remembered / recent sessions (TODO #33 step 1).
 * Moved out of app.js (size). app.js calls window.AgentSessions(deps) once and gets the functions back. */
(function () {
  "use strict";
  window.AgentSessions = function (D) {
    // ---- session info panel (TODO #22) ----
    /** Earliest server timestamp in the store (ignores our local aw/refresh events); 0 if none. */
    function firstActivityTime(s) {
      var first = 0;
      try {
        s.store.getState().activities.forEach(function (a) {
          if (a && a.type === "event" && a.name === "aw/refresh") return;
          var t = Date.parse((a && a.timestamp) || "");
          if (t && (!first || t < first)) first = t;
        });
      } catch (e) {}
      return first;
    }
    function showSession() {
      var s = D.current();
      if (!s) return;
      D.openPanel("This session");
      D.el.panelBody.innerHTML = "";
      var tz = D.cfg.logTimeZone || "Asia/Kolkata";
      var first = firstActivityTime(s);
      // P10: log/upload folders are dated by the conversation's FIRST activity, not by when this tab attached
      var day = D.U ? D.U.dayIn(new Date(first || s.startedAt), tz) : "";
      var msgs = 0;
      try { msgs = s.store.getState().activities.filter(function (a) { return a.type === "message"; }).length; } catch (e) {}
      var rows = [
        ["Conversation id (agent's System.Conversation.Id)", s.conversationId || "(not connected yet)", true],
        ["User id", s.userId, true],
        ["Person", s.name ? s.name + (s.admin ? " (admin)" : "") : "-"],
        ["Agent", D.TITLE],
        ["Started", first ? new Date(first).toLocaleString() : new Date(s.startedAt).toLocaleString()],
        ["Opened in this tab", new Date(s.startedAt).toLocaleString() + (s.resumed ? " (resumed)" : "")],
        ["Messages on screen", String(msgs)],
        ["Cleared at", D.clearedAt(s) ? new Date(D.clearedAt(s)).toLocaleString() : "-"]
      ];
      var doc = document.createElement("div");
      doc.className = "transcript";
      rows.forEach(function (r) {
        var row = document.createElement("div");
        row.className = "kv";
        var k = document.createElement("span");
        k.textContent = r[0];
        var v = document.createElement("code");
        v.textContent = r[1];
        row.appendChild(k);
        row.appendChild(v);
        if (r[2] && r[1]) {
          var b = D.button("Copy", function () { D.copyText(r[1], b); });
          b.className = "small";
          row.appendChild(document.createTextNode(" "));
          row.appendChild(b);
        }
        doc.appendChild(row);
      });
      var hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "To check it's the agent's own id: type /debug conversationid in the chat - the agent should answer with the same id.";
      doc.appendChild(hint);
      var links = [];
      if (D.cfg.logRepo !== "" && day) links.push(["Transcript folders for " + day, "https://github.com/" + (D.cfg.logRepo || "silicon-valley-mafia/agent-webchat-logs") + "/tree/main/logs/" + day]);
      if (D.cfg.artifactRepo !== "" && day) links.push(["Uploads for " + day, "https://github.com/" + (D.cfg.artifactRepo || "silicon-valley-mafia/agent-webchat-artifcats-1") + "/tree/main/webchat-uploads/" + day]);
      if (links.length) {
        var p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Private repos - links work only for people with access. Look for the folder ending in --" + (s.conversationId || "") + ":";
        doc.appendChild(p);
        links.forEach(function (l) {
          var a = document.createElement("a");
          a.href = l[1]; a.target = "_blank"; a.rel = "noopener"; a.textContent = l[0];
          var d = document.createElement("div");
          d.appendChild(a);
          doc.appendChild(d);
        });
      }
      D.el.panelBody.appendChild(doc);
    }

    // ---- remembered sessions (TODO #33 step 1) ----
    /**
     * TODO #33 step 1. sessionStorage = this tab's conversation (a refresh reopens THIS tab's chat even when another
     * tab started a newer one); localStorage = the newest in any tab (used by new tabs) + a "recent" list for History.
     */
    function rememberSession(s) {
      if (!s.conversationId) return;
      var rec = { conversationId: s.conversationId, userId: s.userId, at: Date.now() };
      var j = JSON.stringify(rec);
      localStorage.setItem(D.K.last, j);
      try { sessionStorage.setItem(D.K.last, j); } catch (e) {}
      var list = recentSessions().filter(function (r) { return r.conversationId !== rec.conversationId; });
      rec.name = s.name || "";
      list.unshift(rec);
      localStorage.setItem(D.K.recent, JSON.stringify(list.slice(0, D.RECENT_MAX)));
    }
    function lastSession() {
      var mineTab = null;
      try { mineTab = D.jsonGet(sessionStorage, D.K.last, null); } catch (e) {}
      return mineTab || D.jsonGet(localStorage, D.K.last, null);
    }
    function recentSessions() {
      var l = D.jsonGet(localStorage, D.K.recent, []);
      return Array.isArray(l) ? l.filter(function (r) { return r && r.conversationId; }) : [];
    }
    /** "On this browser" block at the top of History: continue any recent session without a Worker call. */
    function recentBlock(code) {
      var list = recentSessions();
      if (!list.length) return null;
      var box = document.createElement("div");
      box.className = "recent";
      var h = document.createElement("h3");
      h.textContent = "Recent on this browser";
      box.appendChild(h);
      list.forEach(function (r) {
        var row = document.createElement("div");
        row.className = "row";
        var here = D.current() && D.current().conversationId === r.conversationId;
        var label = document.createElement("span");
        label.textContent = new Date(r.at).toLocaleString() + "  ·  " + r.conversationId.slice(0, 10) + "…" + (here ? "  ·  open here" : "");
        label.title = "Session " + r.conversationId;
        row.appendChild(label);
        var b = D.button(here ? "Open" : "Continue", function () {
          if (here) { D.closePanel(); return; }
          D.resume(code, r.conversationId, r.userId).then(D.closePanel).catch(function (e) { D.notice(e.message); });
        });
        if (here) b.disabled = true;
        row.appendChild(b);
        box.appendChild(row);
      });
      return box;
    }
    return { firstActivityTime: firstActivityTime, showSession: showSession, rememberSession: rememberSession,
      lastSession: lastSession, recentSessions: recentSessions, recentBlock: recentBlock };
  };
})();
