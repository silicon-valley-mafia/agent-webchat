/* agent-webchat: session sidebar (TODO #23 / #33 step 2). Loaded before app.js.
 * Like the chat list in ChatGPT / Claude / Copilot: every conversation you open in this tab stays alive while you
 * look at another one, with any agent. Switching back is instant - same Direct Line connection and store, no
 * reconnect (/resume), nothing replayed, replies that arrived meanwhile are already there (unread dot + notification).
 * - "Open in this tab": live conversations (up to liveSessions, default 4; the oldest idle one is closed when a
 *   new one would go over - it stays under Recent). Working spinner / unread count per conversation, ✕ to close.
 * - "Recent": conversations remembered on this browser (TODO #33 step 1); click = continue (one /resume).
 * - "+ New chat" with an agent picker (TODO #20). Title = your first message in that conversation.
 * - Keys: Alt+Up / Alt+Down switch between open conversations; Alt+N new chat. ☰ toggles the sidebar.
 * app.js hooks: AgentRail.park(s, nextConversationId) when it would end a session; __agentWebchat.swap/stop/resume/cur.
 * Off switch: sessionRail: false in config.js (app.js then ends the old conversation as before). */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var MAX_LIVE = Math.max(1, Math.min(Number(cfg.liveSessions) || 4, 8));
  var K = { open: "agentRailOpen", meta: "agentRailMeta", conv: "agentConvAgent", sel: "agentSelected", code: "agentAccessCode", recent: "agentRecentSessions" };
  var META_MAX = 200;

  /* ---------- pure helpers (tested in worker/test/rail.test.js) ---------- */
  /** One-line title from the first thing you typed. */
  function snippet(text, max) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    max = max || 48;
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
  }
  /** Which parked sessions to close so that parked + the current one fit in max: idle ones first, oldest first. */
  function evictions(parked, max) {
    var over = parked.length + 1 - max;
    if (over <= 0) return [];
    return parked.slice().sort(function (a, b) {
      var wa = a.working ? 1 : 0, wb = b.working ? 1 : 0;
      return wa - wb || (a.lastAt || 0) - (b.lastAt || 0);
    }).slice(0, over);
  }
  /** Sidebar sections: live ones (current first, then newest activity) and recent ones that aren't live. */
  function sections(live, recent, currentId) {
    var ids = {};
    var l = live.slice().sort(function (a, b) {
      if (a.conversationId === currentId) return -1;
      if (b.conversationId === currentId) return 1;
      return (b.lastAt || 0) - (a.lastAt || 0);
    });
    l.forEach(function (x) { ids[x.conversationId] = 1; });
    var r = (recent || []).filter(function (x) { return x && x.conversationId && !ids[x.conversationId]; });
    return { live: l, recent: r };
  }
  /** Relative time, short: "now", "5m", "3h", "2d". */
  function ago(t, now) {
    var s = Math.max(0, ((now || Date.now()) - (t || 0)) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function trimMeta(m, max) {
    var keys = Object.keys(m);
    if (keys.length <= max) return m;
    keys.sort(function (a, b) { return (m[a].at || 0) - (m[b].at || 0); });
    keys.slice(0, keys.length - max).forEach(function (k) { delete m[k]; });
    return m;
  }
  var api = { snippet: snippet, evictions: evictions, sections: sections, ago: ago, trimMeta: trimMeta, MAX_LIVE: MAX_LIVE };
  root.AgentRail = api;

  var doc = root.document;
  if (!doc || cfg.sessionRail === false || !doc.getElementById("app")) return;

  var parked = [];
  var els = {};
  function App() { return root.__agentWebchat || null; }
  function cur() { var a = App(); return a && a.cur ? a.cur() : null; }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function jget(k, d) { try { return JSON.parse(ls(k) || "null") || d; } catch (e) { return d; } }
  function meta() { return jget(K.meta, {}); }
  function setMeta(id, patch) {
    if (!id) return;
    var m = meta();
    var x = m[id] || {};
    for (var k in patch) if (patch[k] !== undefined) x[k] = patch[k];
    m[id] = x;
    ls(K.meta, JSON.stringify(trimMeta(m, META_MAX)));
  }
  function agents() { var A = root.AgentAgents; var st = A && A.state ? A.state() : null; return (st && st.agents) || []; }
  function agentOf(conversationId) {
    var id = jget(K.conv, {})[conversationId];
    var list = agents();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return id ? { id: id, name: id } : (list[0] || null);
  }
  function initials(a) { return (a && (a.initials || (a.name || "").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase())) || "AI"; }

  /* ---------- tracking each live session ---------- */
  function watch(s) {
    if (!s || s.__rail || !s.directLine) return;
    s.__rail = { lastAt: Date.now(), unread: 0 };
    var sub = s.directLine.activity$.subscribe({
      next: function (a) {
        if (!a || a.type !== "message") return;
        var r = s.__rail;
        var mineMsg = a.from && (a.from.id === s.userId || a.from.role === "user");
        var t = Date.parse(a.timestamp || "") || Date.now();
        if (t > r.lastAt) r.lastAt = t;
        if (s.conversationId) {
          var m = meta()[s.conversationId] || {};
          var patch = { at: Math.max(m.at || 0, t) };
          if (mineMsg && !m.title && a.text) patch.title = snippet(a.text);
          setMeta(s.conversationId, patch);
        }
        if (!mineMsg && s !== cur() && t > (s.__rail.parkedAt || 0)) r.unread++;
        schedulePaint();
      }
    });
    if (s.subs) s.subs.push(sub);
  }

  /** app.js: called instead of ending `s` when another conversation is about to be shown. */
  api.park = function (s, nextConversationId) {
    if (!s || !s.mount || !s.conversationId || !els.parked) return false;
    // the conversation being opened may already be parked (e.g. History -> Continue): drop that copy
    parked = parked.filter(function (p) {
      if (nextConversationId && p.conversationId === nextConversationId) { closeLive(p, true); return false; }
      return p !== s;
    });
    watch(s);
    s.__rail.parkedAt = Date.now();
    els.parked.appendChild(s.mount);
    parked.push(s);
    evictions(parked.map(info), MAX_LIVE).forEach(function (x) { closeLive(x.s); });
    schedulePaint();
    return true;
  };
  function info(s) { return { s: s, conversationId: s.conversationId, working: !!s.pendingSince, lastAt: s.__rail ? s.__rail.lastAt : 0 }; }
  function closeLive(s, quiet) {
    parked = parked.filter(function (p) { return p !== s; });
    var a = App();
    if (a && a.stop) a.stop(s, true);
    if (s.mount && s.mount.parentNode) s.mount.parentNode.removeChild(s.mount);
    if (!quiet) schedulePaint();
  }
  function showAgentFor(s) {
    var ag = agentOf(s.conversationId);
    if (!ag) return;
    var h = doc.getElementById("title");
    if (h && ag.name) h.textContent = ag.name;
    if (ag.name) { doc.title = ag.name; cfg.title = ag.name; }
    if (ag.initials) cfg.botAvatarInitials = ag.initials;
    var pick = doc.getElementById("agentpick");
    if (pick && ag.id) pick.value = ag.id;
  }
  function open(s) {
    var a = App();
    if (!a || !a.swap || s === cur()) return;
    parked = parked.filter(function (p) { return p !== s; });
    if (s.__rail) s.__rail.unread = 0;
    showAgentFor(s);
    a.swap(s);
    afterSwitch();
  }
  function continueRecent(r) {
    var a = App(), code = ls(K.code);
    if (!a || !a.resume || !code) return;
    a.resume(code, r.conversationId, r.userId).then(afterSwitch, function (e) {
      var n = doc.getElementById("noticetext");
      if (n) { n.textContent = "Couldn't continue that conversation: " + ((e && e.message) || "error"); n.parentNode.hidden = false; }
    });
  }
  function newChat(agentId) {
    if (agentId) ls(K.sel, agentId);
    var b = doc.getElementById("newchat");
    if (b && !b.disabled) b.click();
    afterSwitch();
  }
  function afterSwitch() {
    schedulePaint();
    if (root.matchMedia && root.matchMedia("(max-width: 900px)").matches) setOpen(false);
  }
  function liveList() {
    var c = cur(), out = parked.slice();
    if (c && c.conversationId) { watch(c); out.unshift(c); }
    out.forEach(titleFromStore);
    return out;
  }
  /** Title = first message you typed; read from the session's own store (also covers messages before watch()). */
  function titleFromStore(s) {
    if (!s.conversationId || (meta()[s.conversationId] || {}).title) return;
    try {
      var acts = s.store.getState().activities;
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        if (a && a.type === "message" && a.text && a.from && (a.from.role === "user" || a.from.id === s.userId)) {
          setMeta(s.conversationId, { title: snippet(a.text), at: Date.parse(a.timestamp || "") || Date.now() });
          return;
        }
      }
    } catch (e) {}
  }

  /* ---------- UI ---------- */
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function setOpen(on) {
    doc.documentElement.setAttribute("data-rail", on ? "open" : "closed");
    ls(K.open, on ? "1" : "0");
    if (els.btn) els.btn.setAttribute("aria-expanded", on ? "true" : "false");
  }
  function build() {
    els.parked = el("div");
    els.parked.id = "railparked";
    els.parked.hidden = true;
    doc.body.appendChild(els.parked);

    els.aside = el("aside");
    els.aside.id = "rail";
    els.aside.setAttribute("aria-label", "Conversations");
    var head = el("div", "railhead");
    head.appendChild(el("strong", "", "Chats"));
    els.agent = el("select");
    els.agent.id = "railagent";
    els.agent.setAttribute("aria-label", "Agent for the new chat");
    els.agent.hidden = true;
    var nb = el("button", "primary", "+ New chat");
    nb.type = "button";
    nb.title = "New chat (Alt+N) - your other chats stay open";
    nb.addEventListener("click", function () { newChat(els.agent.hidden ? "" : els.agent.value); });
    head.appendChild(els.agent);
    head.appendChild(nb);
    els.aside.appendChild(head);
    els.list = el("div", "raillist");
    els.aside.appendChild(els.list);
    var foot = el("div", "railfoot muted", "Open chats stay connected while you look at another one (max " + MAX_LIVE + "). Alt+↑/↓ to switch.");
    els.aside.appendChild(foot);
    doc.body.insertBefore(els.aside, doc.body.firstChild);

    els.btn = el("button", "", "☰");
    els.btn.id = "railbtn";
    els.btn.type = "button";
    els.btn.title = "Chats - switch between conversations and agents";
    els.btn.setAttribute("aria-label", "Chats");
    els.btn.setAttribute("aria-controls", "rail");
    els.btn.addEventListener("click", function () { setOpen(doc.documentElement.getAttribute("data-rail") !== "open"); });
    var left = doc.querySelector("#app header .left");
    if (left) left.insertBefore(els.btn, left.firstChild);

    var saved = ls(K.open);
    setOpen(saved === null ? !(root.matchMedia && root.matchMedia("(max-width: 900px)").matches) : saved === "1");

    var forget = doc.getElementById("forget");
    if (forget) forget.addEventListener("click", function () { parked.slice().forEach(function (p) { closeLive(p, true); }); schedulePaint(); });

    doc.addEventListener("keydown", function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        var l = sections(liveList().map(info), [], (cur() || {}).conversationId).live;
        if (l.length < 2) return;
        e.preventDefault();
        // order on screen: current first, then newest; Alt+Down = next, Alt+Up = last
        open((e.key === "ArrowDown" ? l[1] : l[l.length - 1]).s);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        newChat(els.agent.hidden ? "" : els.agent.value);
      }
    });
  }

  var paintTimer = null;
  function schedulePaint() { clearTimeout(paintTimer); paintTimer = setTimeout(paint, 80); }
  function paint() {
    if (!els.list) return;
    var list = agents();
    if (list.length > 1) {
      var want = list.map(function (a) { return a.id; }).join("|");
      if (els.agent.getAttribute("data-list") !== want) {
        els.agent.innerHTML = "";
        list.forEach(function (a) { var o = el("option", "", a.name); o.value = a.id; els.agent.appendChild(o); });
        els.agent.setAttribute("data-list", want);
      }
      if (!els.agent.value || doc.activeElement !== els.agent) els.agent.value = ls(K.sel) || list[0].id;
      els.agent.hidden = false;
    } else els.agent.hidden = true;

    var c = cur();
    var m = meta();
    var sec = sections(liveList().map(info), jget(K.recent, []), c && c.conversationId);
    els.list.innerHTML = "";
    if (sec.live.length) els.list.appendChild(el("div", "railsec", "Open in this tab"));
    sec.live.forEach(function (x) { els.list.appendChild(row(x.s.conversationId, m, { live: x.s, current: x.s === c, working: x.working, unread: x.s.__rail ? x.s.__rail.unread : 0, at: x.lastAt })); });
    if (sec.recent.length) els.list.appendChild(el("div", "railsec", "Recent"));
    sec.recent.forEach(function (r) { els.list.appendChild(row(r.conversationId, m, { recent: r, at: (m[r.conversationId] && m[r.conversationId].at) || r.at })); });
    if (!sec.live.length && !sec.recent.length) els.list.appendChild(el("p", "muted", "No conversations yet."));
  }
  function row(id, m, o) {
    var ag = agentOf(id);
    var b = el("div", "railrow" + (o.current ? " current" : "") + (o.live ? " live" : ""));
    b.setAttribute("role", "button");
    b.tabIndex = 0;
    var badge = el("span", "railbadge", initials(ag));
    if (ag && ag.name) badge.title = ag.name;
    b.appendChild(badge);
    var mid = el("span", "railmid");
    mid.appendChild(el("span", "railtitle", (m[id] && m[id].title) || (o.current ? "Current chat" : "Chat " + id.slice(0, 6) + "…")));
    mid.appendChild(el("span", "railsub", (ag && ag.name ? ag.name + " · " : "") + ago(o.at)));
    b.appendChild(mid);
    if (o.working) b.appendChild(el("span", "railwork", "…")).title = "Agent is working";
    if (o.unread) b.appendChild(el("span", "railunread", String(o.unread))).title = o.unread + " new repl" + (o.unread === 1 ? "y" : "ies");
    b.title = (o.live ? (o.current ? "Open now" : "Open in this tab - switch instantly") : "Continue (reconnects)") + " · " + id;
    var go = function () { if (o.live) open(o.live); else if (o.recent) continueRecent(o.recent); };
    b.addEventListener("click", go);
    b.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    if (o.live && !o.current) {
      var x = el("button", "railx", "✕");
      x.type = "button";
      x.title = "Close this chat (it stays under Recent)";
      x.setAttribute("aria-label", "Close chat");
      x.addEventListener("click", function (e) { e.stopPropagation(); closeLive(o.live); });
      b.appendChild(x);
    }
    return b;
  }

  api.state = function () {
    return { max: MAX_LIVE, current: (cur() || {}).conversationId || null, parked: parked.map(function (s) { return { conversationId: s.conversationId, working: !!s.pendingSince, unread: s.__rail ? s.__rail.unread : 0 }; }) };
  };
  api.paint = schedulePaint;

  function start() { build(); paint(); setInterval(paint, 15000); setInterval(function () { if (liveList().some(function (s) { return s.pendingSince; }) || parked.length) schedulePaint(); }, 2000); }
  // app.js doesn't tell us when a chat starts: pick up the current one quickly (liveList() calls watch())
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
