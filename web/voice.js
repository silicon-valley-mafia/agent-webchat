/* agent-webchat: voice diagnostics (TODO #25 / #40). Web Chat's browser speech (Web Speech API) fails silently:
 * the mic shows "Listening..." for a moment and falls back to the text box with no text and no reason. This wraps
 * the speech ponyfill factory so every dictation attempt is traced (start, audio, sound, speech, results, errors,
 * end, and who stopped it), and an attempt that ends WITHOUT text tells the user why.
 * Loaded after webchat.js and before app.js, it installs itself: WebChat.createBrowserWebSpeechPonyfillFactory and
 * WebChat.createStore are wrapped in place, so app.js needs no change. Off switch: voiceDiagnostics: false in config.js.
 * Console: AgentVoice.trace() -> recent events; AgentVoice.report() -> one-line summary of the last attempt. */
(function (root) {
  "use strict";
  var MAX = 80;
  var events = [];
  var attempts = 0;
  var last = null;
  var now = function () { return Date.now(); };

  function note(type, info) {
    events.push({ at: now(), attempt: last ? last.n : 0, type: String(type), info: info === undefined ? "" : info });
    if (events.length > MAX) events.splice(0, events.length - MAX);
  }

  var REASONS = {
    "not-allowed": "the microphone or speech recognition is blocked for this site - allow the microphone (🔒 in the address bar), then reload.",
    "service-not-allowed": "this browser doesn't provide a speech-to-text service here (Brave and some other Chromium browsers don't). Use Chrome or Edge.",
    "network": "the browser couldn't reach its speech-to-text service (Chrome sends the audio to Google; Brave and some Chromium builds have no service; a VPN, firewall or offline network blocks it). Try Chrome or Edge, or another network.",
    "audio-capture": "no audio came from the microphone - check the input device (OS sound settings, or Chrome: 🔒 → Site settings → Microphone).",
    "no-speech": "no speech was heard - check that the right microphone is selected and start speaking right after \"Listening...\".",
    "aborted": "dictation was stopped before any text came back.",
    "language-not-supported": "the speech language isn't supported by this browser's speech service.",
    "bad-grammar": "the browser rejected the speech settings (grammar).",
    "phrases-not-supported": "the browser rejected the speech settings (phrases).",
    "no-match": "speech was heard but not recognised as words - try again, closer to the microphone.",
    "silent": "the microphone opened but no sound reached the speech service - check the selected input device and its level.",
    "no-audio": "the speech service started but never received audio from the microphone.",
    "start-failed": "the browser refused to start speech recognition.",
    "unknown": "the browser's speech service ended without returning any text."
  };
  function reason(code) { return REASONS[code] || REASONS.unknown; }

  /** Pure: decides what went wrong in one attempt (exported for tests). */
  function classify(a) {
    if (a.text) return null;
    if (a.error) return a.error;
    if (a.startError) return "start-failed";
    if (a.nomatch || a.speech) return "no-match";
    if (a.sound) return "no-speech";
    if (a.audio) return "silent";
    if (a.started) return "no-audio";
    return "unknown";
  }
  function summary(a) {
    var code = classify(a);
    var secs = ((a.endedAt || now()) - a.calledAt) / 1000;
    var steps = a.steps.join(" → ");
    return { code: code, seconds: Math.round(secs * 10) / 10, steps: steps, lang: a.lang,
      text: "🎤 Dictation gave no text: " + reason(code) + " [" + code + ", " + (Math.round(secs * 10) / 10) + " s, " +
        (a.lang ? "lang " + a.lang + ", " : "") + steps + "]" };
  }

  function watch(r, opts) {
    var a = { n: ++attempts, calledAt: now(), steps: [], text: "", lang: "", error: "", startError: "",
      started: false, audio: false, sound: false, speech: false, nomatch: false, endedAt: 0, reported: false };
    function step(s, info) { a.steps.push(s); note(s, info); }
    var on = function (type, fn) { try { r.addEventListener(type, fn); } catch (e) {} };
    on("start", function () { a.started = true; step("start"); });
    on("audiostart", function () { a.audio = true; step("audio"); });
    on("soundstart", function () { a.sound = true; step("sound"); });
    on("speechstart", function () { a.speech = true; step("speech"); });
    on("speechend", function () { step("speechend"); });
    on("nomatch", function () { a.nomatch = true; step("nomatch"); });
    on("result", function (e) {
      var t = "";
      try {
        var list = e.results || [];
        for (var i = 0; i < list.length; i++) t += (list[i] && list[i][0] && list[i][0].transcript) || "";
      } catch (x) {}
      if (t.trim()) a.text = t;
      step("result", t.slice(0, 60));
    });
    on("error", function (e) { a.error = (e && e.error) || "error"; step("error:" + a.error, e && e.message || ""); });
    on("end", function () {
      a.endedAt = now();
      step("end");
      if (a.reported) return;
      a.reported = true;
      var s = summary(a);
      if (s.code && opts && typeof opts.onProblem === "function") {
        try { opts.onProblem(s.text, s); } catch (x) {}
      }
    });
    ["start", "stop", "abort"].forEach(function (m) {
      var orig = r[m];
      if (typeof orig !== "function") return;
      r[m] = function () {
        if (m === "start") { a.calledAt = now(); a.lang = r.lang || ""; step("start()", "lang=" + (r.lang || "") + " continuous=" + !!r.continuous + " interim=" + !!r.interimResults); }
        else step(m + "()");
        try { return orig.apply(r, arguments); }
        catch (e) {
          if (m === "start") {
            a.startError = (e && e.name) || "error";
            step("start-failed:" + a.startError, e && e.message || "");
            if (opts && typeof opts.onProblem === "function") { a.reported = true; try { opts.onProblem(summary(a).text, summary(a)); } catch (x) {} }
          }
          throw e;
        }
      };
    });
    last = a;
    return r;
  }

  function wrapPonyfill(p, opts) {
    if (!p || typeof p.SpeechRecognition !== "function") return p;
    var Base = p.SpeechRecognition;
    function Recognition() { return watch(new Base(), opts); }
    Recognition.prototype = Base.prototype;
    var out = {};
    for (var k in p) out[k] = p[k];
    out.SpeechRecognition = Recognition;
    return out;
  }
  function wrapFactory(factory, opts) {
    if (typeof factory !== "function") return factory;
    return function () {
      var p = factory.apply(this, arguments);
      if (p && typeof p.then === "function") return p.then(function (x) { return wrapPonyfill(x, opts); });
      return wrapPonyfill(p, opts);
    };
  }

  // ---- self-install: no app.js change needed (app.js is close to the push size limit) ----
  var noticeTimer = null;
  function showNotice(text) {
    var doc = root.document;
    var box = doc && doc.getElementById && doc.getElementById("notice");
    if (!box) { try { console.warn(text); } catch (e) {} return; }
    var t = doc.getElementById("noticetext") || box;
    var close = doc.getElementById("noticeclose");
    // same rule as app.js notice(): drop action buttons left by an earlier notice ("New chat", "Undo")
    try { Array.prototype.slice.call(box.children || []).forEach(function (c) { if (c !== t && c !== close) c.remove(); }); } catch (e) {}
    t.textContent = text;
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { if (t.textContent === text) { t.textContent = ""; box.hidden = true; } }, 45000);
  }
  /** Redux middleware for Web Chat's store: records START/STOP_DICTATE etc. so the trace shows who ended an attempt. */
  function dictateMiddleware() {
    return function (next) {
      return function (action) {
        var t = action && action.type;
        if (typeof t === "string" && t.indexOf("DICTATE") >= 0) {
          var info = "";
          try { info = action.payload === undefined ? "" : JSON.stringify(action.payload).slice(0, 80); } catch (e) {}
          note(t, info);
        }
        return next(action);
      };
    };
  }
  /** Wraps WebChat.createBrowserWebSpeechPonyfillFactory and WebChat.createStore in place. Returns what was wrapped. */
  function install(W, opts) {
    var done = { speech: false, store: false };
    if (!W || W.__awVoice) return done;
    var onProblem = (opts && opts.onProblem) || showNotice;
    try {
      var f = W.createBrowserWebSpeechPonyfillFactory;
      if (typeof f === "function") {
        W.createBrowserWebSpeechPonyfillFactory = function () { return wrapFactory(f.apply(this, arguments), { onProblem: onProblem }); };
        done.speech = W.createBrowserWebSpeechPonyfillFactory !== f;
      }
    } catch (e) {}
    try {
      var cs = W.createStore;
      if (typeof cs === "function") {
        W.createStore = function () {
          var args = Array.prototype.slice.call(arguments);
          if (!args.length) args.push({});
          args.push(dictateMiddleware);
          return cs.apply(this, args);
        };
        done.store = W.createStore !== cs;
      }
    } catch (e) {}
    try { W.__awVoice = true; } catch (e) {}
    note("installed", "speech=" + done.speech + " store=" + done.store);
    return done;
  }

  root.AgentVoice = {
    install: install, dictateMiddleware: dictateMiddleware, showNotice: showNotice,
    wrapFactory: wrapFactory, wrapPonyfill: wrapPonyfill, classify: classify, reason: reason, note: note,
    trace: function () { return events.slice(); },
    report: function () {
      if (!last) return "no dictation yet";
      var s = summary(last);
      return last.text ? "ok (" + s.seconds + " s): \"" + last.text + "\" [" + s.steps + "]" : s.text;
    }
  };
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  if (root.WebChat && cfg.voiceDiagnostics !== false) install(root.WebChat);
})(typeof window !== "undefined" ? window : globalThis);
