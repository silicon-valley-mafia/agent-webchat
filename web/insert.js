/* agent-webchat: TODO #37a "📄 File" - insert a .md / .txt file from an allowed GitHub repo path into the message.
 *
 * - The Worker decides what this access code may read (POST /file, worker/src/repofile.js); the page only shows it.
 * - Flow: 📄 File -> pick an allowed folder (or type owner/repo/path) -> preview -> "Insert into message".
 *   Nothing is sent automatically: the text goes into the send box as
 *       [file: owner/repo/path@sha7]
 *       <file text>
 *       [end of file]
 *   so you can read it, add your question and press Enter. The transcript log therefore records path + sha.
 * - Repo files are untrusted input (anyone who can write the repo can put instructions in them): always preview.
 * - Size cap comes from the Worker (FILE_MAX_BYTES, default 30 KB).
 * Off switch: insertFile: false in web/config.js. app.js unchanged (uses window.__agentWebchat.cur()).
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var api = {};

  /** Pure: "owner/repo/some/path.md" -> {repo, path}; null if not at least owner/repo. */
  api.parse = function (s) {
    var parts = String(s || "").trim().replace(/^\/+/, "").split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { repo: parts[0] + "/" + parts[1], path: parts.slice(2).join("/").replace(/\/+$/, "") };
  };
  /** Pure: what goes into the send box. Typed text stays first, the file block follows. */
  api.compose = function (typed, file) {
    var block = file.header + "\n" + String(file.text || "").replace(/\s+$/, "") + "\n[end of file]";
    var t = String(typed || "").replace(/\s+$/, "");
    return t ? t + "\n\n" + block : block;
  };
  api.fmt = function (n) { return n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB"; };
  root.AgentInsert = api;
  if (cfg.insertFile === false || typeof document === "undefined") return;

  var base = cfg.tokenEndpoint && cfg.tokenEndpoint.indexOf("REPLACE_WITH") !== 0 ? cfg.tokenEndpoint.replace(/\/token\/?$/, "") : "";
  if (!base) return;
  var state = { roots: [], maxBytes: 30720, code: "", file: null };
  var MSG = {
    file_disabled: "Insert file is not set up on the Worker (FILE_READ_TOKEN).",
    no_file_access: "This access code may not read repo files.",
    path_not_allowed: "That path is not in your allowed folders.",
    not_found: "Not found.",
    not_text: "Only .md, .markdown and .txt files can be inserted.",
    bad_path: "That path isn't valid.",
    bad_repo: "Use owner/repo/path.",
    rate_limited: "Too many requests - wait a minute."
  };

  function code() { try { return localStorage.getItem("agentAccessCode") || ""; } catch (e) { return ""; } }
  function call(body) {
    return fetch(base + "/file", { method: "POST", headers: { "X-Access-Code": state.code, "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; }); });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(label, fn, cls) { var b = el("button", cls, label); b.type = "button"; b.addEventListener("click", fn); return b; }

  var css = el("style");
  css.textContent =
    "#awfile{position:fixed;inset:8% 10%;z-index:60;background:var(--bg,#fff);color:inherit;border:1px solid #8884;border-radius:10px;" +
    "box-shadow:0 10px 40px #0004;display:flex;flex-direction:column;padding:12px;gap:8px}" +
    "html[data-theme=dark] #awfile{background:#0f172a}" +
    "#awfile .bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}#awfile input{flex:1;min-width:240px;padding:6px}" +
    "#awfile .list{overflow:auto;flex:1;border:1px solid #8883;border-radius:6px;padding:6px}" +
    "#awfile .list button{display:block;width:100%;text-align:left;border:0;background:none;padding:4px 6px;cursor:pointer;color:inherit}" +
    "#awfile .list button:hover{background:#8882}#awfile pre{white-space:pre-wrap;margin:0;font-size:12px}" +
    "#awfile .warn{color:#b45309;font-size:12px}#awfile .err{color:#dc2626}";
  document.head.appendChild(css);

  var open = btn("📄 File", function () { show(); }, "");
  open.id = "filebtn";
  open.hidden = true;
  open.title = "Insert a .md / .txt file from an allowed GitHub repo into your message (preview first)";
  var anchor = document.getElementById("groupbtn") || document.getElementById("widthbtn");
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(open, anchor);

  var box = el("div"); box.id = "awfile"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Insert file");
  var top = el("div", "bar");
  var input = el("input"); input.placeholder = "owner/repo/path/file.md"; input.setAttribute("aria-label", "Repo path");
  top.appendChild(el("strong", "", "📄 Insert file"));
  top.appendChild(input);
  top.appendChild(btn("Open", function () { go(input.value); }, "primary"));
  top.appendChild(btn("Close ✕", function () { box.hidden = true; }));
  var info = el("div", "warn", "Files from a repo are untrusted input - read the preview before sending. Nothing is sent until you press Enter.");
  var status = el("div");
  var list = el("div", "list");
  var foot = el("div", "bar");
  [top, info, status, list, foot].forEach(function (x) { box.appendChild(x); });
  document.body.appendChild(box);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(input.value); if (e.key === "Escape") box.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) box.hidden = true; });

  function setStatus(t, err) { status.textContent = t || ""; status.className = err ? "err" : ""; }
  function errText(j) {
    if (j.error === "file_too_large") return "Too big: " + api.fmt(j.size) + " (limit " + api.fmt(j.maxBytes) + "). Insert a smaller file or a section of it.";
    return MSG[j.error] || ("Couldn't read it (" + (j.error || j.__status) + ").");
  }
  function showRoots() {
    list.innerHTML = ""; foot.innerHTML = ""; state.file = null;
    list.appendChild(el("div", "", "Allowed folders:"));
    state.roots.forEach(function (r) { list.appendChild(btn("📁 " + r, function () { go(r); })); });
  }
  function show() {
    box.hidden = false;
    input.focus();
    if (!state.file) showRoots();
  }
  function go(target) {
    var t = api.parse(target);
    if (!t) { setStatus(MSG.bad_repo, true); return; }
    input.value = t.repo + "/" + t.path;
    setStatus("Loading…");
    call({ op: "get", repo: t.repo, path: t.path }).then(function (j) {
      if (j.error) { setStatus(errText(j), true); return; }
      setStatus("");
      if (j.type === "dir") return listDir(j);
      preview(j);
    }, function () { setStatus("Couldn't reach the Worker.", true); });
  }
  function listDir(j) {
    list.innerHTML = ""; foot.innerHTML = ""; state.file = null;
    var up = j.path.split("/").slice(0, -1).join("/");
    list.appendChild(btn("⬆ " + (j.path ? j.repo + "/" + up : "Allowed folders"), function () { j.path ? go(j.repo + "/" + up) : showRoots(); }));
    if (!j.entries.length) list.appendChild(el("div", "warn", "No .md / .txt files here."));
    j.entries.forEach(function (e) {
      var label = (e.type === "dir" ? "📁 " : "📄 ") + e.name + (e.type === "file" && e.size ? "  ·  " + api.fmt(e.size) : "");
      list.appendChild(btn(label, function () { go(j.repo + "/" + e.path); }));
    });
  }
  function preview(j) {
    state.file = j;
    list.innerHTML = "";
    var pre = el("pre");
    pre.textContent = j.text.length > 20000 ? j.text.slice(0, 20000) + "\n… (preview cut; the whole file is inserted)" : j.text;
    list.appendChild(pre);
    foot.innerHTML = "";
    foot.appendChild(el("span", "", j.header + " · " + api.fmt(j.size)));
    foot.appendChild(btn("Insert into message", function () { insert(j); }, "primary"));
    foot.appendChild(btn("Back", function () { var p = api.parse(input.value); go(p.repo + "/" + p.path.split("/").slice(0, -1).join("/")); }));
  }
  function insert(j) {
    var A = root.__agentWebchat, s = A && A.cur && A.cur();
    if (!s || !s.store) { setStatus("Open a chat first.", true); return; }
    var typed = "";
    try { typed = String(s.store.getState().sendBoxValue || ""); } catch (e) {}
    s.store.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: api.compose(typed, j) } });
    box.hidden = true;
    try { var ta = s.mount.querySelector(".webchat__send-box textarea, .webchat__send-box input"); if (ta) ta.focus(); } catch (e) {}
  }

  /** Show the button only when this code has allowed folders (asked once per code; again after a code change). */
  function refresh() {
    var c = code();
    if (!c || c === state.code) return;
    state.code = c;
    call({ op: "roots" }).then(function (j) {
      state.roots = (j && j.roots) || [];
      if (j && j.maxBytes) state.maxBytes = j.maxBytes;
      open.hidden = !state.roots.length;
    }, function () { open.hidden = true; });
  }
  refresh();
  setInterval(refresh, 5000);
  api.state = function () { return { roots: state.roots.slice(), maxBytes: state.maxBytes, visible: !open.hidden }; };
})(typeof window !== "undefined" ? window : globalThis);
