/* agent-webchat UI helpers: pure functions used by app.js (Markdown escaping, reply matching,
 * collapse rules, duplicate-send guard). Works in browsers and in Node (tests). No dependencies. */
(function (root) {
  "use strict";

  /**
   * TODO #24(a): Web Chat's Markdown renderer treats "<id>" as an HTML tag and its sanitizer drops it.
   * Escape "<" as "&lt;" everywhere EXCEPT inside fenced code blocks and inline code spans,
   * and except autolinks like <https://x>.
   */
  function escapeAngles(md) {
    if (typeof md !== "string" || md.indexOf("<") < 0) return md;
    var lines = md.split("\n"), fence = null, out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        out.push(line);
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
        continue;
      }
      if (m) { fence = m[1]; out.push(line); continue; }
      out.push(escapeInline(line));
    }
    return out.join("\n");
  }
  function escapeInline(line) {
    var res = "", i = 0;
    while (i < line.length) {
      var c = line[i];
      if (c === "`") {
        var run = /^`+/.exec(line.slice(i))[0];
        var close = line.indexOf(run, i + run.length);
        // a code span needs a closing run of exactly the same length
        while (close >= 0 && line[close + run.length] === "`") {
          var longer = /^`+/.exec(line.slice(close))[0].length;
          close = line.indexOf(run, close + longer);
        }
        if (close >= 0) { res += line.slice(i, close + run.length); i = close + run.length; continue; }
        res += run; i += run.length; continue;
      }
      if (c === "\\" && i + 1 < line.length) { res += line.slice(i, i + 2); i += 2; continue; }
      if (c === "<") {
        var auto = /^<(https?:\/\/|mailto:)[^\s<>]*>/i.exec(line.slice(i));
        if (auto) { res += auto[0]; i += auto[0].length; continue; }
        res += "&lt;"; i++; continue;
      }
      res += c; i++;
    }
    return res;
  }

  /**
   * Text "fingerprint" used to find which activity a rendered bubble belongs to: letters only, lower case,
   * with Markdown link targets and code-fence info strings removed (they are not visible in the bubble).
   */
  function letterKey(s, max) {
    var t = String(s || "")
      .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, "")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/&(lt|gt|amp|quot|nbsp|#\d+);/g, "")
      .toLowerCase();
    var out = "", lim = max || 400;
    for (var i = 0; i < t.length && out.length < lim; i++) {
      var ch = t[i];
      if ((ch >= "a" && ch <= "z") || (ch > "\u00bf" && ch.toUpperCase() !== ch.toLowerCase())) out += ch;
    }
    return out;
  }
  function commonPrefix(a, b) {
    var n = Math.min(a.length, b.length), i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
  }
  /**
   * replies: [{id, key}] (key = letterKey(markdown)); used: {id: true} already matched.
   * Returns the best matching reply id for a rendered bubble's visible text, or null.
   */
  function matchReply(visibleText, replies, used) {
    var k = letterKey(visibleText);
    if (!k) return null;
    var best = null, bestScore = 0;
    for (var i = 0; i < replies.length; i++) {
      var r = replies[i];
      if (used && used[r.id]) continue;
      var score = commonPrefix(k, r.key);
      var need = Math.min(20, k.length, r.key.length);
      if (need > 0 && score >= need && score > bestScore) { best = r.id; bestScore = score; }
    }
    return best;
  }

  /**
   * TODO #19: which replies are expanded. ids: reply ids in display order (oldest first).
   * manual: {id: "expanded"|"collapsed"|"hidden"}; long: {id: true} for replies taller than the preview.
   * The latest `keep` replies are expanded, older long ones collapsed; a manual choice always wins.
   */
  function collapsePlan(ids, keep, manual, long) {
    var out = {}, n = ids.length;
    for (var i = 0; i < n; i++) {
      var id = ids[i];
      if (manual && manual[id]) { out[id] = manual[id]; continue; }
      if (long && !long[id]) { out[id] = "expanded"; continue; }
      out[id] = i >= n - keep ? "expanded" : "collapsed";
    }
    return out;
  }

  /** TODO #13: anti double-send. Same text (trimmed, case-insensitive) within windowMs of the last send. */
  function isDuplicate(text, last, now, windowMs) {
    if (!last || !text) return false;
    var a = String(text).trim().toLowerCase(), b = String(last.text || "").trim().toLowerCase();
    return !!a && a === b && now - last.at < (windowMs || 30000);
  }

  /** Markdown source -> plain text fallback (used only when the rendered bubble is not available). */
  function stripMarkdown(md) {
    return String(md || "")
      .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1 ($2)")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** "2026-11-27" in the given IANA time zone (logs/artifacts folders are per day). */
  function dayIn(date, timeZone) {
    try {
      var p = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      var get = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
      return get("year") + "-" + get("month") + "-" + get("day");
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }

  root.AgentUI = {
    escapeAngles: escapeAngles, letterKey: letterKey, matchReply: matchReply, collapsePlan: collapsePlan,
    isDuplicate: isDuplicate, stripMarkdown: stripMarkdown, dayIn: dayIn
  };
})(typeof window !== "undefined" ? window : globalThis);
