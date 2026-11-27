/* agent-webchat: end-of-turn detection (TODO #42, #55) + activity trace (research for TODO #1-#3).
 * Copilot Studio answers one turn with several messages: progress notes ("working on it...") and a final reply.
 * Microsoft's Direct Line guidance: there is no official "last response", but the final reply carries
 * inputHint "acceptingInput" (a question: "expectingInput") while progress notes carry none.
 * kind(activity, session) -> "final" | "interim" | "unknown" | "end" | "typing":
 *   - endOfConversation -> "end" (app.js ends the turn and releases the queue)                          (#55)
 *   - stream info (channelData.streamType, or an entities[type="streaminfo"] entry)                       (#55)
 *       "informative" / "streaming" -> interim, and the stream (streamId) counts as open
 *       "final" -> final, and that stream is closed
 *   - inputHint acceptingInput / expectingInput -> final (and remember that this conversation's agent sends hints)
 *   - inputHint ignoringInput -> interim
 *   - a typing activity without stream info -> "typing" (app.js keeps its typing grace, as before)
 *   - no hint while a stream is still open -> interim                                                    (#55)
 *   - no hint -> interim only once this conversation has shown hints; before that "unknown" (= old behaviour),
 *     so an agent that never sends hints is never stuck in "working".
 * app.js: interim messages / typing keep "Agent is working", don't release the next queued prompt and don't notify.
 * Trace: wraps WebChat.createStore (like voice.js) and keeps the last 100 incoming activities' metadata
 * (type, name, inputHint, streamType, replyToId, attachment types; text length only, never the text).
 * Console: AgentTurn.trace() / AgentTurn.summary(). Off switches in config.js: turnHints: false, debugActivities: false. */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var MAX = 100;
  var events = [];

  function hintOf(a) { return (a && typeof a.inputHint === "string") ? a.inputHint : ""; }
  /** Stream info from channelData, else from an entities[type="streaminfo"] entry (Web Chat accepts both). */
  function streamInfo(a) {
    var c = a && a.channelData;
    if (c && typeof c.streamType === "string") return { type: c.streamType, id: c.streamId ? String(c.streamId) : "" };
    var es = (a && Array.isArray(a.entities)) ? a.entities : [];
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e && e.type === "streaminfo" && typeof e.streamType === "string") return { type: e.streamType, id: e.streamId ? String(e.streamId) : "" };
    }
    return { type: "", id: "" };
  }
  function streamOf(a) { return streamInfo(a).type; }
  function openStreams(s) { if (s && !s.awStreams) s.awStreams = {}; return s ? s.awStreams : {}; }
  function anyOpen(s) { var o = s && s.awStreams; if (!o) return false; for (var k in o) if (o[k]) return true; return false; }

  /** Pure (apart from the per-session flags it sets): what this agent activity means for the turn. */
  function kind(a, s) {
    if (cfg.turnHints === false || !a) return "unknown";
    if (a.type === "endOfConversation") return "end";
    var h = hintOf(a), si = streamInfo(a), st = si.type;
    if (st === "informative" || st === "streaming") {
      if (si.id) openStreams(s)[si.id] = true;
      return "interim";
    }
    if (st === "final") {
      if (si.id && s && s.awStreams) delete s.awStreams[si.id];
      else if (s) s.awStreams = {}; // a final without an id closes whatever was open
      if (s) s.awHints = true;
      return "final";
    }
    if (a.type === "typing") return "typing";
    if (h === "acceptingInput" || h === "expectingInput") { if (s) s.awHints = true; return "final"; }
    if (h === "ignoringInput") return "interim";
    if (anyOpen(s)) return "interim";
    return s && s.awHints ? "interim" : "unknown";
  }

  function meta(a) {
    var atts = (a.attachments || []).map(function (x) { return (x && x.contentType) || "?"; });
    var c = a.channelData || {};
    var si = streamInfo(a);
    return {
      at: new Date().toISOString().slice(11, 19), type: a.type || "", name: a.name || "",
      role: (a.from && a.from.role) || "", inputHint: hintOf(a), streamType: si.type,
      streamId: c.streamId || si.id || "", streamSequence: c.streamSequence === undefined ? "" : c.streamSequence,
      replyToId: a.replyToId || "", id: a.id || "", textLength: typeof a.text === "string" ? a.text.length : 0,
      attachments: atts.join(", "), entities: (a.entities || []).map(function (e) { return (e && e.type) || "?"; }).join(", ")
    };
  }
  function record(a) {
    if (!a) return;
    try { events.push(meta(a)); } catch (e) { return; }
    if (events.length > MAX) events.splice(0, events.length - MAX);
  }
  function traceMiddleware() {
    return function (next) {
      return function (action) {
        if (action && action.type === "DIRECT_LINE/INCOMING_ACTIVITY" && action.payload) record(action.payload.activity);
        return next(action);
      };
    };
  }
  function install(W) {
    if (!W || W.__awTurn || typeof W.createStore !== "function") return false;
    var cs = W.createStore;
    W.createStore = function () {
      var args = Array.prototype.slice.call(arguments);
      if (!args.length) args.push({});
      args.push(traceMiddleware);
      return cs.apply(this, args);
    };
    try { W.__awTurn = true; } catch (e) {}
    return true;
  }
  /** Counts per type / inputHint / streamType: answers "does the agent stream? send hints? send events?" at a glance. */
  function summary() {
    var out = {};
    events.forEach(function (e) {
      var k = e.type + (e.name ? ":" + e.name : "") + " | hint=" + (e.inputHint || "-") + " | stream=" + (e.streamType || "-");
      out[k] = (out[k] || 0) + 1;
    });
    return out;
  }

  root.AgentTurn = {
    kind: kind, record: record, traceMiddleware: traceMiddleware, install: install, summary: summary,
    streamInfo: streamInfo, trace: function () { return events.slice(); }
  };
  if (root.WebChat && cfg.debugActivities !== false) install(root.WebChat);
})(typeof window !== "undefined" ? window : globalThis);
