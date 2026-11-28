/* agent-webchat: TODO #50 - Copy / Reuse buttons on the messages you send.
 *
 * Every bubble you sent (".webchat__bubble--from-user") gets a small bar under it:
 *   Copy  - copies the text you typed (clipboard, with a fallback for older browsers)
 *   Reuse - puts that text back into the send box so you can edit and send it again
 * The session header added by header.js (#51) is not part of what you typed, so it is removed from the copy:
 *   "[session header]\n...\n[end of header]\n\n<your text>" -> "<your text>"
 * Bubbles without text (attachment only) get no bar. Works in every open chat (Chats sidebar #23) because it
 * watches the page for new bubbles. app.js is unchanged.
 * Off switch: copyPrompt: false in web/config.js.
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var api = {};
  var HEAD = "[session header]\n";
  var END = "\n[end of header]";

  /** Pure: the text the person typed, without a #51 session header block on top. */
  function stripHeader0(text) {
    var t = String(text == null ? "" : text).replace(/\r\n/g, "\n");
    if (t.indexOf(HEAD) !== 0) return t.trim();
    var end = t.indexOf(END, HEAD.length - 1);
    if (end < 0) return t.trim();
    return t.slice(end + END.length).replace(/^\n+/, "").trim();
  }
  /** ...and a #37b "[route: coach]" line, so Copy / Reuse give back only what you typed. */
  api.stripHeader = function (text) { return stripHeader0(text).replace(/^\[route: [A-Za-z0-9_-]+\]\n?/, "").trim(); };

  function legacyCopy(doc, text) {
    var ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = doc.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }
  api.copy = function (text, btn) {
    var doc = root.document;
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = "Copied \u2713";
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    var nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      return nav.clipboard.writeText(text).then(done, function () { if (legacyCopy(doc, text)) done(); });
    }
    if (legacyCopy(doc, text)) done();
    return Promise.resolve();
  };

  /** The send box of the chat that contains this bubble (or the first visible one). */
  function sendBox(bubble) {
    var doc = root.document;
    var sel = ".webchat__send-box-text-box__input";
    var n = bubble;
    while (n && n !== doc.body) {
      if (n.querySelector) {
        var box = n.querySelector(sel);
        if (box) return box;
      }
      n = n.parentNode;
    }
    var all = doc.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) return all[i];
    return all[0] || null;
  }
  /** Sets a React-controlled input's value so Web Chat notices it. */
  api.fill = function (box, text) {
    if (!box) return false;
    var proto = box.tagName === "TEXTAREA" ? root.HTMLTextAreaElement : root.HTMLInputElement;
    var desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value");
    if (desc && desc.set) desc.set.call(box, text); else box.value = text;
    box.dispatchEvent(new root.Event("input", { bubbles: true }));
    box.focus();
    try { box.setSelectionRange(text.length, text.length); } catch (e) {}
    return true;
  };

  function contentOf(b) { return b.querySelector(".webchat__bubble__content") || b; }
  function typedText(b) {
    // #56: gfm.js renders the prompt and keeps the raw text on the bubble
    if (typeof b.__awRaw === "string") return api.stripHeader(b.__awRaw);
    return api.stripHeader(contentOf(b).innerText || contentOf(b).textContent || "");
  }

  function btn(label, title, onClick) {
    var x = root.document.createElement("button");
    x.type = "button";
    x.className = "aw-ptool";
    x.textContent = label;
    x.title = title;
    x.setAttribute("aria-label", title);
    x.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); onClick(x); });
    return x;
  }
  api.decorate = function (scope) {
    var list = (scope || root.document).querySelectorAll(".webchat__bubble--from-user");
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.__awPrompt) continue;
      if (!typedText(b)) continue; // attachment only, or not rendered yet
      b.__awPrompt = true;
      var bar = root.document.createElement("div");
      bar.className = "aw-ptools";
      (function (bubble) {
        bar.appendChild(btn("Copy", "Copy this prompt", function (x) { api.copy(typedText(bubble), x); }));
        bar.appendChild(btn("Reuse", "Put this prompt back in the send box", function () { api.fill(sendBox(bubble), typedText(bubble)); }));
      })(b);
      b.appendChild(bar);
      added++;
    }
    return added;
  };

  root.AgentCopyPrompt = api;
  if (cfg.copyPrompt === false) return;
  var doc = root.document;
  if (!doc || typeof root.MutationObserver !== "function") return;

  var css = doc.createElement("style");
  css.textContent =
    ".aw-ptools{display:flex;gap:6px;justify-content:flex-end;margin-top:2px;opacity:.55;transition:opacity .15s}" +
    ".webchat__bubble--from-user:hover .aw-ptools,.aw-ptools:focus-within{opacity:1}" +
    ".aw-ptool{font:inherit;font-size:11px;line-height:1.4;padding:1px 7px;border-radius:9px;border:1px solid currentColor;" +
    "background:transparent;color:inherit;cursor:pointer;opacity:.8}.aw-ptool:hover{opacity:1}" +
    "@media (hover:none){.aw-ptools{opacity:.8}}";
  (doc.head || doc.documentElement).appendChild(css);

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; api.decorate(); }, 150);
  }
  function start() {
    new root.MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (doc.body) start(); else doc.addEventListener("DOMContentLoaded", start);
})(typeof window !== "undefined" ? window : globalThis);
