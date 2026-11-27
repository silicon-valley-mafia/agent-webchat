/* agent-webchat: small, safe Markdown helpers for the History / transcript panel (moved out of app.js so it stays
 * small enough to edit). Everything is HTML-escaped first; only a tiny subset is turned back into markup. */
(function () {
  "use strict";
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
  /** Conversation / user id from a transcript's header table. */
  function parseIds(md) {
    var c = /\| Conversation ID \| `([^`]+)` \|/.exec(md);
    var u = /\| User ID \| `([^`]*)` \|/.exec(md);
    return { conversationId: c ? c[1] : null, userId: u && u[1] ? u[1] : null };
  }
  /** logs/2026-11-27/0140-deepesh--conv  ->  2026-11-27_0140-deepesh--conv.md */
  function fileName(item) { return item.path.split("/").slice(1).join("_") + ".md"; }

  window.AgentMarkdown = { esc: esc, inline: inline, renderMarkdown: renderMarkdown, parseIds: parseIds, fileName: fileName };
})();
