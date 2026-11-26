/* agent-webchat client: access code gate, Web Chat, resume, history, export, theme, voice, notifications. */
(function () {
  "use strict";

  var cfg = window.AGENT_WEBCHAT_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gate: $("gate"), code: $("code"), status: $("status"), chatWrap: $("chatwrap"), who: $("who"),
    newChat: $("newchat"), forget: $("forget"), logState: $("logstate"), history: $("historybtn"),
    download: $("download"), theme: $("theme"), notify: $("notify"), panel: $("history"),
    panelBody: $("historybody"), panelTitle: $("historytitle"), panelClose: $("historyclose"), notice: $("notice"),
    upState: $("upstate"), drop: $("dropzone")
  };
  var K = { code: "agentAccessCode", theme: "agentTheme", notify: "agentNotify", last: "agentLastSession", logged: "agentLogged" };
  var RESUME_MAX_AGE_MS = 24 * 3600 * 1000;
  var LOG_DEBOUNCE_MS = 4000;
  var TITLE = cfg.title || "Agent";
  var configured = !!cfg.tokenEndpoint && cfg.tokenEndpoint.indexOf("REPLACE_WITH") !== 0;
  var base = configured ? cfg.tokenEndpoint.replace(/\/token\/?$/, "") : "";
  var current = null;
  var busy = false;
  var unread = 0;
  var speechFactory;

  $("title").textContent = TITLE;
  document.title = TITLE;

  var MESSAGES = {
    bad_access_code: "Wrong access code.",
    rate_limited: "Too many requests - wait a minute and try again.",
    origin_not_allowed: "This page's origin is not allowed by the token service.",
    server_not_configured: "Token service is missing its secrets.",
    directline_error: "The agent's Direct Line service rejected the request (check the secret / region).",
    directline_unreachable: "Could not reach Direct Line.",
    conversation_expired: "That conversation has expired on Microsoft's side. You can still view or download its transcript.",
    logging_disabled: "Transcript logging is not enabled on the Worker (LOG_REPO_TOKEN not set).",
    forbidden: "That transcript belongs to someone else.",
    not_found: "Transcript not found.",
    not_configured: "Not configured yet: set tokenEndpoint in web/config.js."
  };

  function fail(code, status) {
    var e = new Error(MESSAGES[code] || ("Request failed (" + (status || code) + ")"));
    e.code = code;
    return e;
  }

  function api(path, code, body) {
    if (!configured) return Promise.reject(fail("not_configured"));
    var headers = { "X-Access-Code": code };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(base + path, { method: "POST", headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw fail(j.error, r.status);
          return j;
        });
      });
  }

  function savedCode() { return localStorage.getItem(K.code); }
  function notice(text) { el.notice.textContent = text || ""; el.notice.hidden = !text; }
  function setLogState(t) { el.logState.textContent = t || ""; }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }

  // ---------------- theme + look ----------------
  function themeMode() { return localStorage.getItem(K.theme) || cfg.theme || "auto"; }
  function effectiveTheme() {
    var m = themeMode();
    if (m === "auto") return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return m;
  }
  function paintThemeButton() {
    var m = themeMode();
    el.theme.textContent = m === "dark" ? "🌙" : m === "light" ? "☀️" : "🌓";
    el.theme.title = "Theme: " + m + " (click to change)";
    document.documentElement.setAttribute("data-theme", effectiveTheme());
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function styleOptions(s) {
    var accent = cfg.accentColor || "#2563eb";
    var o = {
      accent: accent,
      bubbleBorderRadius: 10, bubbleFromUserBorderRadius: 10,
      bubbleFromUserBackground: accent, bubbleFromUserTextColor: "#ffffff", bubbleFromUserBorderColor: accent,
      botAvatarInitials: cfg.botAvatarInitials || "AI",
      userAvatarInitials: cfg.userAvatarInitials || initials(s && s.name),
      botAvatarBackgroundColor: accent, userAvatarBackgroundColor: "#6b7280",
      suggestedActionBorderColor: accent, suggestedActionTextColor: accent,
      hideUploadButton: false, disableFileUpload: false, uploadMultiple: true, uploadThumbnailQuality: 0.6
    };
    if (cfg.botAvatarImage) o.botAvatarImage = cfg.botAvatarImage;
    if (cfg.userAvatarImage) o.userAvatarImage = cfg.userAvatarImage;
    if (effectiveTheme() === "dark") {
      o.backgroundColor = "#0f172a";
      o.bubbleBackground = "#1e293b"; o.bubbleTextColor = "#e5e7eb"; o.bubbleBorderColor = "#334155";
      o.sendBoxBackground = "#111827"; o.sendBoxTextColor = "#e5e7eb"; o.sendBoxButtonColor = "#9ca3af";
      o.sendBoxBorderTop = "solid 1px #334155"; o.sendBoxPlaceholderColor = "#6b7280";
      o.subtle = "#9ca3af"; o.timestampColor = "#9ca3af";
      o.suggestedActionBackground = "#1e293b"; o.suggestedActionBackgroundColor = "#1e293b";
      o.transcriptOverlayButtonBackground = "#334155"; o.transcriptOverlayButtonColor = "#e5e7eb";
    }
    return o;
  }

  // ---------------- voice ----------------
  function getSpeechFactory() {
    if (speechFactory !== undefined) return speechFactory;
    var ok = cfg.voice !== false && (window.SpeechRecognition || window.webkitSpeechRecognition) &&
      window.WebChat && typeof window.WebChat.createBrowserWebSpeechPonyfillFactory === "function";
    speechFactory = ok ? window.WebChat.createBrowserWebSpeechPonyfillFactory() : null;
    return speechFactory;
  }

  // ---------------- notifications ----------------
  function notifySupported() { return cfg.notifications !== false && "Notification" in window; }
  function notifyOn() { return notifySupported() && localStorage.getItem(K.notify) === "on" && Notification.permission === "granted"; }
  function paintNotify() {
    el.notify.hidden = !notifySupported();
    el.notify.textContent = notifyOn() ? "🔔" : "🔕";
    el.notify.title = notifyOn() ? "Notifications on (click to turn off)" : "Notify me when the agent replies in a background tab";
  }
  function maybeNotify(s, a) {
    if (!document.hidden) return;
    unread++;
    document.title = "(" + unread + ") " + TITLE;
    if (!notifyOn()) return;
    try {
      var n = new Notification(TITLE, { body: (a.text || "(attachment)").slice(0, 160), tag: "agent-webchat", icon: cfg.botAvatarImage || undefined });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) {}
  }

  // ---------------- logging ----------------
  // The Worker only ever CREATES files: one folder per session, one file per message.
  // We remember how many messages are already written (per conversation) and send it as `since`.
  function loggedMap() {
    try { return JSON.parse(localStorage.getItem(K.logged) || "{}") || {}; } catch (e) { return {}; }
  }
  function getLogged(conversationId) { return loggedMap()[conversationId] || 0; }
  function setLogged(conversationId, n) {
    var m = loggedMap();
    m[conversationId] = n;
    var keys = Object.keys(m);
    if (keys.length > 100) keys.slice(0, keys.length - 100).forEach(function (k) { delete m[k]; });
    localStorage.setItem(K.logged, JSON.stringify(m));
  }
  function saveLog(s, opts) {
    if (!s || !s.conversationId || s.loggingDisabled) return Promise.resolve();
    if (s.saving && !(opts && opts.keepalive)) { s.dirty = true; return s.saving; }
    s.dirty = false;
    setLogState("Saving…");
    var p = fetch(base + "/log", {
      method: "POST", keepalive: !!(opts && opts.keepalive),
      headers: { "X-Access-Code": s.code, "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: s.conversationId, userId: s.userId, since: getLogged(s.conversationId) })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.logged) {
        setLogged(s.conversationId, j.total);
        if (j.more) { s.dirty = true; setLogState("Saving…"); }
        else setLogState(s.dirty ? "Saving…" : "Saved ✓");
      } else if (j.reason === "logging_disabled") { s.loggingDisabled = true; setLogState(""); }
      else if (j.reason === "empty") setLogState("");
      else {
        if (typeof j.total === "number") setLogged(s.conversationId, j.total);
        s.dirty = true; setLogState("Not saved");
      }
      return j;
    }).catch(function () { s.dirty = true; setLogState("Not saved"); })
      .then(function (j) {
        s.saving = null;
        // more pages to write, or new messages arrived while saving: go again (not after errors)
        if (s.dirty && j && j.logged && current === s) scheduleLog(s, 300);
      });
    s.saving = p;
    return p;
  }
  function scheduleLog(s, delay) {
    s.dirty = true;
    clearTimeout(s.logTimer);
    s.logTimer = setTimeout(function () { saveLog(s); }, delay === undefined ? LOG_DEBOUNCE_MS : delay);
  }

  // ---------------- attachments ----------------
  // Every outgoing message with files passes through here (paperclip, paste, drag & drop):
  //  1. the original is committed to the artifact repo in the background (Worker /artifact),
  //  2. what the agent receives is adapted to its limits (zip / zip parts, max 4 MB per message),
  //  3. a short note tells the agent what was changed and where the original is.
  var F = window.AgentFiles;
  var uploads = { active: 0, queue: Promise.resolve() };
  function setUpState(t) { if (el.upState) el.upState.textContent = t || ""; }

  function attachmentFiles(act) {
    return Promise.all((act.attachments || []).map(function (a) {
      var url = String(a.contentUrl || "");
      if (!/^(blob|data):/.test(url)) return Promise.resolve({ keep: a });
      return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        return { file: new File([b], a.name || "file", { type: a.contentType || b.type || "" }) };
      });
    }));
  }

  function queueArtifact(s, file, art) {
    uploads.active++;
    uploads.queue = uploads.queue.then(function () {
      return F.uploadArtifact({ base: base, code: s.code, conversationId: s.conversationId }, file, art, setUpState);
    }).then(function (res) {
      if (!res.ok) notice("Saving " + file.name + " to GitHub was incomplete (" + res.saved + "/" + res.parts + " parts). The chat copy is unaffected.");
    }).catch(function (e) { notice("Saving " + file.name + " to GitHub failed: " + e.message); })
      .then(function () { uploads.active--; setUpState(uploads.active ? "Saving files…" : "Files saved ✓"); });
  }

  /** -> [{text, attachments}], one entry per message to post (first one replaces the user's message). */
  function prepareOutgoing(s, act) {
    var lim = F.limits(cfg);
    var saving = cfg.saveAttachments !== false && s.conversationId;
    setUpState("Preparing files…");
    return attachmentFiles(act).then(function (list) {
      var keep = [], notes = [], items = [];
      return list.reduce(function (p, x) {
        return p.then(function () {
          if (x.keep) { keep.push(x.keep); return; }
          var f = x.file;
          var art = saving ? F.beginArtifact({ base: base, code: s.code, conversationId: s.conversationId }, f).catch(function (e) {
            notice("Not saved to GitHub: " + f.name + " (" + (e.code === "too_large" ? "larger than the Worker's ARTIFACT_MAX_BYTES" : e.message) + ")");
            return null;
          }) : Promise.resolve(null);
          return Promise.all([F.planDelivery(f, lim), art]).then(function (v) {
            var plan = v[0], a = v[1];
            if (a) queueArtifact(s, f, a);
            var line = F.describe(f, plan, a);
            if (line) notes.push(line);
            plan.items.forEach(function (it) { items.push(it); });
          });
        });
      }, Promise.resolve()).then(function () {
        var groups = F.batch(items, lim.maxBytes);
        var toAtt = function (it) { return { contentType: it.type || "application/octet-stream", contentUrl: URL.createObjectURL(it.blob), name: it.name }; };
        var note = notes.length ? "📎 Attachment notes (added by the web page):\n" + notes.join("\n") : "";
        var text = [act.text || "", note].filter(Boolean).join("\n\n");
        var out = [{ text: text, attachments: keep.concat((groups[0] || []).map(toAtt)) }];
        groups.slice(1).forEach(function (g, i) {
          out.push({ text: "(attachments " + (i + 2) + "/" + groups.length + ")", attachments: g.map(toAtt) });
        });
        if (!uploads.active) setUpState("");
        return out;
      });
    });
  }

  /** Web Chat store middleware: rewrites outgoing messages that carry files. */
  function filesMiddleware(holder) {
    return function (storeApi) {
      return function (next) {
        return function (action) {
          var act = action && action.type === "DIRECT_LINE/POST_ACTIVITY" && action.payload && action.payload.activity;
          var s = holder.s;
          if (!F || !s || !act || !act.attachments || !act.attachments.length || (act.channelData && act.channelData.awPrepared)) return next(action);
          return prepareOutgoing(s, act).then(function (msgs) {
            var mark = function (a) { return Object.assign({}, a, { channelData: Object.assign({}, a.channelData, { awPrepared: true }) }); };
            var first = mark(Object.assign({}, act, msgs[0]));
            var result = next(Object.assign({}, action, { payload: Object.assign({}, action.payload, { activity: first }) }));
            msgs.slice(1).forEach(function (m, i) {
              setTimeout(function () {
                storeApi.dispatch({ type: "DIRECT_LINE/POST_ACTIVITY", meta: action.meta || { method: "keyboard" }, payload: { activity: mark({ type: "message", text: m.text, attachments: m.attachments }) } });
              }, 1500 * (i + 1));
            });
            return result;
          }, function (e) {
            setUpState("");
            notice("Couldn't prepare the attachments (" + e.message + "); sending them unchanged.");
            return next(action);
          });
        };
      };
    };
  }

  function pastedName(f, i) {
    if (f.name && f.name !== "image.png") return f.name;
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    var ext = (/\/(\w+)/.exec(f.type || "") || [0, "png"])[1];
    return "pasted-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + (i ? "-" + i : "") + "." + ext;
  }
  /** Paste and drag & drop: send files exactly as the paperclip would (through the middleware). */
  function sendFiles(files) {
    if (!current || !current.store || !files.length) return;
    current.store.dispatch({
      type: "DIRECT_LINE/POST_ACTIVITY", meta: { method: "keyboard" },
      payload: { activity: { type: "message", text: "", attachments: files.map(function (f, i) {
        return { contentType: f.type || "application/octet-stream", contentUrl: URL.createObjectURL(f), name: pastedName(f, i) };
      }) } }
    });
  }

  // ---------------- sessions ----------------
  function rememberSession(s) {
    localStorage.setItem(K.last, JSON.stringify({ conversationId: s.conversationId, userId: s.userId, at: Date.now() }));
  }
  function lastSession() {
    try { return JSON.parse(localStorage.getItem(K.last) || "null"); } catch (e) { return null; }
  }
  function stopSession(s, flush) {
    if (!s) return;
    clearTimeout(s.logTimer);
    if (flush && s.dirty) saveLog(s);
    s.subs.forEach(function (x) { try { x.unsubscribe(); } catch (e) {} });
    try { s.directLine.end(); } catch (e) {}
  }
  function renderChat(s) {
    window.WebChat.renderWebChat({
      directLine: s.directLine, store: s.store, userID: s.userId, username: s.name,
      locale: cfg.locale || "en-US", styleOptions: styleOptions(s),
      webSpeechPonyfillFactory: getSpeechFactory() || undefined
    }, s.mount);
  }

  function startWith(code, t, resumed) {
    var previous = current;
    current = null;
    stopSession(previous, true);

    var dlOpts = { token: t.token, domain: t.domain };
    if (resumed) { dlOpts.conversationId = t.conversationId; dlOpts.watermark = ""; dlOpts.webSocket = false; dlOpts.pollingInterval = 1500; }
    var directLine = window.WebChat.createDirectLine(dlOpts);
    var holder = {};
    var s = {
      directLine: directLine, store: window.WebChat.createStore ? window.WebChat.createStore({}, filesMiddleware(holder)) : undefined,
      subs: [], code: code, conversationId: t.conversationId || null, userId: t.userId || ("dl_" + uuid()),
      name: t.name || "", admin: !!t.admin, startedAt: Date.now(), resumed: !!resumed, logTimer: null, dirty: false
    };
    holder.s = s;

    s.subs.push(directLine.connectionStatus$.subscribe({
      next: function (st) {
        if (st === 2 && !s.greeted && !resumed) {
          s.greeted = true;
          directLine.postActivity({
            type: "event", name: "startConversation", locale: cfg.locale || "en-US",
            localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, from: { id: s.userId, name: s.name }
          }).subscribe();
        }
      }
    }));
    s.subs.push(directLine.activity$.subscribe({
      next: function (a) {
        if (!a) return;
        if (a.conversation && a.conversation.id) s.conversationId = a.conversation.id;
        if (a.type !== "message") return;
        var old = a.timestamp && Date.parse(a.timestamp) < s.startedAt - 5000;
        if (!old) scheduleLog(s);
        rememberSession(s);
        var mine = (a.from && (a.from.id === s.userId || a.from.role === "user"));
        if (!mine && !old) maybeNotify(s, a);
      }
    }));

    // Fresh mount point every time (reusing the old element broke "New chat").
    el.chatWrap.innerHTML = "";
    s.mount = document.createElement("div");
    el.chatWrap.appendChild(s.mount);
    renderChat(s);

    current = s;
    rememberSession(s);
    localStorage.setItem(K.code, code);
    el.who.textContent = s.name ? s.name + (s.admin ? " (admin)" : "") : "";
    setLogState("");
    el.gate.hidden = true;
    el.chatWrap.hidden = false;
    [el.newChat, el.forget, el.history, el.download].forEach(function (b) { b.hidden = false; });
    el.status.textContent = "";
    return s;
  }

  function guarded(fn) {
    return function () {
      if (busy) return Promise.resolve();
      busy = true;
      el.newChat.disabled = true;
      var args = arguments;
      return Promise.resolve().then(function () { return fn.apply(null, args); })
        .finally(function () { busy = false; el.newChat.disabled = false; });
    };
  }

  var newConversation = guarded(function (code) {
    el.status.textContent = "Connecting...";
    return api("/token", code).then(function (t) { notice(""); return startWith(code, t, false); });
  });

  var resumeConversation = guarded(function (code, conversationId, userId) {
    el.status.textContent = "Reconnecting...";
    return api("/resume", code, { conversationId: conversationId }).then(function (t) {
      t.userId = userId || undefined;
      notice("");
      return startWith(code, t, true);
    });
  });

  function showGate(message) {
    el.chatWrap.hidden = true;
    el.gate.hidden = false;
    el.status.textContent = message || "";
  }
  function handleAuthError(err) {
    if (err && err.code === "bad_access_code") localStorage.removeItem(K.code);
    showGate(err && err.message);
  }

  // ---------------- download ----------------
  function downloadText(text, filename) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function downloadCurrent() {
    if (!current || !current.conversationId) return Promise.resolve();
    return api("/export", current.code, { conversationId: current.conversationId })
      .then(function (j) { downloadText(j.markdown, j.filename || "conversation.md"); })
      .catch(function (e) { notice("Download failed: " + e.message); });
  }

  // ---------------- history ----------------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }
  /** Small, safe Markdown subset for transcripts: everything is escaped first. */
  function renderMarkdown(md) {
    var out = [], inCode = false, code = [];
    String(md).split("\n").forEach(function (line) {
      if (/^```/.test(line)) {
        if (inCode) { out.push("<pre>" + esc(code.join("\n")) + "</pre>"); code = []; }
        inCode = !inCode;
        return;
      }
      if (inCode) { code.push(line); return; }
      if (/^<\/?details>|^<summary>|^<details>/.test(line)) return;
      if (/^\|[-| ]+\|$/.test(line) || line === "| | |") return;
      var m;
      if ((m = /^(#{1,3}) (.*)$/.exec(line))) { out.push("<h" + (m[1].length + 1) + ">" + inline(m[2]) + "</h" + (m[1].length + 1) + ">"); return; }
      if ((m = /^\| (.*?) \| (.*) \|$/.exec(line))) { out.push("<div class='kv'><span>" + inline(m[1]) + "</span> " + inline(m[2]) + "</div>"); return; }
      if (line === "---") { out.push("<hr>"); return; }
      if ((m = /^> (.*)$/.exec(line))) { out.push("<blockquote>" + inline(m[1]) + "</blockquote>"); return; }
      out.push(line ? "<p>" + inline(line) + "</p>" : "");
    });
    if (inCode) out.push("<pre>" + esc(code.join("\n")) + "</pre>");
    return out.join("\n");
  }
  function parseIds(md) {
    var c = /\| Conversation ID \| `([^`]+)` \|/.exec(md);
    var u = /\| User ID \| `([^`]*)` \|/.exec(md);
    return { conversationId: c ? c[1] : null, userId: u && u[1] ? u[1] : null };
  }
  function button(label, onClick, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  }
  /** logs/2026-11-27/0140-deepesh--conv  ->  2026-11-27_0140-deepesh--conv.md */
  function fileName(item) { return item.path.split("/").slice(1).join("_") + ".md"; }
  function openPanel(title) { el.panelTitle.textContent = title; el.panel.hidden = false; el.panelBody.innerHTML = "<p class='muted'>Loading…</p>"; }
  function closePanel() { el.panel.hidden = true; }

  function continueFrom(md) {
    var ids = parseIds(md);
    if (!ids.conversationId) { notice("This transcript has no conversation ID."); return Promise.resolve(); }
    var code = savedCode() || (current && current.code);
    return resumeConversation(code, ids.conversationId, ids.userId).then(closePanel).catch(function (e) {
      el.panelBody.insertAdjacentHTML("afterbegin", "<p class='error'>" + esc(e.message) + "</p>");
    });
  }

  function showTranscript(item) {
    var code = savedCode() || (current && current.code);
    openPanel(item.date + " " + item.time + (item.person ? " · " + item.person : ""));
    return api("/transcript", code, { path: item.path }).then(function (j) {
      el.panelBody.innerHTML = "";
      var bar = document.createElement("div");
      bar.className = "bar";
      bar.appendChild(button("← Back", function () { showHistory(); }));
      bar.appendChild(button("Continue this chat", function () { continueFrom(j.markdown); }, "primary"));
      bar.appendChild(button("Download", function () { downloadText(j.markdown, fileName(item)); }));
      el.panelBody.appendChild(bar);
      var doc = document.createElement("div");
      doc.className = "transcript";
      doc.innerHTML = renderMarkdown(j.markdown);
      el.panelBody.appendChild(doc);
    }).catch(function (e) { el.panelBody.innerHTML = "<p class='error'>" + esc(e.message) + "</p>"; });
  }

  function showHistory() {
    var code = savedCode() || (current && current.code);
    openPanel("Conversation history");
    return api("/history", code).then(function (j) {
      el.panelBody.innerHTML = "";
      if (j.reason === "logging_disabled") { el.panelBody.innerHTML = "<p class='muted'>" + esc(MESSAGES.logging_disabled) + "</p>"; return; }
      if (!j.items.length) { el.panelBody.innerHTML = "<p class='muted'>No saved conversations yet.</p>"; return; }
      var lastDate = null;
      j.items.forEach(function (item) {
        if (item.date !== lastDate) {
          lastDate = item.date;
          var h = document.createElement("h3");
          h.textContent = item.date;
          el.panelBody.appendChild(h);
        }
        var row = document.createElement("div");
        row.className = "row";
        var label = document.createElement("span");
        label.textContent = item.time + (current && current.admin ? "  ·  " + item.person : "") +
          "  ·  " + (item.messages || 0) + " msg" + (item.messages === 1 ? "" : "s");
        row.appendChild(label);
        row.appendChild(button("View", function () { showTranscript(item); }));
        row.appendChild(button("Continue", function () {
          api("/transcript", code, { path: item.path }).then(function (t) { return continueFrom(t.markdown); })
            .catch(function (e) { notice(e.message); });
        }));
        row.appendChild(button("⬇", function () {
          api("/transcript", code, { path: item.path }).then(function (t) { downloadText(t.markdown, fileName(item)); })
            .catch(function (e) { notice(e.message); });
        }));
        el.panelBody.appendChild(row);
      });
      if (j.truncated) el.panelBody.insertAdjacentHTML("beforeend", "<p class='muted'>Showing the newest 300.</p>");
    }).catch(function (e) { el.panelBody.innerHTML = "<p class='error'>" + esc(e.message) + "</p>"; });
  }

  // ---------------- wiring ----------------
  el.gate.addEventListener("submit", function (e) {
    e.preventDefault();
    newConversation(el.code.value).catch(handleAuthError);
  });
  el.newChat.addEventListener("click", function () {
    var code = savedCode() || (current && current.code);
    if (!code) { showGate(); return; }
    newConversation(code).catch(handleAuthError);
  });
  el.forget.addEventListener("click", function () {
    var s = current;
    current = null;
    stopSession(s, true);
    localStorage.removeItem(K.code);
    localStorage.removeItem(K.last);
    el.code.value = "";
    el.who.textContent = "";
    [el.newChat, el.forget, el.history, el.download].forEach(function (b) { b.hidden = true; });
    setLogState("");
    closePanel();
    showGate("Access code removed from this browser.");
  });
  el.history.addEventListener("click", function () { showHistory(); });
  el.panelClose.addEventListener("click", closePanel);
  el.download.addEventListener("click", function () { downloadCurrent(); });
  el.theme.addEventListener("click", function () {
    var order = ["auto", "light", "dark"];
    localStorage.setItem(K.theme, order[(order.indexOf(themeMode()) + 1) % order.length]);
    applyTheme();
  });
  el.notify.addEventListener("click", function () {
    if (notifyOn()) { localStorage.setItem(K.notify, "off"); paintNotify(); return; }
    Promise.resolve(Notification.requestPermission()).then(function (p) {
      localStorage.setItem(K.notify, p === "granted" ? "on" : "off");
      if (p !== "granted") notice("Notifications are blocked in this browser's site settings.");
      paintNotify();
    });
  });

  /** Theme applies instantly; an open chat is re-attached (same conversation, history replayed). */
  function applyTheme() {
    paintThemeButton();
    if (current && current.conversationId) {
      var s = current;
      resumeConversation(s.code, s.conversationId, s.userId).catch(function () { renderChat(s); });
    }
  }
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onScheme = function () { if (themeMode() === "auto") applyTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", onScheme); else if (mq.addListener) mq.addListener(onScheme);
  }

  // Paste images/files into the chat (plain text paste is left alone).
  document.addEventListener("paste", function (e) {
    if (!current || el.chatWrap.hidden) return;
    var cd = e.clipboardData;
    if (!cd || (cd.getData && cd.getData("text/plain"))) return;
    var files = [];
    Array.prototype.forEach.call(cd.items || [], function (it) { if (it.kind === "file") { var f = it.getAsFile(); if (f) files.push(f); } });
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    sendFiles(files);
  }, true);

  // Drag & drop anywhere on the page. Captured before Web Chat sees it, so files are never sent twice.
  var dragDepth = 0;
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, "Files") >= 0; }
  window.addEventListener("dragenter", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    dragDepth++;
    if (current && el.drop) el.drop.hidden = false;
  }, true);
  window.addEventListener("dragover", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = current ? "copy" : "none";
  }, true);
  window.addEventListener("dragleave", function (e) {
    if (!hasFiles(e)) return;
    e.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth && el.drop) el.drop.hidden = true;
  }, true);
  window.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    dragDepth = 0;
    if (el.drop) el.drop.hidden = true;
    if (current) sendFiles(Array.prototype.slice.call(e.dataTransfer.files || []));
  }, true);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { unread = 0; document.title = TITLE; return; }
    if (current && current.dirty) { clearTimeout(current.logTimer); saveLog(current, { keepalive: true }); }
  });

  paintThemeButton();
  paintNotify();
  if (!configured) el.status.textContent = MESSAGES.not_configured;

  // Opening the page: remembered code -> continue the last conversation (or start a new one).
  var code0 = savedCode();
  if (code0 && configured) {
    el.code.value = code0;
    var last = lastSession();
    var fresh = last && last.conversationId && Date.now() - (last.at || 0) < RESUME_MAX_AGE_MS;
    (fresh ? resumeConversation(code0, last.conversationId, last.userId) : Promise.reject(null))
      .catch(function (err) {
        if (err && err.code === "bad_access_code") throw err;
        return newConversation(code0).then(function (s) {
          // set AFTER the new chat starts (starting a chat clears notices)
          if (err) notice("Couldn't continue the previous conversation, so a new one was started. It's still in History.");
          return s;
        });
      })
      .catch(handleAuthError);
  }

  window.__agentWebchat = {
    renderMarkdown: renderMarkdown, parseIds: parseIds, styleOptions: styleOptions, fileName: fileName,
    prepareOutgoing: prepareOutgoing, filesMiddleware: filesMiddleware, sendFiles: sendFiles, uploads: uploads
  };
})();
