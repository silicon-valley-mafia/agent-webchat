/* agent-webchat PREVIEW v3: Deep Chat (https://deepchat.dev) front end on the same Worker + Direct Line.
 * Preview only - fewer features than the main page (no attachments, history panel, queue, copy/collapse).
 * Direct Line is used through its REST API (no Web Chat bundle): start / post / poll activities with the token.
 * A refresh re-uses this tab's ORIGINAL token (refreshed every 15 min) instead of the Worker's /resume - this also
 * tests the "first message after a refresh fails with MCS-4041" theory (handoff notes 2026-11-27-resume-mcs4041). */
(function () {
  "use strict";
  var cfg = window.AGENT_WEBCHAT_CONFIG || {};
  var base = String(cfg.tokenEndpoint || "").replace(/\/token\/?$/, "");
  var KEY_CODE = "agentAccessCode";          // shared with the main page
  var KEY_SESS = "awV3Session";              // this tab only (sessionStorage)
  var TOKEN_REUSE_MS = 25 * 60 * 1000;       // Direct Line tokens last ~30 min
  var TOKEN_REFRESH_MS = 15 * 60 * 1000;
  var POLL_MS = 1000;
  var LOG_DEBOUNCE_MS = 4000;
  var QUIET_MS = 3000;

  var $ = function (id) { return document.getElementById(id); };
  var el = { gate: $("gate"), code: $("code"), status: $("status"), chat: $("chat"), who: $("who"), work: $("work"),
    newChat: $("newchat"), theme: $("theme"), info: $("info"), notice: $("notice") };
  var s = null;           // {token, conversationId, userId, domain, name, watermark, logged, at, fresh}
  var signals = null;
  var pollTimer = null, refreshTimer = null, logTimer = null, quietTimer = null;

  function notice(t) { el.notice.textContent = t || ""; el.notice.hidden = !t; }
  function save() { try { sessionStorage.setItem(KEY_SESS, JSON.stringify(s)); } catch (e) {} }
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY_SESS) || "null"); } catch (e) { return null; } }

  function worker(path, code, body) {
    var h = { "X-Access-Code": code };
    if (body) h["Content-Type"] = "application/json";
    return fetch(base + path, { method: "POST", headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ("http_" + r.status)); e.code = j.error; throw e; }
        return j;
      });
    });
  }
  function dl(path, opts) {
    opts = opts || {};
    var h = { Authorization: "Bearer " + s.token };
    if (opts.body) h["Content-Type"] = "application/json";
    return fetch(s.domain + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        if (!r.ok) { var e = new Error("directline_" + r.status); e.status = r.status; throw e; }
        return r.status === 204 ? {} : r.json().catch(function () { return {}; });
      });
  }
  function activitiesPath() { return "/conversations/" + encodeURIComponent(s.conversationId) + "/activities"; }

  // ---------- session: reuse this tab's token, else a new conversation ----------
  function refreshToken(old) {
    s = old;
    return dl("/tokens/refresh", { method: "POST" }).then(function (j) {
      if (j.token) s.token = j.token;
      s.at = Date.now();
      s.fresh = false;
      save();
      return s;
    });
  }
  function connect(code) {
    var old = load();
    var reuse = old && old.token && old.conversationId && old.domain && Date.now() - (old.at || 0) < TOKEN_REUSE_MS;
    var p = reuse ? refreshToken(old) : Promise.reject(null);
    return p.catch(function () {
      return worker("/token", code).then(function (t) {
        s = { token: t.token, conversationId: t.conversationId, userId: t.userId, domain: t.domain, name: t.name || "",
          watermark: "", logged: 0, at: Date.now(), fresh: true };
        save();
        return dl("/conversations", { method: "POST" }).then(function () { return s; });
      });
    });
  }

  // ---------- reading activities ----------
  function textOf(a) {
    var t = a.text || "";
    (a.attachments || []).forEach(function (att) {
      var ct = att.contentType || "";
      if (ct.indexOf("application/vnd.microsoft.card") === 0) t += (t ? "\n\n" : "") + "_(card - open the classic page to use it)_";
      else t += (t ? "\n\n" : "") + "📎 " + (att.name || ct || "file");
    });
    return t;
  }
  function mine(a) { return !!(a.from && (a.from.id === s.userId || a.from.role === "user")); }
  function fetchNew() {
    var out = [];
    function page() {
      return dl(activitiesPath() + (s.watermark ? "?watermark=" + encodeURIComponent(s.watermark) : "")).then(function (j) {
        var acts = j.activities || [];
        out = out.concat(acts);
        var more = j.watermark && j.watermark !== s.watermark && acts.length;
        if (j.watermark) s.watermark = j.watermark;
        return more ? page() : out;
      });
    }
    return page();
  }
  function poll() {
    clearTimeout(pollTimer);
    fetchNew().then(function (acts) {
      var got = false;
      acts.forEach(function (a) {
        if (a.type !== "message" || mine(a)) return;
        got = true;
        if (signals) signals.onResponse({ role: "ai", text: textOf(a) });
      });
      if (acts.some(function (a) { return a.type === "message"; })) { save(); scheduleLog(); }
      if (got) working(false);
    }).catch(function (e) {
      if (e && (e.status === 403 || e.status === 401)) notice("The connection expired - use New chat (the old one stays in History on the main page).");
    }).then(function () { pollTimer = setTimeout(poll, POLL_MS); });
  }

  // ---------- "agent is working" (cleared 3 s after the last reply) ----------
  var since = 0, tick = null;
  function working(on) {
    clearTimeout(quietTimer);
    if (on) {
      since = Date.now();
      clearInterval(tick);
      el.work.textContent = "⏳ Agent is working…";
      tick = setInterval(function () { el.work.textContent = "⏳ Agent is working… " + Math.round((Date.now() - since) / 1000) + "s"; }, 1000);
      el.work.hidden = false;
      return;
    }
    quietTimer = setTimeout(function () { clearInterval(tick); el.work.hidden = true; }, QUIET_MS);
  }

  // ---------- transcript logging (same Worker /log as the main page) ----------
  function scheduleLog() {
    clearTimeout(logTimer);
    logTimer = setTimeout(function () {
      worker("/log", localStorage.getItem(KEY_CODE), { conversationId: s.conversationId, userId: s.userId, since: s.logged || 0 })
        .then(function (j) { if (typeof j.total === "number") { s.logged = j.total; save(); } if (j.more) scheduleLog(); })
        .catch(function () {});
    }, LOG_DEBOUNCE_MS);
  }

  // ---------- Deep Chat ----------
  function dark() { return document.documentElement.dataset.theme === "dark"; }
  function styles(chat) {
    var d = dark();
    chat.style.width = "100%";
    chat.style.height = "100%";
    chat.style.border = "none";
    chat.chatStyle = { backgroundColor: d ? "#0f172a" : "#ffffff", width: "100%", height: "100%", border: "none", fontSize: "15px" };
    chat.messageStyles = {
      default: {
        shared: { bubble: { maxWidth: "820px", lineHeight: "1.55", padding: "10px 14px" } },
        user: { bubble: { backgroundColor: cfg.accentColor || "#2563eb", color: "#fff" } },
        ai: { bubble: { backgroundColor: d ? "#1e293b" : "#f1f5f9", color: d ? "#e5e7eb" : "#0f172a" } }
      }
    };
    chat.textInput = {
      placeholder: { text: "Message " + (cfg.title || "the agent") + "…" },
      styles: { container: { backgroundColor: d ? "#1e293b" : "#f8fafc", color: d ? "#e5e7eb" : "#0f172a", borderRadius: "14px", width: "min(820px, 92%)" } }
    };
  }
  function mount(history) {
    el.chat.innerHTML = "";
    var chat = document.createElement("deep-chat");
    styles(chat);
    chat.history = history;
    chat.names = { ai: { text: cfg.title || "Agent" }, user: { text: s.name || "You" } };
    chat.connect = {
      websocket: true,
      handler: function (_, sig) {
        signals = sig;
        sig.onOpen();
        sig.newUserMessage.listener = function (body) {
          var m = body && body.messages && body.messages[body.messages.length - 1];
          var text = (m && m.text) || "";
          if (!text.trim()) return;
          working(true);
          dl(activitiesPath(), { method: "POST", body: { type: "message", from: { id: s.userId, name: s.name }, text: text, locale: cfg.locale || "en-US" } })
            .catch(function (e) { working(false); sig.onResponse({ error: "Not sent (" + e.message + ") - try again." }); });
        };
      }
    };
    el.chat.appendChild(chat);
  }

  function start(code) {
    el.status.textContent = "Connecting…";
    return connect(code).then(function () {
      localStorage.setItem(KEY_CODE, code);
      el.gate.hidden = true;
      el.chat.hidden = false;
      el.who.textContent = s.name || "";
      el.info.title = "Conversation " + s.conversationId + (s.fresh ? " (new)" : " (same token after refresh)");
      s.watermark = ""; // read the whole conversation once for the history
      return fetchNew().then(function (acts) {
        var history = acts.filter(function (a) { return a.type === "message"; })
          .map(function (a) { return { role: mine(a) ? "user" : "ai", text: textOf(a) }; });
        mount(history);
        if (s.fresh) {
          dl(activitiesPath(), { method: "POST", body: { type: "event", name: "startConversation", locale: cfg.locale || "en-US",
            localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, from: { id: s.userId, name: s.name } } }).catch(function () {});
          s.fresh = false;
        }
        save();
        poll();
        clearInterval(refreshTimer);
        refreshTimer = setInterval(function () { refreshToken(s).catch(function () {}); }, TOKEN_REFRESH_MS);
      });
    }).catch(function (e) {
      el.gate.hidden = false;
      el.status.textContent = e && e.code === "bad_access_code" ? "Wrong access code." : "Couldn't connect: " + (e && e.message);
      if (e && e.code === "bad_access_code") localStorage.removeItem(KEY_CODE);
    });
  }

  // ---------- header ----------
  function applyTheme() {
    var m = localStorage.getItem("agentTheme") || cfg.theme || "auto";
    var d = m === "dark" || (m === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = d ? "dark" : "light";
    var chat = el.chat.querySelector("deep-chat");
    if (chat) styles(chat);
  }
  el.theme.onclick = function () { localStorage.setItem("agentTheme", dark() ? "light" : "dark"); applyTheme(); };
  el.newChat.onclick = function () { try { sessionStorage.removeItem(KEY_SESS); } catch (e) {} location.reload(); };
  el.info.onclick = function () { notice(el.info.title); };
  el.gate.onsubmit = function (e) { e.preventDefault(); start(el.code.value.trim()); };

  applyTheme();
  document.title = (cfg.title || "Agent") + " - preview v3";
  $("title").textContent = cfg.title || "Agent";
  if (!base) { el.status.textContent = "tokenEndpoint is not configured."; return; }
  var saved = localStorage.getItem(KEY_CODE);
  var go = function () { if (saved) start(saved); };
  if (window.customElements && customElements.whenDefined) customElements.whenDefined("deep-chat").then(go);
  else go();

  window.__awV3 = { state: function () { return s; }, textOf: textOf };
})();
