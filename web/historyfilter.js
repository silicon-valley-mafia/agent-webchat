/* agent-webchat: TODO #20 (Batch B) - filter the History list by agent. Loaded before app.js.
 * app.js marks every History row with data-agent = the agent's folder number (logs/<N>/; older flat logs = 1).
 * When the list holds sessions of 2+ agents, chips "All · <agent> · ..." appear on top; names come from the Worker's
 * /agents answer (web/agents.js), unknown numbers show as "Agent N". The choice is kept while the page is open.
 * Off switch: historyFilter: false in web/config.js.
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var api = {};
  var pick = "";

  /** Pure: {num: name} from /agents' nums ({id: num}) and agents ([{id, name}]). */
  api.names = function (nums, agents) {
    var out = {};
    (agents || []).forEach(function (a) { if (nums && nums[a.id]) out[String(nums[a.id])] = a.name || a.id; });
    return out;
  };
  root.AgentHistoryFilter = api;
  var doc = root.document;
  if (!doc || cfg.historyFilter === false || typeof root.MutationObserver !== "function") return;

  function names() {
    var A = root.AgentAgents, st = A && A.state ? A.state() : null;
    return st ? api.names(st.nums, st.agents) : {};
  }
  function apply(body) {
    var rows = body.querySelectorAll(".row[data-agent]");
    for (var i = 0; i < rows.length; i++) rows[i].hidden = !!pick && rows[i].getAttribute("data-agent") !== pick;
    // hide a day heading when every row under it is hidden
    var hs = body.querySelectorAll("h3");
    for (var j = 0; j < hs.length; j++) {
      var any = false, n = hs[j].nextElementSibling;
      while (n && n.tagName !== "H3") { if (n.matches && n.matches(".row[data-agent]") && !n.hidden) any = true; n = n.nextElementSibling; }
      if (hs[j].closest && hs[j].closest(".recent")) continue;
      hs[j].hidden = !!pick && !any;
    }
  }
  function paint() {
    var body = doc.getElementById("historybody");
    if (!body) return;
    var rows = body.querySelectorAll(".row[data-agent]");
    var nums = [];
    for (var i = 0; i < rows.length; i++) { var v = rows[i].getAttribute("data-agent"); if (nums.indexOf(v) < 0) nums.push(v); }
    var bar = body.querySelector(".aw-hfilter");
    if (nums.length < 2) { if (bar) bar.remove(); return; }
    if (pick && nums.indexOf(pick) < 0) pick = "";
    nums.sort(function (a, b) { return Number(a) - Number(b); });
    var key = nums.join(",") + "|" + pick;
    if (bar && bar.getAttribute("data-key") === key) return;
    if (!bar) {
      bar = doc.createElement("div");
      bar.className = "aw-hfilter";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Filter by agent");
      var first = null;
      for (var c = body.firstElementChild; c; c = c.nextElementSibling) {
        if (c.tagName === "H3" || (c.matches && c.matches(".row[data-agent]"))) { first = c; break; }
      }
      body.insertBefore(bar, first || body.firstChild);
    }
    bar.setAttribute("data-key", key);
    bar.innerHTML = "";
    var nm = names();
    [""].concat(nums).forEach(function (n) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "small" + (n === pick ? " on" : "");
      b.textContent = n ? (nm[n] || "Agent " + n) : "All";
      b.setAttribute("aria-pressed", n === pick ? "true" : "false");
      b.addEventListener("click", function () { pick = n; bar.removeAttribute("data-key"); paint(); });
      bar.appendChild(b);
    });
    apply(body);
  }
  var css = doc.createElement("style");
  css.textContent = ".aw-hfilter{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}.aw-hfilter .on{font-weight:700;text-decoration:underline}";
  (doc.head || doc.documentElement).appendChild(css);
  var timer = null;
  function schedule() { if (!timer) timer = setTimeout(function () { timer = null; paint(); }, 100); }
  function start() {
    var body = doc.getElementById("historybody");
    if (body) new root.MutationObserver(schedule).observe(body, { childList: true });
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
