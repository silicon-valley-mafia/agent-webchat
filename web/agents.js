/* agent-webchat: multiple agents (TODO #11 / #20). Loaded after config.js + webchat.js, before app.js; app.js is unchanged.
 * - Asks the Worker which agents this access code may use (POST /agents). Old Worker / one agent -> nothing changes.
 * - Adds an agent picker to the header (only when there are 2+ agents). Picking one starts a New chat with it.
 * - Every /token /resume /log /export request gets an X-Agent header: new chats use the picked agent, existing
 *   conversations use the agent they were started with (remembered per conversation id in localStorage), so
 *   resume / history / logging always reach the right agent.
 * - Title, document title and bot avatar initials follow the agent of the open conversation.
 * Off switch: multiAgent: false in config.js. Console: AgentAgents.state(). */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var K = { sel: "agentSelected", map: "agentConvAgent" };
  var MAP_MAX = 300;
  var DL_PATHS = { "/token": 1, "/resume": 1, "/log": 1, "/export": 1 };

  /** Pure: Worker path ("/token") of a request URL, or "" if it isn't a Worker call. */
  function pathOf(url, base) {
    if (!base || typeof url !== "string" || url.indexOf(base) !== 0) return "";
    var rest = url.slice(base.length).split("?")[0];
    return rest.charAt(0) === "/" ? rest : "";
  }
  /** Pure: which agent a request should go to. New chat -> the picked agent. An existing conversation -> the agent
   * it was started with; one with no record (older than this feature, or another browser) -> the first agent
   * (the original GitHub agent, which every older conversation used). */
  function agentFor(path, conversationId, map, selected, ids) {
    if (!ids || !ids.length) return "";
    var known = function (id) { return !!id && ids.indexOf(id) >= 0; };
    if (path === "/token") return known(selected) ? selected : ids[0];
    if (conversationId && known(map[conversationId])) return map[conversationId];
    return ids[0];
  }
  /** Pure: conversation id from a JSON request body (string), or "". */
  function convOf(body) {
    if (typeof body !== "string" || body.indexOf("conversationId") < 0) return "";
    try { var j = JSON.parse(body); return typeof j.conversationId === "string" ? j.conversationId : ""; } catch (e) { return ""; }
  }
  function remember(map, conversationId, agentId) {
    if (!conversationId || !agentId) return map;
    delete map[conversationId];
    map[conversationId] = agentId;
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length - MAP_MAX; i++) delete map[keys[i]];
    return map;
  }

  var api = { pathOf: pathOf, agentFor: agentFor, convOf: convOf, remember: remember };
  root.AgentAgents = api;
  var doc = root.document;
  if (!doc || !root.fetch || cfg.multiAgent === false) return;

  var base = cfg.tokenEndpoint && cfg.tokenEndpoint.indexOf("REPLACE_WITH") !== 0 ? cfg.tokenEndpoint.replace(/\/token\/?$/, "") : "";
  if (!base) return;
  var origFetch = root.fetch;
  var st = { code: "", agents: [], ids: null, loading: null, current: null, enabled: false };
  var defaults = { title: cfg.title || "Agent", initials: cfg.botAvatarInitials || "" };

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function getMap() { try { return JSON.parse(ls(K.map) || "{}") || {}; } catch (e) { return {}; } }
  function saveMap(m) { ls(K.map, JSON.stringify(m)); }
  function byId(id) { for (var i = 0; i < st.agents.length; i++) if (st.agents[i].id === id) return st.agents[i]; return null; }

  /** POST /agents once per access code. A failure (old Worker, 404) leaves everything as before. */
  function load(code) {
    if (!code) return Promise.resolve(null);
    if (st.loading && st.code === code) return st.loading;
    st.code = code;
    st.loading = origFetch.call(root, base + "/agents", { method: "POST", headers: { "X-Access-Code": code } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.agents) || !j.agents.length) { st.enabled = false; return null; }
        st.agents = j.agents;
        st.ids = j.agents.map(function (a) { return a.id; });
        st.enabled = true;
        var sel = ls(K.sel);
        if (!sel || st.ids.indexOf(sel) < 0) ls(K.sel, j["default"] || st.ids[0]);
        paintPicker();
        return j;
      })
      .catch(function () { st.enabled = false; return null; });
    return st.loading;
  }

  function show(agent) {
    if (!agent) return;
    st.current = agent.id;
    var a = byId(agent.id) || agent;
    var title = a.name || defaults.title;
    var h = doc.getElementById("title");
    if (h) h.textContent = title;
    doc.title = title;
    cfg.title = title;
    cfg.botAvatarInitials = a.initials || defaults.initials;
    paintPicker();
  }

  function paintPicker() {
    var sel = doc.getElementById("agentpick");
    if (st.agents.length < 2) { if (sel) sel.hidden = true; return; }
    if (!sel) {
      var who = doc.getElementById("who");
      if (!who || !who.parentNode) return;
      sel = doc.createElement("select");
      sel.id = "agentpick";
      sel.title = "Agent - picking one starts a new chat with it (your other chats stay in History)";
      sel.setAttribute("aria-label", "Agent");
      sel.addEventListener("change", function () {
        ls(K.sel, sel.value);
        var nc = doc.getElementById("newchat");
        if (nc && !nc.hidden && !nc.disabled) nc.click();
      });
      who.parentNode.insertBefore(sel, who);
    }
    var want = st.agents.map(function (a) { return a.id + "\u0000" + a.name; }).join("|");
    if (sel.getAttribute("data-list") !== want) {
      sel.innerHTML = "";
      st.agents.forEach(function (a) {
        var o = doc.createElement("option");
        o.value = a.id;
        o.textContent = a.name;
        if (a.description) o.title = a.description;
        sel.appendChild(o);
      });
      sel.setAttribute("data-list", want);
    }
    sel.value = st.current || ls(K.sel) || st.ids[0];
    sel.hidden = false;
  }

  function headerOf(init, name) {
    var h = init && init.headers;
    if (!h) return "";
    if (typeof h.get === "function") return h.get(name) || "";
    for (var k in h) if (k.toLowerCase() === name.toLowerCase()) return h[k];
    return "";
  }

  root.fetch = function (input, init) {
    var self = this;
    var args = arguments;
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var path = pathOf(url, base);
    if (!DL_PATHS[path] || (init && init.method && init.method !== "POST")) return origFetch.apply(self, args);
    var code = headerOf(init, "X-Access-Code");
    return load(code).then(function () {
      if (!st.enabled) return origFetch.apply(self, args);
      var conv = convOf(init && init.body);
      var id = agentFor(path, conv, getMap(), ls(K.sel), st.ids);
      if (!id) return origFetch.apply(self, args);
      var headers = new Headers((init && init.headers) || {});
      headers.set("X-Agent", id);
      var init2 = {};
      for (var k in init) init2[k] = init[k];
      init2.headers = headers;
      return origFetch.call(self, input, init2).then(function (r) {
        if ((path !== "/token" && path !== "/resume") || !r.ok) return r;
        return r.clone().json().then(function (j) {
          var a = (j && j.agent) || byId(id);
          var cid = (j && j.conversationId) || conv;
          if (a && cid) saveMap(remember(getMap(), cid, a.id));
          show(a);
          return r;
        }, function () { return r; });
      });
    });
  };

  api.state = function () { return { enabled: st.enabled, agents: st.agents, current: st.current, selected: ls(K.sel) }; };
  // Warm up with the remembered code so the picker shows before the first request.
  var saved = ls("agentAccessCode");
  if (saved) load(saved);
})(typeof window !== "undefined" ? window : globalThis);
