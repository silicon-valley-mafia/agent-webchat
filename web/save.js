/* agent-webchat: TODO #57 "💾 Save" - save the whole conversation so far to GitHub as ONE Markdown file.
 *
 * - Sits next to ⬇ Download and shows / hides with it. One click -> POST /save {conversationId}; the Worker builds the
 *   same Markdown as ⬇ Download and commits it, under the Download file name, into this chat's own log folder
 *   (logs/<agent>/<day>/<HHMM>-<person>--<conversation>/, next to its message files).
 * - Click again after chatting more -> the same file is overwritten with the whole conversation up to now
 *   (its git history keeps every earlier save). Nothing changed since the last save -> "unchanged", no new commit.
 * - The request names the conversation's agent (X-Agent, same rule as web/agents.js), so it reaches the right agent.
 * Off switch: saveButton: false in web/config.js. app.js unchanged (uses window.__agentWebchat.cur()).
 * Console: AgentSave.state().
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var LABEL = "\uD83D\uDCBE Save";
  var MSG = {
    save_disabled: "Saving to GitHub isn't set up on the Worker (LOG_REPO_TOKEN).",
    read_only: "This access code is read-only - it can't save to GitHub.",
    not_owner: "This conversation belongs to another access code.",
    forbidden: "This conversation belongs to another access code.",
    rate_limited: "Too many requests - wait a minute and click Save again.",
    bad_access_code: "Access code not accepted.",
    conversation_expired: "This conversation has expired on the agent side.",
    directline_error: "Couldn't read the conversation from the agent - try again.",
    github_conflict: "GitHub was busy with another save - click Save again.",
    agent_not_allowed: "This access code may not use this conversation's agent.",
  };
  var api = {};

  /** Pure: Worker base URL from config.tokenEndpoint ("https://w.example/token" -> "https://w.example"), or "". */
  api.base = function (tokenEndpoint) {
    return tokenEndpoint && tokenEndpoint.indexOf("REPLACE_WITH") !== 0 ? String(tokenEndpoint).replace(/\/token\/?$/, "") : "";
  };
  /** Pure: notice text for a /save answer (j = JSON body, status = HTTP status). */
  api.message = function (j, status) {
    j = j || {};
    if (j.saved) {
      var what = j.status === "created" ? "Saved" : j.status === "unchanged" ? "Already up to date" : "Saved (overwritten)";
      var n = typeof j.messages === "number" ? " - " + j.messages + " messages" : "";
      return what + n + " -> " + (j.repo ? j.repo + "/" : "") + j.path;
    }
    return "Save failed: " + (MSG[j.error] || j.error || "HTTP " + status);
  };
  /** Pure: agent id for this conversation, same rule as web/agents.js (remembered agent, else the first one). */
  api.agentId = function (conversationId, agentsState, map) {
    var A = root.AgentAgents;
    if (!agentsState || !agentsState.enabled || !agentsState.agents || !A || !A.agentFor) return "";
    var ids = agentsState.agents.map(function (a) { return a.id; });
    return A.agentFor("/save", conversationId, map || {}, agentsState.selected, ids) || "";
  };
  root.AgentSave = api;

  var doc = root.document;
  if (!doc || cfg.saveButton === false || typeof root.fetch !== "function") return;
  var base = api.base(cfg.tokenEndpoint);
  if (!base) return;
  var st = { busy: false, last: null };

  function cur() { var a = root.__agentWebchat; return a && a.cur ? a.cur() : null; }
  function ls(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function codeOf(s) { return (s && s.code) || ls("agentAccessCode") || ""; }
  function notice(text) {
    var n = doc.getElementById("notice"), t = doc.getElementById("noticetext");
    if (n && t) { t.textContent = text; n.hidden = false; } else if (root.console) root.console.log(text);
  }

  var b = doc.createElement("button");
  b.id = "savebtn";
  b.type = "button";
  b.hidden = true;
  b.textContent = LABEL;
  b.title = "Commit the whole conversation so far (the Download file) into this chat's log folder on GitHub - click again later to overwrite it";

  function sync() {
    var d = doc.getElementById("download");
    b.hidden = !d || d.hidden;
  }

  function save() {
    var s = cur();
    if (st.busy) return;
    if (!s || !s.conversationId) { notice("Open a chat first."); return; }
    st.busy = true;
    b.disabled = true;
    b.textContent = "\uD83D\uDCBE Saving\u2026";
    var headers = { "X-Access-Code": codeOf(s), "Content-Type": "application/json" };
    var map = {};
    try { map = JSON.parse(ls("agentConvAgent") || "{}") || {}; } catch (e) {}
    var A = root.AgentAgents;
    var agent = api.agentId(s.conversationId, A && A.state ? A.state() : null, map);
    if (agent) headers["X-Agent"] = agent;
    var status = 0;
    root.fetch(base + "/save", { method: "POST", headers: headers, body: JSON.stringify({ conversationId: s.conversationId }) })
      .then(function (r) { status = r.status; return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        st.last = j;
        notice(api.message(j, status));
        b.textContent = j.saved ? "\u2705 Saved" : "\u26A0 Save";
        if (j.saved) b.title = "Last saved " + new Date().toLocaleTimeString() + " to " + j.repo + "/" + j.path + " - click again to overwrite with the whole conversation so far";
      }, function () {
        notice("Save failed: couldn't reach the Worker.");
        b.textContent = "\u26A0 Save";
      })
      .then(function () {
        st.busy = false;
        b.disabled = false;
        setTimeout(function () { if (!st.busy) b.textContent = LABEL; }, 4000);
      });
  }
  b.addEventListener("click", save);

  function start() {
    var d = doc.getElementById("download");
    if (!d || !d.parentNode) return;
    d.parentNode.insertBefore(b, d.nextSibling);
    sync();
    if (typeof root.MutationObserver === "function") new root.MutationObserver(sync).observe(d, { attributes: true, attributeFilter: ["hidden"] });
    else setInterval(sync, 1000);
  }
  api.save = save;
  api.state = function () { return { visible: !b.hidden, busy: st.busy, last: st.last }; };
  if (doc.getElementById("download")) start(); else doc.addEventListener("DOMContentLoaded", start);
})(typeof window !== "undefined" ? window : globalThis);
