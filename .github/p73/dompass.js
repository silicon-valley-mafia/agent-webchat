  /* ---------- DOM pass ---------- */
  /** The store activity a bubble shows (AgentTime.match ignores the session header, fence lines and alert markers). */
  function storeAct(shown, fromUser) {
    var a = root.__agentWebchat, s = a && a.cur ? a.cur() : null, st = s && s.store;
    if (!st || !root.AgentTime || !root.AgentTime.match) return null;
    try {
      var act = root.AgentTime.match(st.getState().activities || [], shown, fromUser, null);
      return act && typeof act.text === "string" ? act : null;
    } catch (e) { return null; }
  }
  function actText(act) {
    var orig = act.channelData && act.channelData.awOriginalText;
    return typeof orig === "string" ? orig : act.text;
  }
  /** Raw text of an agent reply (null when the store has no match). */
  function rawOf(shown) { var act = storeAct(shown, false); return act ? actText(act) : null; }
  /** Text of Web Chat's own (hidden or visible) text element, one line per paragraph / line break. */
  function domText(src) {
    var ps = src.querySelectorAll("p");
    if (ps.length > 1) {
      return Array.prototype.map.call(ps, function (p) {
        return Array.prototype.map.call(p.childNodes, function (n) { return n.nodeName === "BR" ? "\n" : n.textContent; }).join("");
      }).join("\n");
    }
    return src.classList.contains("aw-src") ? (src.textContent || "") : (src.innerText || src.textContent || "");
  }

  /* agent replies: Web Chat renders the Markdown; add what its renderer lacks (alerts, task lists, code colours) */
  function firstText(el) {
    var n = el && el.firstChild;
    while (n && n.nodeType === 3 && !/\S/.test(n.data)) n = n.nextSibling;
    return n && n.nodeType === 3 ? n : null;
  }
  function alerts(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll(".webchat__render-markdown blockquote:not(.markdown-alert)"), function (bq) {
      var p = bq.firstElementChild, t = p && p.tagName === "P" ? firstText(p) : null;
      var m = t && /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(t.data);
      if (!m) return;
      var kind = m[1].toLowerCase();
      t.data = t.data.slice(m[0].length);
      if (!t.data && t.nextSibling && t.nextSibling.nodeName === "BR") p.removeChild(t.nextSibling);
      if (!p.textContent.trim() && !p.querySelector("*:not(br)")) p.remove();
      var title = doc.createElement("p");
      title.className = "markdown-alert-title";
      title.textContent = ALERTS[kind];
      bq.insertBefore(title, bq.firstChild);
      bq.classList.add("markdown-alert", "markdown-alert-" + kind);
    });
  }
  function taskLists(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll(".webchat__render-markdown li:not(.task-list-item)"), function (li) {
      var host = li.firstElementChild && li.firstElementChild.tagName === "P" && !firstText(li) ? li.firstElementChild : li;
      var t = firstText(host), m = t && /^\s*\[([ xX])\]\s+/.exec(t.data);
      if (!m) return;
      t.data = t.data.slice(m[0].length);
      var box = doc.createElement("input");
      box.type = "checkbox"; box.disabled = true; box.checked = m[1] !== " ";
      host.insertBefore(box, t);
      host.insertBefore(doc.createTextNode(" "), t);
      li.classList.add("task-list-item");
      if (li.parentNode && li.parentNode.classList) li.parentNode.classList.add("contains-task-list");
    });
  }
  var hlState = 0; // 0 = not loaded, 1 = loading, 2 = ready, 3 = failed
  function loadHljs() {
    if (root.hljs) { hlState = 2; return true; }
    if (hlState) return false;
    hlState = 1;
    var s = doc.createElement("script");
    s.src = cfg.highlightSrc || "vendor/highlight.min.js";
    s.async = true;
    s.onload = function () { hlState = root.hljs ? 2 : 3; schedule(); };
    s.onerror = function () { hlState = 3; };
    (doc.head || doc.documentElement).appendChild(s);
    return false;
  }
  function langOf(code) {
    var m = /(?:^|\s)language-([\w+#.-]+)/.exec(code.className || "");
    return m ? m[1].toLowerCase() : "";
  }
  function colourCode(scope) {
    if (cfg.codeHighlight === false) return 0;
    var n = 0, ready = null;
    // agent replies: language from the code's class, else from the fences in the raw reply text (same order)
    Array.prototype.forEach.call(scope.querySelectorAll(".webchat__bubble:not(.webchat__bubble--from-user) .webchat__bubble__content"), function (c) {
      var pres = c.querySelectorAll("pre");
      if (!pres.length) return;
      var langs = c.__awLangs || null;
      Array.prototype.forEach.call(pres, function (pre, k) {
        var code = pre.querySelector("code");
        if (!code) return;
        var lang = langOf(code);
        if (!lang) {
          if (langs === null) {
            var raw = rawOf(c.innerText || c.textContent || "");
            langs = raw == null ? [] : (c.__awLangs = fenceLangs(raw));
          }
          lang = langs[k] || "";
        }
        if (lang && !pre.getAttribute("data-lang")) pre.setAttribute("data-lang", lang);
        if (!lang) return;
        if (ready === null) ready = loadHljs();
        if (ready && highlight(code, lang, root.hljs)) n++;
      });
    });
    // our own Markdown (prompts, History): the renderer already put language-xxx on the code
    Array.prototype.forEach.call(scope.querySelectorAll(".aw-md pre > code[class*='language-'], #historybody pre > code[class*='language-']"), function (code) {
      if (code.closest && code.closest(".aw-src")) return;
      if (ready === null) ready = loadHljs();
      if (ready && highlight(code, langOf(code), root.hljs)) n++;
    });
    return n;
  }
  function prompts(scope) {
    var n = 0;
    Array.prototype.forEach.call(scope.querySelectorAll(".webchat__bubble--from-user .webchat__bubble__content"), function (c) {
      var src = c.querySelector(".webchat__text-content");
      if (!src) return;
      var key = src.textContent || "";
      if (!key.trim()) return;
      var view = c.querySelector(".aw-prompt");
      if (view && c.__awKey === key && c.__awFrom === "store") { src.classList.add("aw-src"); return; }
      // the exact text from the store (keeps line breaks, indentation, the session header); else what is shown
      var shown = domText(src);
      var act = storeAct(shown, true);
      if (view && c.__awKey === key && !act) { src.classList.add("aw-src"); return; }
      var raw = act ? actText(act) : shown;
      c.__awFrom = act ? "store" : "dom";
      if (!view) { view = doc.createElement("div"); view.className = "aw-prompt aw-md"; src.parentNode.insertBefore(view, src.nextSibling); }
      view.innerHTML = renderPrompt(raw);
      view.setAttribute("data-aw-from", c.__awFrom);
      src.classList.add("aw-src");
      c.__awKey = key;
      var b = c.closest ? c.closest(".webchat__bubble") : null;
      if (b) b.__awRaw = raw;
      n++;
    });
    return n;
  }
  function copyButtons(scope) {
    if (cfg.codeCopyButtons === false) return 0;
    var n = 0;
    Array.prototype.forEach.call(scope.querySelectorAll(".webchat__bubble pre, .aw-md pre, #historybody pre"), function (pre) {
      if (pre.querySelector(".aw-codecopy") || (pre.closest && pre.closest(".aw-src, .aw-hdr"))) return;
      var b = doc.createElement("button");
      b.type = "button"; b.className = "aw-codecopy";
      b.setAttribute("aria-label", "Copy code"); b.title = "Copy code";
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        var text = codeText(pre);
        var done = function () { b.classList.add("done"); setTimeout(function () { b.classList.remove("done"); }, 1500); };
        if (root.AgentCopyPrompt && root.AgentCopyPrompt.copy) root.AgentCopyPrompt.copy(text, null).then(done, function () {});
        else if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(text).then(done, function () {});
      });
      pre.classList.add("aw-haspre");
      pre.insertBefore(b, pre.firstChild);
      n++;
    });
    return n;
  }
  function scan() {
    var n = 0;
    if (cfg.userMarkdown !== false) n += prompts(doc);
    alerts(doc);
    taskLists(doc);
    n += copyButtons(doc);
    n += colourCode(doc);
    return n;
  }
  api.scan = scan;
  var timer = null;
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; scan(); }, 120); }
  function start() {
    new root.MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (doc.body) start(); else doc.addEventListener("DOMContentLoaded", start);
})(typeof window !== "undefined" ? window : globalThis);
