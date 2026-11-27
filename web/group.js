/* agent-webchat: EXPERIMENTAL group chat (TODO #43). Own page (group.html); the main chat and app.js are untouched.
 * - Pick 2-4 agents this access code may use (POST /agents), then one prompt goes to every one of them.
 * - One Direct Line conversation per agent (never mixed): /token with X-Agent, one Web Chat column each.
 * - Layout: side-by-side columns; on narrow screens tabs. "Send to" picks all agents or just one for follow-ups.
 * - Per-agent "working" state with the #42 end-of-turn rule (turns.js); a slow agent never blocks the others.
 * - Each conversation is logged like a normal chat (/log with X-Agent) and remembered for the main page's History.
 * - Download = one Markdown file with every agent's replies. Attachments: not in this experiment (use the main chat).
 * Off switch: groupChat: false in config.js. Console: AgentGroup.state(). */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var QUIET_MS = 3000, GRACE_MS = cfg.interimGraceMs || 120000;
  var MAX = Math.max(2, Math.min(cfg.groupMaxAgents || 4, 6));

  /* ---------- pure helpers (tested in worker/test/group.test.js) ---------- */
  /** Which members a prompt goes to: "all" -> every live member, else the one with that agent id. */
  function targets(members, to) {
    var live = (members || []).filter(function (m) { return m && !m.failed; });
    if (!to || to === "all") return live;
    return live.filter(function (m) { return m.agent.id === to; });
  }
  /** Toggle an agent in the picked list, keeping at most max. Returns a new array. */
  function toggle(picked, id, max) {
    var p = (picked || []).slice(), i = p.indexOf(id);
    if (i >= 0) p.splice(i, 1); else if (p.length < (max || MAX)) p.push(id);
    return p;
  }
  /** Working-state step for one member after an agent message: returns ms until "done" (0 = keep the old timer). */
  function settleAfter(kind) { return kind === "interim" ? GRACE_MS : QUIET_MS; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmmss(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  /** One Markdown file: every prompt, then each agent's replies to it. */
  function markdown(group) {
    var out = ["# Group chat " + group.id, "", "Started " + new Date(group.at).toISOString() + " · agents: " +
      group.members.map(function (m) { return m.agent.name + " (`" + (m.conversationId || "?") + "`)"; }).join(", "), ""];
    (group.prompts || []).forEach(function (p, i) {
      out.push("## " + (i + 1) + ". You (" + hhmmss(p.at) + (p.to && p.to !== "all" ? ", to " + p.to : "") + ")", "", p.text, "");
      group.members.forEach(function (m) {
        var rs = (m.log || []).filter(function (r) { return r.prompt === i; });
        if (!rs.length) return;
        out.push("### " + m.agent.name + (rs[0].ms != null ? " (first reply after " + (rs[0].ms / 1000).toFixed(1) + " s)" : ""), "");
        rs.forEach(function (r) { out.push(r.text || "_(no text: " + (r.attachments || 0) + " attachment(s))_", ""); });
      });
    });
    return out.join("\n");
  }
  var api = { targets: targets, toggle: toggle, settleAfter: settleAfter, markdown: markdown, MAX: MAX };
  root.AgentGroup = api;

  var doc = root.document;
  if (!doc || !root.fetch || !doc.getElementById("grp")) return;
  var $ = function (id) { return doc.getElementById(id); };
  var base = cfg.tokenEndpoint && cfg.tokenEndpoint.indexOf("REPLACE_WITH") !== 0 ? cfg.tokenEndpoint.replace(/\/token\/?$/, "") : "";
  var st = { code: "", agents: [], picked: [], group: null, to: "all", tab: 0 };

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function jget(k, d) { try { return JSON.parse(ls(k) || "null") || d; } catch (e) { return d; } }
  function say(t) { $("gnotice").textContent = t || ""; $("gnotice").hidden = !t; }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function post(path, agentId, body, keepalive) {
    var h = { "X-Access-Code": st.code };
    if (agentId) h["X-Agent"] = agentId;
    if (body) h["Content-Type"] = "application/json";
    return fetch(base + path, { method: "POST", headers: h, body: body ? JSON.stringify(body) : undefined, keepalive: !!keepalive })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.status = r.status; throw e; } return j; }); });
  }

  /* ---------- theme (same localStorage key as the main page) ---------- */
  function dark() { var t = ls("agentTheme"); return t ? t === "dark" : !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches); }
  doc.documentElement.setAttribute("data-theme", dark() ? "dark" : "light");

  /* ---------- step 1: access code + agent picker ---------- */
  function start(code) {
    if (!base) { say("Not configured yet: set tokenEndpoint in web/config.js."); return; }
    st.code = code;
    say("Loading agents…");
    post("/agents").then(function (j) {
      st.agents = (j && Array.isArray(j.agents)) ? j.agents : [];
      ls("agentAccessCode", code);
      $("ggate").hidden = true;
      say("");
      paintPicker();
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) { ls("agentAccessCode", null); $("ggate").hidden = false; say("That access code was not accepted."); return; }
      // Older Worker without /agents: one agent only.
      st.agents = [{ id: "", name: cfg.title || "Agent", initials: cfg.botAvatarInitials || "" }];
      $("ggate").hidden = true; say(""); paintPicker();
    });
  }
  function paintPicker() {
    var box = $("gpick"), list = $("gagents");
    box.hidden = false; $("gchat").hidden = true; $("gcompose").hidden = true;
    list.innerHTML = "";
    if (st.agents.length < 2) {
      $("gpickhelp").textContent = "Only one agent is available to your access code, so a group isn't possible yet. The owner adds more agents with the AGENTS repo secret (docs/AGENTS.md).";
    } else {
      $("gpickhelp").textContent = "Pick 2–" + MAX + " agents. Every prompt goes to all of them; each one costs an agent turn.";
    }
    if (!st.picked.length) st.picked = jget("agentGroupPicked", []).filter(function (id) { return st.agents.some(function (a) { return a.id === id; }); });
    st.agents.forEach(function (a) {
      var b = doc.createElement("button");
      b.type = "button"; b.className = "chip";
      b.setAttribute("aria-pressed", st.picked.indexOf(a.id) >= 0 ? "true" : "false");
      b.textContent = a.name; if (a.description) b.title = a.description;
      b.addEventListener("click", function () { st.picked = toggle(st.picked, a.id, MAX); paintPicker(); });
      list.appendChild(b);
    });
    $("gstart").disabled = st.picked.length < 2;
  }

  /* ---------- step 2: one conversation per agent ---------- */
  function startGroup() {
    var agents = st.picked.map(function (id) { for (var i = 0; i < st.agents.length; i++) if (st.agents[i].id === id) return st.agents[i]; }).filter(Boolean);
    if (agents.length < 2) return;
    ls("agentGroupPicked", JSON.stringify(st.picked));
    endGroup();
    var g = st.group = { id: "g" + Date.now().toString(36), at: Date.now(), members: [], prompts: [] };
    $("gpick").hidden = true; $("gchat").hidden = false; $("gcompose").hidden = false;
    $("gcols").innerHTML = ""; $("gtabs").innerHTML = "";
    $("gcols").style.setProperty("--n", agents.length);
    st.tab = 0; st.to = "all";
    agents.forEach(function (a, i) { g.members.push(member(a, i)); });
    paintTo(); paintTabs();
    say("Starting " + agents.length + " conversations…");
    Promise.all(g.members.map(connect)).then(function () {
      var bad = g.members.filter(function (m) { return m.failed; });
      say(bad.length ? "Could not start: " + bad.map(function (m) { return m.agent.name + " (" + m.failed + ")"; }).join(", ") : "");
      saveGroup(g);
      $("gtext").focus();
    });
  }
  function member(a, i) {
    var col = doc.createElement("section");
    col.className = "gcol"; col.setAttribute("data-i", i);
    col.innerHTML = '<div class="ghead"><b></b><span class="gstate" aria-live="polite"></span></div><div class="gwc"></div>';
    col.querySelector("b").textContent = a.name;
    $("gcols").appendChild(col);
    return { agent: a, col: col, wc: col.querySelector(".gwc"), state: col.querySelector(".gstate"), log: [], working: false, timer: null, sentAt: 0, firstMs: null, logged: 0 };
  }
  function connect(m) {
    return post("/token", m.agent.id).then(function (t) {
      m.conversationId = t.conversationId; m.userId = t.userId || ("dl_" + uuid()); m.name = t.name || "";
      var dl = m.dl = root.WebChat.createDirectLine({ token: t.token, domain: t.domain });
      var map = jget("agentConvAgent", {});
      if (m.conversationId && m.agent.id) { map[m.conversationId] = m.agent.id; ls("agentConvAgent", JSON.stringify(map)); }
      dl.connectionStatus$.subscribe(function (s) {
        if (s === 2 && !m.greeted) {
          m.greeted = true;
          dl.postActivity({ type: "event", name: "startConversation", locale: cfg.locale || "en-US",
            localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, from: { id: m.userId, name: m.name } }).subscribe();
        }
        if (s === 4 || s === 5) setState(m, "⚠ disconnected");
      });
      dl.activity$.subscribe(function (a) { onActivity(m, a); });
      var d = dark();
      root.WebChat.renderWebChat({
        directLine: dl, userID: m.userId, username: m.name, locale: cfg.locale || "en-US",
        styleOptions: {
          hideSendBox: true, botAvatarInitials: m.agent.initials || (m.agent.name || "A").slice(0, 2).toUpperCase(),
          bubbleMessageMaxWidth: 2000, bubbleAttachmentMaxWidth: 2000, bubbleMaxWidth: 2000,
          backgroundColor: d ? "#0f1420" : "#ffffff",
          bubbleBackground: d ? "#21283b" : "#f3f4f6", bubbleTextColor: d ? "#e5e7eb" : "#111827",
          bubbleFromUserBackground: "#2563eb", bubbleFromUserTextColor: "#ffffff"
        }
      }, m.wc);
      setState(m, "ready");
    }).catch(function (e) { m.failed = e.message || "error"; setState(m, "✕ " + m.failed); m.col.classList.add("failed"); });
  }
  function setState(m, t) { m.state.textContent = t; paintTabs(); }
  function onActivity(m, a) {
    if (!a || a.type !== "message") return;
    var fromMe = a.from && (a.from.id === m.userId || a.from.role === "user");
    if (fromMe) return;
    var g = st.group, pi = g ? g.prompts.length - 1 : -1;
    if (m.seen && m.seen[a.id]) return;
    (m.seen = m.seen || {})[a.id || uuid()] = 1;
    var ms = m.sentAt ? Date.now() - m.sentAt : null;
    m.log.push({ prompt: pi, at: Date.now(), text: a.text || "", attachments: (a.attachments || []).length, ms: m.firstMs == null ? ms : null });
    if (m.firstMs == null && ms != null) m.firstMs = ms;
    if (!m.working) { m.unread = true; paintTabs(); return; }
    var kind = root.AgentTurn ? root.AgentTurn.kind(a, m) : "unknown";
    clearTimeout(m.timer);
    setState(m, kind === "interim" ? "working… (progress note)" : "finishing…");
    m.timer = setTimeout(function () { done(m); }, settleAfter(kind));
    if (st.tab !== +m.col.getAttribute("data-i")) { m.unread = true; paintTabs(); }
  }
  function done(m) {
    m.working = false;
    var secs = m.firstMs != null ? (m.firstMs / 1000).toFixed(1) + " s" : "";
    setState(m, "✓ replied" + (secs ? " · first reply " + secs : ""));
    saveLog(m);
    if (st.group && st.group.members.every(function (x) { return !x.working; })) { $("gsend").disabled = false; }
  }
  function saveLog(m, keepalive) {
    if (!m.conversationId || m.loggingOff) return;
    post("/log", m.agent.id, { conversationId: m.conversationId, userId: m.userId, since: m.logged }, keepalive).then(function (j) {
      if (j.logged && typeof j.total === "number") m.logged = j.total;
      if (j.reason === "logging_disabled") m.loggingOff = true;
      if (j.more) saveLog(m);
    }).catch(function () {});
  }
  function saveGroup(g) {
    var list = jget("agentGroups", []);
    list.unshift({ id: g.id, at: g.at, members: g.members.map(function (m) { return { agent: m.agent.id, name: m.agent.name, conversationId: m.conversationId || null }; }) });
    ls("agentGroups", JSON.stringify(list.slice(0, 30)));
  }
  function endGroup() {
    var g = st.group; if (!g) return;
    g.members.forEach(function (m) { clearTimeout(m.timer); if (m.conversationId) saveLog(m, true); try { m.dl && m.dl.end(); } catch (e) {} });
    st.group = null;
  }

  /* ---------- step 3: one composer ---------- */
  function send() {
    var g = st.group, box = $("gtext"), text = box.value.trim();
    if (!g || !text) return;
    var to = targets(g.members, st.to).filter(function (m) { return m.dl; });
    if (!to.length) { say("No connected agent to send to."); return; }
    g.prompts.push({ at: Date.now(), text: text, to: st.to });
    to.forEach(function (m) {
      m.working = true; m.sentAt = Date.now(); m.firstMs = null;
      clearTimeout(m.timer);
      m.timer = setTimeout(function () { done(m); }, GRACE_MS + QUIET_MS);
      setState(m, "working…");
      m.dl.postActivity({ type: "message", text: text, locale: cfg.locale || "en-US", from: { id: m.userId, name: m.name, role: "user" } })
        .subscribe({ error: function () { setState(m, "✕ send failed"); m.working = false; } });
    });
    box.value = "";
    say("");
  }
  function paintTo() {
    var sel = $("gto"); sel.innerHTML = "";
    var all = doc.createElement("option"); all.value = "all"; all.textContent = "All agents"; sel.appendChild(all);
    (st.group ? st.group.members : []).forEach(function (m) { var o = doc.createElement("option"); o.value = m.agent.id; o.textContent = "Only " + m.agent.name; sel.appendChild(o); });
    sel.value = st.to;
  }
  function paintTabs() {
    var g = st.group, bar = $("gtabs"); if (!g) return;
    bar.innerHTML = "";
    g.members.forEach(function (m, i) {
      var b = doc.createElement("button");
      b.type = "button"; b.setAttribute("aria-selected", i === st.tab ? "true" : "false");
      b.textContent = m.agent.name + (m.working ? " …" : "") + (m.unread && i !== st.tab ? " •" : "");
      b.addEventListener("click", function () { st.tab = i; m.unread = false; showTab(); paintTabs(); });
      bar.appendChild(b);
    });
    showTab();
  }
  function showTab() { if (!st.group) return; st.group.members.forEach(function (m, i) { m.col.classList.toggle("active", i === st.tab); }); }
  function download() {
    var g = st.group; if (!g) return;
    var blob = new Blob([markdown(g)], { type: "text/markdown" });
    var a = doc.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "group-" + g.id + ".md";
    doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- wiring ---------- */
  if (cfg.groupChat === false) { say("Group chat is switched off (groupChat: false in config.js)."); $("ggate").hidden = true; return; }
  $("ggate").addEventListener("submit", function (e) { e.preventDefault(); var c = $("gcode").value.trim(); if (c) start(c); });
  $("gstart").addEventListener("click", startGroup);
  $("gnew").addEventListener("click", function () { endGroup(); paintPicker(); });
  $("gdown").addEventListener("click", download);
  $("gto").addEventListener("change", function () { st.to = $("gto").value; });
  $("gsend").addEventListener("click", send);
  $("gtext").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  root.addEventListener("pagehide", function () { if (st.group) st.group.members.forEach(function (m) { saveLog(m, true); }); });
  api.state = function () {
    var g = st.group;
    return { picked: st.picked, to: st.to, group: g && { id: g.id, prompts: g.prompts.length, members: g.members.map(function (m) { return { agent: m.agent.id, conversationId: m.conversationId, working: m.working, failed: m.failed || null, replies: m.log.length }; }) } };
  };
  var saved = ls("agentAccessCode");
  if (saved) start(saved); else $("ggate").hidden = false;
})(typeof window !== "undefined" ? window : globalThis);
