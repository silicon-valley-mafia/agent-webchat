/* agent-webchat client: access code gate, Web Chat, resume, history, export, theme, voice, notifications,
 * staged attachments, copy / collapse per reply, clear chat, session info, "agent is working" state. */
(function () {
  "use strict";

  var cfg = window.AGENT_WEBCHAT_CONFIG || {};
  var U = window.AgentUI;
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gate: $("gate"), code: $("code"), status: $("status"), chatWrap: $("chatwrap"), who: $("who"),
    newChat: $("newchat"), forget: $("forget"), logState: $("logstate"), history: $("historybtn"),
    download: $("download"), theme: $("theme"), notify: $("notify"), panel: $("history"),
    panelBody: $("historybody"), panelTitle: $("historytitle"), panelClose: $("historyclose"), notice: $("notice"),
    noticeText: $("noticetext"), noticeClose: $("noticeclose"),
    upState: $("upstate"), drop: $("dropzone"), clear: $("clearchat"), session: $("sessionbtn"), width: $("widthbtn"),
    expandAll: $("expandall"), work: $("workstate"), staged: $("staged")
  };
  var K = {
    code: "agentAccessCode", theme: "agentTheme", notify: "agentNotify", last: "agentLastSession", logged: "agentLogged",
    width: "agentWidth", cleared: "agentCleared", collapse: "agentCollapse:"
  };
  var RESUME_MAX_AGE_MS = 24 * 3600 * 1000;
  var LOG_DEBOUNCE_MS = 4000;
  var TITLE = cfg.title || "Agent";
  var KEEP_EXPANDED = typeof cfg.expandedRecentReplies === "number" ? cfg.expandedRecentReplies : 3;
  var PREVIEW_PX = cfg.previewHeightPx || 140;
  var configured = !!cfg.tokenEndpoint && cfg.tokenEndpoint.indexOf("REPLACE_WITH") !== 0;
  var base = configured ? cfg.tokenEndpoint.replace(/\/token\/?$/, "") : "";
  var current = null;
  var busy = false;
  var unread = 0;
  var speechFactory;
  var noticeTimer = null;

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
  /** Banner under the header. Always dismissible (✕); opts.autoHideMs hides it after a while. */
  function notice(text, opts) {
    clearTimeout(noticeTimer);
    (el.noticeText || el.notice).textContent = text || "";
    el.notice.hidden = !text;
    if (text && opts && opts.autoHideMs) noticeTimer = setTimeout(function () { notice(""); }, opts.autoHideMs);
  }
  function setLogState(t) { el.logState.textContent = t || ""; }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
  function jsonGet(store, key, dflt) { try { return JSON.parse(store.getItem(key) || "null") || dflt; } catch (e) { return dflt; } }
  function mine(s, a) { return !!(a && a.from && (a.from.id === s.userId || a.from.role === "user")); }

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
  // TODO #15: fluid width by default; the ↔ button switches to a centred narrow column (remembered per browser).
  function widthMode() { return localStorage.getItem(K.width) || cfg.layout || "wide"; }
  function paintWidth() {
    var m = widthMode();
    document.documentElement.setAttribute("data-width", m);
    if (el.width) el.width.title = m === "wide" ? "Full width (click for a narrow column)" : "Narrow column (click for full width)";
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function styleOptions(s) {
    var accent = cfg.accentColor || "#2563eb";
    var vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
    var o = {
      accent: accent,
      bubbleBorderRadius: 10, bubbleFromUserBorderRadius: 10,
      bubbleFromUserBackground: accent, bubbleFromUserTextColor: "#ffffff", bubbleFromUserBorderColor: accent,
      botAvatarInitials: cfg.botAvatarInitials || "AI",
      userAvatarInitials: cfg.userAvatarInitials || initials(s && s.name),
      botAvatarBackgroundColor: accent, userAvatarBackgroundColor: "#6b7280",
      suggestedActionBorderColor: accent, suggestedActionTextColor: accent,
      hideUploadButton: false, disableFileUpload: false, uploadMultiple: true, uploadThumbnailQuality: 0.6,
      // TODO #16: multi-line send box - Enter sends, Shift+Enter adds a line
      sendBoxTextWrap: cfg.multilineInput !== false,
      // TODO #15 / #24(b): bubbles scale with the window instead of a fixed ~480 px column
      bubbleMaxWidth: cfg.bubbleMaxWidth || Math.max(480, Math.round(vw * 0.72)),
      markdownRespectCRLF: true
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

  // TODO #25: ask for the microphone explicitly on the first mic click and explain failures.
  var mic = { state: "unknown", bypass: false };
  function watchMicPermission() {
    if (!(navigator.permissions && navigator.permissions.query)) return;
    navigator.permissions.query({ name: "microphone" }).then(function (p) {
      mic.state = p.state;
      p.onchange = function () { mic.state = p.state; };
    }).catch(function () {});
  }
  function micError(e) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "PermissionDeniedError")
      return "Microphone is blocked - allow it in this site's settings (🔒 in the address bar), then reload the page.";
    if (n === "NotFoundError" || n === "DevicesNotFoundError") return "No microphone was found on this device.";
    if (n === "NotReadableError" || n === "TrackStartError") return "The microphone is in use by another app (or the OS blocked it).";
    if (n === "SecurityError") return "The microphone only works on an HTTPS page.";
    return "Couldn't start the microphone" + (e && e.message ? ": " + e.message : ".");
  }
  function requestMic() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      notice(window.isSecureContext === false ? "The microphone only works on an HTTPS page." : "This browser can't use the microphone here.", { autoHideMs: 15000 });
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      mic.state = "granted";
      return true;
    }, function (e) {
      mic.state = e && e.name === "NotAllowedError" ? "denied" : mic.state;
      notice(micError(e), { autoHideMs: 30000 });
      return false;
    });
  }
  function hookMic(s) {
    s.mount.addEventListener("click", function (e) {
      if (mic.bypass || mic.state === "granted") return;
      var t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t || !s.mount.contains(t)) return;
      var label = ((t.getAttribute("title") || "") + " " + (t.getAttribute("aria-label") || "") + " " + (t.className || "")).toLowerCase();
      if (label.indexOf("microphone") < 0 && label.indexOf("speak") < 0) return;
      e.preventDefault();
      e.stopPropagation();
      requestMic().then(function (ok) {
        if (!ok) return;
        mic.bypass = true;
        try { t.click(); } finally { mic.bypass = false; }
      });
    }, true);
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

  // TODO #24(c): the banner says what actually happened (sent to the agent or not) and can be dismissed / auto-hides.
  function queueArtifact(s, file, art, sentToAgent) {
    var chat = sentToAgent ? " The agent still received its copy in the chat." : " It was not sent to the agent either (see the attachment note).";
    uploads.active++;
    uploads.queue = uploads.queue.then(function () {
      return F.uploadArtifact({ base: base, code: s.code, conversationId: s.conversationId }, file, art, setUpState);
    }).then(function (res) {
      if (!res.ok) notice("Saving " + file.name + " to GitHub was incomplete (" + res.saved + "/" + res.parts + " parts saved)." + chat, { autoHideMs: 180000 });
    }).catch(function (e) { notice("Saving " + file.name + " to GitHub failed: " + e.message + "." + chat, { autoHideMs: 180000 }); })
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
            notice("Not saved to GitHub: " + f.name + " (" + (e.code === "too_large" ? "larger than the Worker's ARTIFACT_MAX_BYTES" : e.message) + ")", { autoHideMs: 180000 });
            return null;
          }) : Promise.resolve(null);
          return Promise.all([F.planDelivery(f, lim), art]).then(function (v) {
            var plan = v[0], a = v[1];
            if (a) queueArtifact(s, f, a, plan.items.length > 0);
            // the save runs in the background, so don't claim it is already done
            var line = (F.describe(f, plan, a) || "").replace("full original saved to GitHub", "full original being saved to GitHub");
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

  // ---------------- staged attachments (TODO #10) ----------------
  // Paste, drag & drop and the paperclip no longer send at once: files wait above the send box and go out
  // together with the typed text when the user presses Enter (or "Send").
  var staged = [];
  function stagingOn() { return cfg.stageAttachments !== false; }
  function stageFiles(files) {
    files.forEach(function (f, i) {
      var named = f.name && f.name !== "image.png" ? f : new File([f], pastedName(f, i), { type: f.type });
      var item = { id: uuid(), file: named, url: /^image\//.test(named.type) ? URL.createObjectURL(named) : "", blank: false };
      staged.push(item);
      checkBlank(item);
    });
    paintStaged();
  }
  function unstage(id) {
    staged = staged.filter(function (x) {
      if (x.id === id && x.url) URL.revokeObjectURL(x.url);
      return x.id !== id;
    });
    paintStaged();
  }
  function takeStaged() {
    var files = staged.map(function (x) { return x.file; });
    staged.forEach(function (x) { if (x.url) URL.revokeObjectURL(x.url); });
    staged = [];
    paintStaged();
    return files;
  }
  /** A screenshot that is one solid colour is almost always a failed capture - warn on the chip. */
  function checkBlank(item) {
    if (!item.url || typeof createImageBitmap !== "function") return;
    createImageBitmap(item.file).then(function (bmp) {
      var c = document.createElement("canvas");
      c.width = 24; c.height = 24;
      var g = c.getContext("2d");
      g.drawImage(bmp, 0, 0, 24, 24);
      var d = g.getImageData(0, 0, 24, 24).data, lo = [255, 255, 255], hi = [0, 0, 0];
      for (var i = 0; i < d.length; i += 4) for (var k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], d[i + k]); hi[k] = Math.max(hi[k], d[i + k]); }
      item.blank = hi[0] - lo[0] < 6 && hi[1] - lo[1] < 6 && hi[2] - lo[2] < 6;
      if (item.blank) paintStaged();
    }).catch(function () {});
  }
  function paintStaged() {
    if (!el.staged) return;
    el.staged.innerHTML = "";
    el.staged.hidden = !staged.length;
    if (!staged.length) return;
    var list = document.createElement("div");
    list.className = "chips";
    staged.forEach(function (x) {
      var chip = document.createElement("div");
      chip.className = "chip" + (x.blank ? " warn" : "");
      if (x.url) { var img = document.createElement("img"); img.src = x.url; img.alt = ""; chip.appendChild(img); }
      var label = document.createElement("span");
      label.textContent = (x.blank ? "⚠ looks blank · " : "") + x.file.name + " (" + (F ? F.fmt(x.file.size) : x.file.size + " B") + ")";
      label.title = x.blank ? "This image is a single solid colour - probably a failed screenshot." : x.file.name;
      chip.appendChild(label);
      chip.appendChild(button("✕", function () { unstage(x.id); }, "x"));
      chip.lastChild.title = "Remove " + x.file.name;
      chip.lastChild.setAttribute("aria-label", "Remove " + x.file.name);
      list.appendChild(chip);
    });
    el.staged.appendChild(list);
    var bar = document.createElement("div");
    bar.className = "bar";
    var hint = document.createElement("span");
    hint.className = "muted";
    hint.textContent = staged.length + " file" + (staged.length === 1 ? "" : "s") + " attached - type your message and press Enter, or";
    bar.appendChild(hint);
    bar.appendChild(button("Send", function () { sendStaged(); }, "primary"));
    bar.appendChild(button("Remove all", function () { takeStaged(); }));
    el.staged.appendChild(bar);
  }
  function sendBoxText(s) {
    try { var st = s.store.getState(); return String(st.sendBoxValue || ""); } catch (e) { return ""; }
  }
  /** "Send" button: whatever is typed + the staged files, as ONE message. */
  function sendStaged() {
    var s = current;
    if (!s || !s.store || !staged.length) return;
    var text = sendBoxText(s);
    s.store.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: "" } });
    s.store.dispatch({ type: "DIRECT_LINE/POST_ACTIVITY", meta: { method: "keyboard" }, payload: { activity: { type: "message", text: text } } });
  }
  /**
   * Web Chat 4.19 refuses to submit when ITS send box text and ITS attachment list are both empty
   * (SendBoxComposer "empty" error), so with only our staged files Enter / the send button did nothing.
   * Catch them first (capture phase) and send the staged files ourselves.
   */
  function stagedOnlySubmit(s, e) {
    if (!staged.length || s !== current) return false;
    var t = e.target;
    if (!t || !t.closest || !s.mount.contains(t)) return false;
    if (e.type === "keydown") {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.keyCode === 229) return false;
      if (!(t.tagName === "TEXTAREA" || t.tagName === "INPUT") || !t.closest(".webchat__send-box")) return false;
      if (String(t.value || "").trim()) return false;
    } else if (!t.closest(".webchat__send-button")) {
      return false;
    }
    if (sendBoxText(s).trim()) return false; // typed text: Web Chat sends it and storeMiddleware adds the staged files
    e.preventDefault();
    e.stopPropagation();
    sendStaged();
    return true;
  }
  function hookStagedSubmit(s) {
    var h = function (e) { stagedOnlySubmit(s, e); };
    s.mount.addEventListener("keydown", h, true);
    s.mount.addEventListener("click", h, true);
  }
  function toAttachments(files) {
    return files.map(function (f) { return { contentType: f.type || "application/octet-stream", contentUrl: URL.createObjectURL(f), name: f.name }; });
  }

  function pastedName(f, i) {
    if (f.name && f.name !== "image.png") return f.name;
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    var ext = (/\/(\w+)/.exec(f.type || "") || [0, "png"])[1];
    return "pasted-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + (i ? "-" + i : "") + "." + ext;
  }
  /** Paste and drag & drop: stage the files (or, with stageAttachments: false, send them like the paperclip). */
  function sendFiles(files) {
    if (!current || !current.store || !files.length) return;
    if (stagingOn()) { stageFiles(files); return; }
    current.store.dispatch({
      type: "DIRECT_LINE/POST_ACTIVITY", meta: { method: "keyboard" },
      payload: { activity: { type: "message", text: "", attachments: files.map(function (f, i) {
        return { contentType: f.type || "application/octet-stream", contentUrl: URL.createObjectURL(f), name: pastedName(f, i) };
      }) } }
    });
  }

  // ---------------- "agent is working" (TODO #13) ----------------
  var workTimer = null;
  function paintWork() {
    var s = current;
    if (!el.work) return;
    if (!s || !s.pendingSince) { el.work.textContent = ""; el.work.hidden = true; clearInterval(workTimer); workTimer = null; return; }
    var secs = Math.round((Date.now() - s.pendingSince) / 1000);
    el.work.hidden = false;
    el.work.textContent = "⏳ Agent is working… " + secs + "s" + (s.queued > 1 ? " · " + (s.queued - 1) + " more message" + (s.queued > 2 ? "s" : "") + " queued" : "");
    if (!workTimer) workTimer = setInterval(paintWork, 1000);
  }
  function markSent(s) {
    if (!s.pendingSince) { s.pendingSince = Date.now(); s.queued = 0; }
    s.queued = (s.queued || 0) + 1;
    paintWork();
  }
  function markReplied(s) {
    s.pendingSince = 0;
    s.queued = 0;
    if (s === current) paintWork();
  }

  // ---------------- store middleware ----------------
  /** Web Chat store middleware: staging, duplicate guard, Markdown escaping of replies, attachment rewriting. */
  function storeMiddleware(holder) {
    return function (storeApi) {
      return function (next) {
        return function (action) {
          var s = holder.s;
          var type = action && action.type;

          // Web Chat 4.16+ (default sendAttachmentOn: "send"): the paperclip fills Web Chat's OWN attachment bar.
          // Move those files to our chips so there is one list, one Send path and the zip/split/artifact logic applies.
          if (type === "WEB_CHAT/SET_SEND_BOX_ATTACHMENTS" && s && stagingOn() && action.payload &&
              action.payload.attachments && action.payload.attachments.length &&
              action.payload.attachments.every(function (a) { return a && a.blob instanceof Blob; })) {
            stageFiles(action.payload.attachments.map(function (a) {
              return a.blob instanceof File ? a.blob : new File([a.blob], a.name || "file", { type: a.blob.type || "" });
            }));
            return next(Object.assign({}, action, { payload: Object.assign({}, action.payload, { attachments: Object.freeze([]) }) }));
          }
          // paperclip -> stage instead of sending (TODO #10)
          if (type === "WEB_CHAT/SEND_FILES" && s && stagingOn() && action.payload && action.payload.files && action.payload.files.length) {
            Promise.all(action.payload.files.map(function (f) {
              return fetch(f.url).then(function (r) { return r.blob(); }).then(function (b) { return new File([b], f.name || "file", { type: b.type || "" }); });
            })).then(stageFiles, function () { next(action); });
            return;
          }
          // newer Web Chat versions send paperclip files as SEND_MESSAGE with attachments and no text
          var sm = type === "WEB_CHAT/SEND_MESSAGE" && action.payload;
          if (sm && s && stagingOn() && !String(sm.text || "").trim() && sm.attachments && sm.attachments.length &&
              sm.attachments.every(function (a) { return a && a.blob instanceof Blob; })) {
            stageFiles(sm.attachments.map(function (a) {
              return a.blob instanceof File ? a.blob : new File([a.blob], a.name || "file", { type: a.blob.type || "" });
            }));
            return;
          }
          // Enter with an empty send box but staged files: send the files
          if (type === "WEB_CHAT/SUBMIT_SEND_BOX" && s && staged.length && !sendBoxText(s).trim()) {
            storeApi.dispatch({ type: "DIRECT_LINE/POST_ACTIVITY", meta: { method: "keyboard" }, payload: { activity: { type: "message", text: "" } } });
            return;
          }

          // replies: keep the original Markdown (copy buttons), escape <placeholders> for display (TODO #24a)
          if (type === "DIRECT_LINE/INCOMING_ACTIVITY" && s && action.payload && action.payload.activity) {
            var inc = action.payload.activity;
            if ((inc.type === "message" || inc.type === "typing") && !mine(s, inc)) {
              if (inc.type === "message" && inc.id && typeof inc.text === "string") rememberReply(s, inc);
              if (inc.type === "message") agentErrorHint(s, inc);
              if (typeof inc.text === "string" && cfg.escapeAngleBrackets !== false && U) {
                var esc = U.escapeAngles(inc.text);
                if (esc !== inc.text) {
                  inc = Object.assign({}, inc, { text: esc, channelData: Object.assign({}, inc.channelData, { awOriginalText: inc.text }) });
                  action = Object.assign({}, action, { payload: Object.assign({}, action.payload, { activity: inc }) });
                }
              }
            }
            return next(action);
          }

          var act = type === "DIRECT_LINE/POST_ACTIVITY" && action.payload && action.payload.activity;
          if (!s || !act || act.type !== "message" || (act.channelData && act.channelData.awPrepared)) return next(action);

          // staged files join the typed message (TODO #10)
          if (staged.length) {
            act = Object.assign({}, act, { attachments: (act.attachments || []).concat(toAttachments(takeStaged())) });
            action = Object.assign({}, action, { payload: Object.assign({}, action.payload, { activity: act }) });
          }

          // anti double-send (TODO #13)
          var now = Date.now();
          if (!(act.attachments && act.attachments.length) && U && U.isDuplicate(act.text, s.lastSent, now, 30000)) {
            var ago = Math.round((now - s.lastSent.at) / 1000);
            if (!window.confirm("You sent the same message " + ago + "s ago" + (s.pendingSince ? " and the agent is still working on it" : "") + ". Send it again?")) {
              storeApi.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: act.text || "" } });
              return;
            }
          }
          s.lastSent = { text: act.text || "", at: now };
          markSent(s);

          if (!F || !act.attachments || !act.attachments.length) return next(action);
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
            notice("Couldn't prepare the attachments (" + e.message + "); sending them unchanged.", { autoHideMs: 60000 });
            return next(action);
          });
        };
      };
    };
  }
  // kept for compatibility with earlier code/tests
  var filesMiddleware = storeMiddleware;

  /**
   * Copilot Studio failures arrive as ordinary replies ("... reference code MCS-4041 ... (Error code: SystemError)").
   * Seen repeatedly at the end of very long conversations: retrying in the same conversation doesn't help, so say so.
   * Only for new replies (not history replayed on resume).
   */
  function isAgentError(text) {
    return typeof text === "string" && /\bMCS-\d{3,}\b/.test(text) && /error/i.test(text);
  }
  function agentErrorHint(s, a) {
    if (!isAgentError(a.text)) return;
    var t = Date.parse(a.timestamp || "");
    if (t && t < s.startedAt - 5000) return;
    var code = (/\bMCS-\d{3,}\b/.exec(a.text) || [""])[0];
    notice("The agent hit an error on its side (" + code + "). If it happens again, this conversation is probably stuck - start a New chat (History keeps this one).", { autoHideMs: 120000 });
    var nc = button("New chat", function () { notice(""); el.newChat.click(); });
    el.notice.appendChild(nc);
  }

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
    if (!s || !s.mount || s !== current) return;
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

  // ---------------- clear chat (TODO #21) ----------------
  function clearedAt(s) { return (s && s.conversationId && jsonGet(localStorage, K.cleared, {})[s.conversationId]) || 0; }
  function setCleared(s, ts) {
    var m = jsonGet(localStorage, K.cleared, {});
    if (ts) m[s.conversationId] = ts; else delete m[s.conversationId];
    var keys = Object.keys(m);
    if (keys.length > 100) keys.slice(0, keys.length - 100).forEach(function (k) { delete m[k]; });
    localStorage.setItem(K.cleared, JSON.stringify(m));
  }
  /** Hides activities older than the "cleared at" marker; the conversation itself is untouched. */
  function activityMiddleware(holder) {
    return function () {
      return function (next) {
        return function () {
          var args = arguments, card = args[0], a = card && card.activity, s = holder.s;
          var t = a && Date.parse(a.timestamp || (a.channelData && a.channelData.clientTimestamp) || "");
          var cut = clearedAt(s);
          if (cut && t && t < cut) return false;
          if (a && a.type === "event" && a.name === "aw/refresh") return false;
          return next.apply(null, args);
        };
      };
    };
  }
  /** Web Chat re-evaluates activity middleware when the activity list changes: push a local, invisible event. */
  function refreshTranscript(s) {
    if (!s || !s.store) return;
    s.store.dispatch({
      type: "DIRECT_LINE/INCOMING_ACTIVITY",
      payload: { activity: { type: "event", name: "aw/refresh", id: "aw-refresh-" + Date.now(), from: { id: "aw-page", role: "bot" },
        timestamp: new Date().toISOString(), channelData: {} } }
    });
  }
  /**
   * "Cleared at" in SERVER time: the newest activity timestamp on screen (+1 ms). Using Date.now() hid fresh replies
   * whenever the device clock ran ahead of Direct Line's clock (activities are compared by their server timestamp).
   */
  function clearMarker(s) {
    var newest = 0;
    try {
      s.store.getState().activities.forEach(function (a) {
        if (a && a.type === "event" && a.name === "aw/refresh") return;
        var t = Date.parse((a && a.timestamp) || "");
        if (t > newest) newest = t;
      });
    } catch (e) {}
    return newest ? newest + 1 : Date.now();
  }
  function clearChat() {
    var s = current;
    if (!s || !s.conversationId) return;
    if (!window.confirm("Clear the screen?\n\nThe agent still remembers this conversation (use New chat for a fresh start). The saved transcript and attachments are not touched.")) return;
    setCleared(s, clearMarker(s));
    refreshTranscript(s);
    notice("Chat cleared - same session, the agent still remembers it.", { autoHideMs: 10000 });
    var undo = button("Undo", function () { setCleared(s, 0); refreshTranscript(s); notice(""); });
    el.notice.appendChild(undo);
    setTimeout(function () { undo.remove(); }, 10000);
  }

  // ---------------- session info (TODO #22) ----------------
  function showSession() {
    var s = current;
    if (!s) return;
    openPanel("This session");
    el.panelBody.innerHTML = "";
    var tz = cfg.logTimeZone || "Asia/Kolkata";
    var day = U ? U.dayIn(new Date(s.startedAt), tz) : "";
    var msgs = 0;
    try { msgs = s.store.getState().activities.filter(function (a) { return a.type === "message"; }).length; } catch (e) {}
    var rows = [
      ["Conversation id", s.conversationId || "(not connected yet)", true],
      ["User id", s.userId, true],
      ["Person", s.name ? s.name + (s.admin ? " (admin)" : "") : "-"],
      ["Agent", TITLE],
      ["Started", new Date(s.startedAt).toLocaleString() + (s.resumed ? " (resumed in this tab)" : "")],
      ["Messages on screen", String(msgs)],
      ["Cleared at", clearedAt(s) ? new Date(clearedAt(s)).toLocaleString() : "-"]
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
        var b = button("Copy", function () { copyText(r[1], b); });
        b.className = "small";
        row.appendChild(document.createTextNode(" "));
        row.appendChild(b);
      }
      doc.appendChild(row);
    });
    var links = [];
    if (cfg.logRepo !== "" && day) links.push(["Transcript folders for " + day, "https://github.com/" + (cfg.logRepo || "silicon-valley-mafia/agent-webchat-logs") + "/tree/main/logs/" + day]);
    if (cfg.artifactRepo !== "" && day) links.push(["Uploads for " + day, "https://github.com/" + (cfg.artifactRepo || "silicon-valley-mafia/agent-webchat-artifcats-1") + "/tree/main/webchat-uploads/" + day]);
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
    el.panelBody.appendChild(doc);
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
    clearTimeout(s.decorateTimer);
    if (s.observer) try { s.observer.disconnect(); } catch (e) {}
    if (flush && s.dirty) saveLog(s);
    s.subs.forEach(function (x) { try { x.unsubscribe(); } catch (e) {} });
    try { s.directLine.end(); } catch (e) {}
  }
  function renderChat(s) {
    window.WebChat.renderWebChat({
      directLine: s.directLine, store: s.store, userID: s.userId, username: s.name,
      locale: cfg.locale || "en-US", styleOptions: styleOptions(s),
      activityMiddleware: s.activityMiddleware,
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
      directLine: directLine, store: window.WebChat.createStore ? window.WebChat.createStore({}, storeMiddleware(holder)) : undefined,
      subs: [], code: code, conversationId: t.conversationId || null, userId: t.userId || ("dl_" + uuid()),
      name: t.name || "", admin: !!t.admin, startedAt: Date.now(), resumed: !!resumed, logTimer: null, dirty: false,
      replies: [], replyIndex: {}, pendingSince: 0, queued: 0, lastSent: null,
      activityMiddleware: activityMiddleware(holder)
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
        var isMine = mine(s, a);
        if (!isMine && !old) { maybeNotify(s, a); markReplied(s); }
        scheduleDecorate(s);
      }
    }));

    // Fresh mount point every time (reusing the old element broke "New chat").
    el.chatWrap.innerHTML = "";
    s.mount = document.createElement("div");
    el.chatWrap.appendChild(s.mount);
    hookMic(s);
    hookStagedSubmit(s);
    renderChat(s);
    if (window.MutationObserver) {
      s.observer = new MutationObserver(function () { scheduleDecorate(s); });
      s.observer.observe(s.mount, { childList: true, subtree: true });
    }

    current = s;
    rememberSession(s);
    localStorage.setItem(K.code, code);
    el.who.textContent = s.name ? s.name + (s.admin ? " (admin)" : "") : "";
    setLogState("");
    paintWork();
    el.gate.hidden = true;
    el.chatWrap.hidden = false;
    sessionButtons(true);
    el.status.textContent = "";
    return s;
  }
  function sessionButtons(show) {
    [el.newChat, el.forget, el.history, el.download, el.clear, el.session].forEach(function (b) { if (b) b.hidden = !show; });
    if (!show && el.expandAll) el.expandAll.hidden = true;
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
        var sid = /--(.+)$/.exec(item.path);
        if (sid) label.title = "Session " + sid[1];
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
    sessionButtons(false);
    takeStaged();
    paintWork();
    setLogState("");
    closePanel();
    showGate("Access code removed from this browser.");
  });
  el.history.addEventListener("click", function () { showHistory(); });
  el.panelClose.addEventListener("click", closePanel);
  el.download.addEventListener("click", function () { downloadCurrent(); });
  if (el.noticeClose) el.noticeClose.addEventListener("click", function () { notice(""); });
  if (el.clear) el.clear.addEventListener("click", clearChat);
  if (el.session) el.session.addEventListener("click", showSession);
  if (el.expandAll) el.expandAll.addEventListener("click", function () {
    if (!current) return;
    var anyCollapsed = !!current.mount.querySelector(".aw-collapsed, .aw-hidden");
    setAll(current, anyCollapsed ? "expanded" : "collapsed");
    el.expandAll.textContent = anyCollapsed ? "Collapse all" : "Expand all";
  });
  if (el.width) el.width.addEventListener("click", function () {
    localStorage.setItem(K.width, widthMode() === "wide" ? "narrow" : "wide");
    paintWidth();
  });
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
  paintWidth();
  paintNotify();
  watchMicPermission();
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
    prepareOutgoing: prepareOutgoing, filesMiddleware: filesMiddleware, storeMiddleware: storeMiddleware, sendFiles: sendFiles,
    uploads: uploads, staged: function () { return staged.slice(); }, stageFiles: stageFiles, sendStaged: sendStaged,
    stagedOnlySubmit: stagedOnlySubmit, isAgentError: isAgentError, clearMarker: clearMarker,
    decorate: function () { decorate(current); }, activityMiddleware: activityMiddleware, clearChat: clearChat
  };
})();
