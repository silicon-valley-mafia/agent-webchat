/* agent-webchat: message times (TODO #36, #57). Loaded before app.js; app.js is unchanged by this feature.
 * #57 default ("both"): every status shows the posting time AND Web Chat's "... ago", e.g. "03:05 · 8 minutes ago"
 * (another day: "Fri 27 Nov, 17:08 · 10 hours ago"); hovering it shows the exact local date and time with seconds and
 * time zone, e.g. "Fri, 27 Nov 2026, 17:08:08 IST" (tap on touch screens). The time is the message's SERVER
 * timestamp (activity.timestamp), the same clock the logs use.
 * How: Web Chat (CDN bundle, no React access here) renders each status as .webchat__activity-status next to its
 * bubble; a small DOM pass matches the bubble's text to the activity in the store and sets a title on the status plus
 * a data-aw-short attribute that CSS shows in front of "... ago" (no text nodes are changed, so React is unaffected).
 * timestampMode in config.js: "both" (default), "relative" (only "... ago", exact time on hover), "absolute"
 * (Web Chat's own absolute time). timeFormat: "24h" | "12h" (default: browser locale).
 * Off switch: exactTimeOnHover: false. Console: AgentTime.scan() -> number of statuses that got a time.
 */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var MODE = cfg.timestampMode || "both";

  /* ---------- pure helpers (tested in worker/test/rail.test.js and gfm.test.js) ---------- */
  /** Letters and digits only, lower case: rendered Markdown and the raw activity text compare equal. */
  function norm(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ""); }
  /**
   * The activity a rendered bubble belongs to: newest unused message from the same side whose text starts the same
   * way (24 letters - links/Markdown further in may render differently). A bubble without text (attachments only)
   * gets the newest unused message without text that has attachments. Returns the activity or null.
   */
  function match(acts, text, fromUser, used) {
    var k = norm(text).slice(0, 24);
    for (var i = (acts || []).length - 1; i >= 0; i--) {
      var a = acts[i];
      if (!a || a.type !== "message" || !a.timestamp || (used && used[a.id])) continue;
      var isUser = !!(a.from && a.from.role === "user");
      if (isUser !== !!fromUser) continue;
      var ak = norm(a.text).slice(0, 24);
      if (k.length < 2) { if (!ak && (a.attachments || []).length) return a; continue; }
      if (ak && (ak === k || (k.length < 24 && ak.indexOf(k) === 0))) return a;
    }
    return null;
  }
  /** "Fri, 27 Nov 2026, 17:08:08 IST" in the browser's locale and time zone (timeZone option for tests). */
  function format(iso, opts) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var o = { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" };
    if (opts && opts.timeZone) o.timeZone = opts.timeZone;
    try { return new Intl.DateTimeFormat((opts && opts.locale) || undefined, o).format(d); } catch (e) { return d.toString(); }
  }
  function dayKey(d, tz) {
    try { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d); } catch (e) { return d.toDateString(); }
  }
  /**
   * #57: the short posting time shown on the message: "03:05" today, "Fri 27 Nov, 17:08" on another day.
   * opts: { now, timeZone, locale, timeFormat: "24h" | "12h" }.
   */
  function short(iso, opts) {
    opts = opts || {};
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var now = opts.now ? new Date(opts.now) : new Date();
    var t = { hour: "2-digit", minute: "2-digit" };
    if (opts.timeFormat === "24h") t.hourCycle = "h23";
    if (opts.timeFormat === "12h") t.hour12 = true;
    if (opts.timeZone) t.timeZone = opts.timeZone;
    var loc = opts.locale || undefined;
    try {
      var time = new Intl.DateTimeFormat(loc, t).format(d);
      if (dayKey(d, opts.timeZone) === dayKey(now, opts.timeZone)) return time;
      var o = { weekday: "short", day: "numeric", month: "short" };
      if (opts.timeZone) o.timeZone = opts.timeZone;
      if (d.getFullYear() !== now.getFullYear()) o.year = "numeric";
      return new Intl.DateTimeFormat(loc, o).format(d).replace(/,/g, "") + ", " + time;
    } catch (e) { return d.toLocaleString(); }
  }
  var api = { norm: norm, match: match, format: format, short: short, mode: MODE };
  root.AgentTime = api;

  var doc = root.document;
  if (!doc || cfg.exactTimeOnHover === false) return;

  // Web Chat's own absolute mode, if chosen (wraps renderWebChat once, like stop.js / voice.js)
  function wrap(W) {
    if (!W || W.__awTime || typeof W.renderWebChat !== "function") return;
    var orig = W.renderWebChat;
    W.renderWebChat = function (props, el) {
      if (MODE === "absolute" && props) {
        props = Object.assign({}, props, { styleOptions: Object.assign({}, props.styleOptions, { timestampFormat: "absolute" }) });
      }
      return orig.call(this, props, el);
    };
    W.__awTime = true;
  }
  wrap(root.WebChat);

  function shortOpts() { return { timeFormat: cfg.timeFormat }; }
  function setShort(status, iso) {
    if (MODE !== "both") return;
    var s = short(iso, shortOpts());
    if (s && status.getAttribute("data-aw-short") !== s + " \u00b7 ") status.setAttribute("data-aw-short", s + " \u00b7 ");
  }
  function store() { var a = root.__agentWebchat, s = a && a.cur ? a.cur() : null; return s && s.store; }
  function scan() {
    var wrapEl = doc.getElementById("chatwrap");
    var st = store();
    if (!wrapEl || !st) return 0;
    var acts = [];
    try { acts = st.getState().activities || []; } catch (e) { return 0; }
    var used = {}, n = 0;
    var list = Array.prototype.slice.call(wrapEl.querySelectorAll(".webchat__activity-status"));
    // newest first, so repeated texts ("ok") map to the newest matching activity on the bottom
    list.reverse().forEach(function (status) {
      var known = status.getAttribute("data-aw-id");
      if (known) { used[known] = true; setShort(status, status.getAttribute("data-aw-time")); n++; return; }
      var row = status.closest("[role='listitem'], .webchat__basic-transcript__activity") || status.parentElement;
      var bubbles = row ? row.querySelectorAll(".webchat__bubble") : [];
      var b = bubbles.length ? bubbles[bubbles.length - 1] : null;
      if (!b) return;
      var c = b.querySelector(".webchat__bubble__content") || b;
      var a = match(acts, c.innerText || c.textContent, b.classList.contains("webchat__bubble--from-user"), used);
      if (!a) return;
      used[a.id] = true;
      var text = format(a.timestamp);
      if (!text) return;
      status.setAttribute("data-aw-id", a.id || "x");
      status.setAttribute("data-aw-time", a.timestamp);
      status.title = text;
      setShort(status, a.timestamp);
      n++;
    });
    return n;
  }
  api.scan = scan;

  var t = null;
  function later() { clearTimeout(t); t = setTimeout(scan, 250); }
  function start() {
    var css = doc.createElement("style");
    css.textContent = ".webchat__activity-status[data-aw-short]::before{content:attr(data-aw-short)}" +
      ".webchat__activity-status[data-aw-time]{cursor:help}";
    (doc.head || doc.documentElement).appendChild(css);
    var target = doc.getElementById("app") || doc.body;
    if (root.MutationObserver) new MutationObserver(later).observe(target, { childList: true, subtree: true, characterData: true });
    setInterval(scan, 30000);
    // touch screens have no hover: a tap shows the time for 3 s
    doc.addEventListener("click", function (e) {
      var s = e.target && e.target.closest && e.target.closest(".webchat__activity-status[data-aw-time]");
      if (!s) return;
      var tip = doc.getElementById("awtime") || doc.body.appendChild(Object.assign(doc.createElement("div"), { id: "awtime" }));
      var r = s.getBoundingClientRect();
      tip.textContent = s.title;
      tip.style.left = Math.max(4, Math.min(r.left, root.innerWidth - 260)) + "px";
      tip.style.top = Math.max(4, r.top - 30) + "px";
      tip.hidden = false;
      clearTimeout(tip.__t);
      tip.__t = setTimeout(function () { tip.hidden = true; }, 3000);
    });
    later();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
