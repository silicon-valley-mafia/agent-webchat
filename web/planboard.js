/* agent-webchat: TODO #46 - plan board. Loaded before app.js; app.js is unchanged.
 *
 * In a chat with a planning agent (Worker /agents "plans": true, or an id in planBoardAgents, default ["conductor"]),
 * every code block in an agent reply that holds a YAML task list is shown with a status table under it:
 *
 *   plan: web-52            <- optional plan id ("plan:" or "id:")
 *   tasks:
 *     - id: t1
 *       title: Write the patch
 *       status: done        <- done / completed / skipped / running / in_progress / blocked / failed / todo ...
 *     - id: t2
 *       title: Open the PR
 *       status: todo
 *
 * "▶ Run next task" sends "run plan <plan id>" (or "run task <next task id>" when the block has no plan id) as a normal
 * message. The next task = the first one whose status is not done / completed / skipped. Only a small YAML subset is
 * read (block lists with key: value lines, or "- {id: t1, title: x, status: todo}"); anything else is left alone.
 * Off switch: planBoard: false in web/config.js. Console: AgentPlan.parse(text).
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var DONE = { done: 1, completed: 1, complete: 1, skipped: 1, ok: 1, finished: 1 };
  var ICON = { done: "\u2705", completed: "\u2705", complete: "\u2705", finished: "\u2705", ok: "\u2705", skipped: "\u23ED",
    running: "\uD83D\uDD04", in_progress: "\uD83D\uDD04", "in-progress": "\uD83D\uDD04", doing: "\uD83D\uDD04", active: "\uD83D\uDD04",
    blocked: "\u26D4", failed: "\u274C", error: "\u274C" };
  var api = {};

  function unq(v) {
    v = String(v == null ? "" : v).trim();
    if (v.length >= 2 && (v[0] === "\"" || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    return v;
  }
  function kv(item, text) {
    var m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text.trim());
    if (m) item[m[1].toLowerCase()] = unq(m[2].replace(/\s+#.*$/, ""));
  }
  /** Pure: {plan, title, tasks:[{id,title,status}]} from a YAML-ish text, or null when there is no task list. */
  api.parse = function (text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var top = {}, tasks = null, item = null, inTasks = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      var indent = /^\s*/.exec(line)[0].length;
      if (indent === 0 && !/^-/.test(line)) {
        inTasks = /^tasks\s*:\s*$/.test(line);
        if (inTasks) tasks = tasks || [];
        else kv(top, line);
        item = null;
        continue;
      }
      if (!inTasks) continue;
      var dash = /^\s*-\s*(.*)$/.exec(line);
      if (dash) {
        item = {};
        tasks.push(item);
        var rest = dash[1].trim();
        if (/^\{.*\}$/.test(rest)) rest.slice(1, -1).split(",").forEach(function (p) { kv(item, p); });
        else if (rest) kv(item, rest);
        continue;
      }
      if (item) kv(item, line);
    }
    if (!tasks || !tasks.length) return null;
    var out = tasks.map(function (t, n) {
      return { id: t.id || String(n + 1), title: t.title || t.name || t.task || "", status: (t.status || "todo").toLowerCase() };
    });
    return { plan: top.plan || top.id || "", title: top.title || top.name || "", tasks: out };
  };
  /** Pure: the first task not done / completed / skipped, or null. */
  api.next = function (p) {
    if (!p) return null;
    for (var i = 0; i < p.tasks.length; i++) if (!DONE[p.tasks[i].status]) return p.tasks[i];
    return null;
  };
  /** Pure: the text the button sends. */
  api.command = function (p) {
    var n = api.next(p);
    if (!n) return "";
    return p.plan ? "run plan " + p.plan : "run task " + n.id;
  };

  root.AgentPlan = api;
  var doc = root.document;
  if (!doc || cfg.planBoard === false || typeof root.MutationObserver !== "function") return;

  var css = doc.createElement("style");
  css.textContent =
    ".aw-plan{margin:6px 0 2px;font-size:13px}.aw-plan table{border-collapse:collapse;width:100%}" +
    ".aw-plan th,.aw-plan td{border:1px solid rgba(128,128,128,.35);padding:3px 6px;text-align:left;vertical-align:top}" +
    ".aw-plan tr.aw-next td{font-weight:600}.aw-plan .aw-planbar{display:flex;gap:8px;align-items:center;margin-top:4px}" +
    ".aw-plan button{font:inherit;font-size:12px;padding:2px 10px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer}";
  (doc.head || doc.documentElement).appendChild(css);

  function planAgent() {
    var S = root.AgentStarters;
    var app = root.__agentWebchat;
    var a = S && S.agentOf ? S.agentOf(app && app.cur ? app.cur() : null) : null;
    if (!a) return false;
    var ids = Array.isArray(cfg.planBoardAgents) ? cfg.planBoardAgents : ["conductor"];
    return a.plans === true || ids.indexOf(a.id) >= 0;
  }
  function send(text) {
    var S = root.AgentStarters;
    if (S && S.send) S.send(text);
  }
  function table(p) {
    var box = doc.createElement("div");
    box.className = "aw-plan";
    var t = doc.createElement("table");
    var head = doc.createElement("tr");
    ["", "Task", "Title", "Status"].forEach(function (h) { var th = doc.createElement("th"); th.textContent = h; head.appendChild(th); });
    t.appendChild(head);
    var nx = api.next(p);
    p.tasks.forEach(function (k) {
      var tr = doc.createElement("tr");
      if (nx && k === nx) tr.className = "aw-next";
      [ICON[k.status] || "\u2B1C", k.id, k.title, k.status].forEach(function (v) { var td = doc.createElement("td"); td.textContent = v; tr.appendChild(td); });
      t.appendChild(tr);
    });
    box.appendChild(t);
    var bar = doc.createElement("div");
    bar.className = "aw-planbar";
    var done = p.tasks.filter(function (k) { return !!DONE[k.status]; }).length;
    var info = doc.createElement("span");
    info.textContent = (p.plan ? "Plan " + p.plan + " \u00B7 " : "") + done + " of " + p.tasks.length + " done";
    bar.appendChild(info);
    var cmd = api.command(p);
    if (cmd) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = "\u25B6 Run next task";
      b.title = "Sends: " + cmd;
      b.addEventListener("click", function () { send(cmd); });
      bar.appendChild(b);
    }
    box.appendChild(bar);
    return box;
  }
  api.decorate = function () {
    if (!planAgent()) return 0;
    var wrap = doc.getElementById("chatwrap") || doc;
    var blocks = wrap.querySelectorAll(".webchat__bubble:not(.webchat__bubble--from-user) pre");
    var n = 0;
    for (var i = 0; i < blocks.length; i++) {
      var pre = blocks[i];
      if (pre.__awPlan) continue;
      var text = pre.innerText || pre.textContent || "";
      if (!/^tasks\s*:/m.test(text)) continue;
      var p = api.parse(text);
      pre.__awPlan = true;
      if (!p) continue;
      pre.parentNode.insertBefore(table(p), pre.nextSibling);
      n++;
    }
    return n;
  };

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; api.decorate(); }, 300);
  }
  function start() {
    new root.MutationObserver(schedule).observe(doc.getElementById("app") || doc.body, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (doc.body) start(); else doc.addEventListener("DOMContentLoaded", start);
})(typeof window !== "undefined" ? window : globalThis);
