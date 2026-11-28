/* agent-webchat: GitHub-style Markdown (TODO #56) + copy button on code blocks (TODO #58).
 *
 * (a) Agent replies: Web Chat already turns them into HTML (its own markdown-it, sanitised); gfm.css gives them the
 *     GitHub look (tables with borders and zebra rows, code blocks, blockquote bar, headings with a rule).
 * (b) Your prompts: Web Chat shows them as plain text. Here each prompt bubble is rendered with the small GFM renderer
 *     below (tables, task lists, strikethrough, autolinks, nested lists, code fences) in a blue-tinted theme.
 *     The original text stays in the bubble (hidden), so Web Chat / React keep working; Copy / Reuse (#50) copy
 *     the raw Markdown you typed (bubble.__awRaw), not the HTML. A #51 session header block becomes a small fold,
 *     a #37b "[route: coach]" line a small chip.
 * (c) Group chat (#43): every agent column gets its own background tint (gfm.css, by column number).
 * (d) #58: every <pre> block in replies, prompts and the History panel gets a Copy button (copies the raw text).
 * (e) History / transcript panel: AgentMarkdown.renderMarkdown is replaced by the same renderer (load order:
 *     markdown.js, gfm.js, app.js), so History looks like the chat.
 * Safety: everything is HTML-escaped first; raw HTML in Markdown is shown as text; links only http(s) / mailto;
 * images are shown as links (no outside image loads).
 * Off switches (web/config.js): gfmMarkdown: false (all of it), userMarkdown: false (plain prompts),
 * agentColors: false (no group tints), codeCopyButtons: false. Console: AgentGfm.render("**hi**"), AgentGfm.scan().
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};

  /* ---------- pure renderer (tested in worker/test/gfm.test.js) ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function safeUrl(u) {
    u = String(u || "").trim();
    if (/^www\./i.test(u)) u = "https://" + u;
    return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
  }
  function anchor(url, html, title) {
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + html + "</a>";
  }

  /** Inline Markdown -> HTML. opts.breaks (default true): a single newline is a line break, like GitHub comments. */
  function inline(src, opts) {
    var keep = [];
    function hold(html) { keep.push(html); return "\u0001" + (keep.length - 1) + "\u0002"; }
    var s = String(src == null ? "" : src).replace(/[\u0001\u0002]/g, "");
    // code spans first: nothing inside them is Markdown
    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) {
      code = code.replace(/\n/g, " ");
      if (/^ [\s\S]* $/.test(code) && /\S/.test(code)) code = code.slice(1, -1);
      return hold("<code>" + esc(code) + "</code>");
    });
    // backslash escapes and hard line breaks written as "\" at the end of a line
    s = s.replace(/\\\n/g, function () { return hold("<br>"); });
    s = s.replace(/\\([!-\/:-@\[-`{-~])/g, function (m, c) { return hold(esc(c)); });
    // <https://...> autolinks
    s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, function (m, u) { return hold(anchor(u, esc(u))); });
    // images: shown as a link, never loaded
    s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g, function (m, alt, u, t) {
      var url = safeUrl(u);
      var label = "\uD83D\uDDBC " + esc(alt || "image");
      return hold(url ? anchor(url, label, t) : label);
    });
    // [text](url "title")
    s = s.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g, function (m, text, u, t) {
      var url = safeUrl(u), inner = inline(text, { breaks: false, nolinks: true });
      return hold(url ? anchor(url, inner, t) : inner);
    });
    // bare URLs (GFM autolink extension)
    if (!(opts && opts.nolinks)) {
      s = s.replace(/(^|[\s(*_~])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"')\]!?*_~])/gi, function (m, pre, u) {
        return pre + hold(anchor(safeUrl(u), esc(u)));
      });
    }
    s = esc(s);
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
      .replace(/(^|[^*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^*])\*([^\s*])\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_]|[^\s_])_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
      .replace(/(^|[^~])~(?=[^\s~])([^~\n]*?[^\s~]|[^\s~])~(?!~)/g, "$1<del>$2</del>");
    if (!opts || opts.breaks !== false) s = s.replace(/ *\n/g, "<br>\n");
    else s = s.replace(/ {2,}\n/g, "<br>\n");
    // restore held pieces (they can contain other held pieces, e.g. code inside a link)
    for (var guard = 0; guard < 5 && /\u0001\d+\u0002/.test(s); guard++) {
      s = s.replace(/\u0001(\d+)\u0002/g, function (m, n) { return keep[+n]; });
    }
    return s;
  }

  var RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/,
    heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}> ?/,
    item: /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/,
    delim: /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/
  };
  function indentOf(l) { return l.match(/^ */)[0].length; }
  function blank(l) { return !/\S/.test(l); }
  function cells(line) {
    var t = line.trim().replace(/^\|/, "");
    if (/[^\\]\|$/.test(t) || t === "|") t = t.slice(0, -1);
    var out = [], cur = "", code = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (c === "\\" && t[i + 1] === "|") { cur += "|"; i++; continue; }
      if (c === "`") code = !code;
      if (c === "|" && !code) { out.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  function isTableStart(lines, i) {
    if (i + 1 >= lines.length || lines[i].indexOf("|") < 0 || !RE.delim.test(lines[i + 1]) || lines[i + 1].indexOf("-") < 0) return false;
    if (lines[i + 1].indexOf("|") < 0 && cells(lines[i]).length < 2) return false;
    return cells(lines[i]).length === cells(lines[i + 1]).length;
  }
  function sameList(m, base, ordered, marker) {
    return m && m[1].length >= base && m[1].length <= base + 3 && /\d/.test(m[2]) === ordered && m[2].slice(-1) === marker;
  }
  function startsBlock(lines, i) {
    var l = lines[i];
    return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || isTableStart(lines, i) ||
      (RE.item.test(l) && indentOf(l) < 4 && !blank(l.replace(RE.item, "$4")) && (/^ *[-*+]/.test(l) || /^ *1[.)]/.test(l)));
  }

  function list(lines, i, out, opts) {
    var first = RE.item.exec(lines[i]);
    var ordered = /\d/.test(first[2]), base = first[1].length, start = ordered ? parseInt(first[2], 10) : 1;
    var marker = first[2].slice(-1), items = [], loose = false, ended = false;
    while (i < lines.length && !ended) {
      var m = RE.item.exec(lines[i]);
      if (!sameList(m, base, ordered, marker) || RE.hr.test(lines[i])) break;
      var gap = m[3] ? m[3].length : 1;
      var sp = gap > 4 || !m[4] ? 1 : gap;
      var ci = m[1].length + m[2].length + sp;
      var body = [gap > 4 && m[4] ? m[3].slice(1) + m[4] : (m[4] || "")];
      i++;
      while (i < lines.length) {
        var l = lines[i];
        if (blank(l)) {
          var j = i;
          while (j < lines.length && blank(lines[j])) j++;
          if (j >= lines.length) { i = j; ended = true; break; }
          if (indentOf(lines[j]) >= ci) { for (; i < j; i++) body.push(""); continue; }
          if (sameList(RE.item.exec(lines[j]), base, ordered, marker)) { loose = true; i = j; break; }
          i = j; ended = true; break;
        }
        if (indentOf(l) >= ci) { body.push(l.slice(ci)); i++; continue; }
        if (RE.item.test(l)) {
          if (!sameList(RE.item.exec(l), base, ordered, marker)) ended = true;
          break;
        }
        if (!startsBlock(lines, i) && !blank(body[body.length - 1] || "")) { body.push(l.trim()); i++; continue; }
        ended = true; break;
      }
      items.push(body);
    }
    items.forEach(function (b, k) { if (b.some(function (x, q) { return q > 0 && blank(x) && q < b.length - 1; })) loose = true; });
    var tag = ordered ? "ol" : "ul";
    var html = "<" + tag + (ordered && start !== 1 ? ' start="' + start + '"' : "") + (items.some(task) ? ' class="contains-task-list"' : "") + ">";
    items.forEach(function (b) {
      var check = task(b);
      if (check) b[0] = b[0].replace(/^\[[ xX]\][ \t]+/, "");
      while (b.length && blank(b[b.length - 1])) b.pop();
      html += "<li" + (check ? ' class="task-list-item"' : "") + ">" +
        (check ? '<input type="checkbox" disabled' + (check === "x" ? " checked" : "") + "> " : "") +
        blocks(b, { tight: !loose, history: opts.history }) + "</li>";
    });
    out.push(html + "</" + tag + ">");
    return i;
  }
  function task(b) { var m = /^\[([ xX])\][ \t]+\S/.exec(b[0] || ""); return m ? (m[1] === " " ? "o" : "x") : ""; }

  /** Block Markdown -> HTML (lines already split). opts.tight: paragraphs without <p> (tight list items). */
  function blocks(lines, opts) {
    opts = opts || {};
    var out = [], i = 0, n = lines.length, m;
    while (i < n) {
      var l = lines[i];
      if (blank(l)) { i++; continue; }
      if (opts.history && /^\s*<\/?(details|summary)\b[^>]*>/i.test(l)) {
        m = /^\s*<summary>(.*)<\/summary>\s*$/i.exec(l);
        if (m) out.push('<p class="aw-summary"><strong>' + inline(m[1]) + "</strong></p>");
        i++; continue;
      }
      if ((m = RE.fence.exec(l))) {
        var fence = m[1], lang = (m[2] || "").replace(/[^\w+#.-]/g, ""), ind = indentOf(l), code = [];
        var close = new RegExp("^ {0,3}" + (fence[0] === "`" ? "`" : "~") + "{" + fence.length + ",}\\s*$");
        i++;
        while (i < n && !close.test(lines[i])) { code.push(lines[i].replace(new RegExp("^ {0," + ind + "}"), "")); i++; }
        i++;
        out.push("<pre" + (lang ? ' data-lang="' + esc(lang) + '"' : "") + "><code" + (lang ? ' class="language-' + esc(lang) + '"' : "") + ">" +
          esc(code.join("\n")) + (code.length ? "\n" : "") + "</code></pre>");
        continue;
      }
      if ((m = RE.heading.exec(l))) {
        var h = m[1].length;
        out.push("<h" + h + ">" + inline(m[2] || "", { breaks: false }) + "</h" + h + ">");
        i++; continue;
      }
      if (RE.hr.test(l)) { out.push("<hr>"); i++; continue; }
      if (RE.quote.test(l)) {
        var q = [];
        while (i < n && !blank(lines[i]) && (RE.quote.test(lines[i]) || !startsBlock(lines, i))) { q.push(lines[i].replace(RE.quote, "")); i++; }
        out.push("<blockquote>" + blocks(q, { history: opts.history }) + "</blockquote>");
        continue;
      }
      if (isTableStart(lines, i)) {
        var head = cells(l), aligns = cells(lines[i + 1]).map(function (c) {
          var left = c[0] === ":", right = c[c.length - 1] === ":";
          return left && right ? "center" : right ? "right" : left ? "left" : "";
        });
        var td = function (tag, c, k) { return "<" + tag + (aligns[k] ? ' align="' + aligns[k] + '"' : "") + ">" + inline(c, { breaks: false }) + "</" + tag + ">"; };
        var t = "<table><thead><tr>" + head.map(function (c, k) { return td("th", c, k); }).join("") + "</tr></thead>";
        i += 2;
        var rows = [];
        while (i < n && !blank(lines[i]) && lines[i].indexOf("|") >= 0 && !RE.fence.test(lines[i]) && !RE.quote.test(lines[i])) {
          var r = cells(lines[i]);
          rows.push("<tr>" + head.map(function (x, k) { return td("td", r[k] || "", k); }).join("") + "</tr>");
          i++;
        }
        out.push(t + (rows.length ? "<tbody>" + rows.join("") + "</tbody>" : "") + "</table>");
        continue;
      }
      if (RE.item.test(l) && indentOf(l) < 4) { i = list(lines, i, out, opts); continue; }
      var p = [l.replace(/^ +/, "")];
      i++;
      while (i < n && !blank(lines[i]) && !startsBlock(lines, i)) { p.push(lines[i].replace(/^ +/, "")); i++; }
      var html = inline(p.join("\n").replace(/[ \t]+$/, ""));
      out.push(opts.tight ? html : "<p>" + html + "</p>");
    }
    return out.join("\n");
  }

  /** Markdown text -> safe HTML (GitHub Flavored Markdown subset). opts.history: drop <details>/<summary> lines. */
  function render(md, opts) {
    var lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
    return blocks(lines, { history: !!(opts && opts.history) });
  }

  /** Splits a prompt into the #51 session header, the #37b route line and what you typed. */
  function splitPrompt(text) {
    var t = String(text == null ? "" : text).replace(/\r\n/g, "\n"), header = "", route = "";
    if (t.indexOf("[session header]\n") === 0) {
      var end = t.indexOf("\n[end of header]");
      if (end > 0) { header = t.slice("[session header]\n".length, end); t = t.slice(end + "\n[end of header]".length).replace(/^\n+/, ""); }
    }
    var m = /^\[route: ([A-Za-z0-9_-]+)\]\n?/.exec(t);
    if (m) { route = m[1]; t = t.slice(m[0].length); }
    return { header: header, route: route, body: t };
  }
  /** The HTML for one prompt bubble. */
  function renderPrompt(text) {
    var p = splitPrompt(text), html = "";
    if (p.header) html += '<details class="aw-hdr"><summary>session header</summary><pre><code>' + esc(p.header) + "</code></pre></details>";
    if (p.route) html += '<div class="aw-routechip">\u27a1 route: ' + esc(p.route) + "</div>";
    return html + render(p.body);
  }
  /** Text a code block's Copy button copies: exactly the block, no language label, no button text. */
  function codeText(pre) {
    var code = pre.querySelector && pre.querySelector("code");
    if (code) return code.textContent;
    var t = "";
    Array.prototype.forEach.call(pre.childNodes || [], function (c) { if (!(c.classList && c.classList.contains("aw-codecopy"))) t += c.textContent; });
    return t;
  }

  var api = { esc: esc, inline: inline, render: render, renderPrompt: renderPrompt, splitPrompt: splitPrompt, codeText: codeText, safeUrl: safeUrl };
  root.AgentGfm = api;
  if (cfg.gfmMarkdown === false) return;

  // History / transcript panel uses the same renderer (app.js reads AgentMarkdown.renderMarkdown when it loads)
  if (root.AgentMarkdown && !root.AgentMarkdown.renderMarkdownBasic) {
    root.AgentMarkdown.renderMarkdownBasic = root.AgentMarkdown.renderMarkdown;
    root.AgentMarkdown.renderMarkdown = function (md) { return '<div class="aw-md">' + render(md, { history: true }) + "</div>"; };
  }

  var doc = root.document;
  if (!doc || typeof root.MutationObserver !== "function") return;
  var de = doc.documentElement;
  de.classList.add("aw-gfm");
  if (cfg.userMarkdown !== false) de.classList.add("aw-usermd");
  if (cfg.agentColors !== false) de.classList.add("aw-agentcolors");

  /* ---------- DOM pass ---------- */
  function rawOf(shown) {
    // prefer the exact text from the store (keeps indentation and line breaks); fall back to what is shown
    var a = root.__agentWebchat, s = a && a.cur ? a.cur() : null, st = s && s.store;
    if (st && root.AgentTime && root.AgentTime.match) {
      try {
        var act = root.AgentTime.match(st.getState().activities || [], shown, true, null);
        if (act && typeof act.text === "string") return act.text;
      } catch (e) {}
    }
    return shown;
  }
  function prompts(scope) {
    var n = 0;
    Array.prototype.forEach.call(scope.querySelectorAll(".webchat__bubble--from-user .webchat__bubble__content"), function (c) {
      var src = c.querySelector(".webchat__text-content");
      if (!src) return;
      var key = src.textContent || "";
      if (!key.trim()) return;
      var view = c.querySelector(".aw-prompt");
      if (view && c.__awKey === key) return;
      // innerText keeps line breaks while the original is still visible (first pass)
      var shown = src.classList.contains("aw-src") ? key : (src.innerText || key);
      var raw = rawOf(shown);
      if (!view) { view = doc.createElement("div"); view.className = "aw-prompt aw-md"; src.parentNode.insertBefore(view, src.nextSibling); }
      view.innerHTML = renderPrompt(raw);
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
    n += copyButtons(doc);
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
