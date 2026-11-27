/* agent-webchat: end-of-turn detection (TODO #42) + activity trace (research for TODO #1-#3).
 * Copilot Studio answers one turn with several messages: progress notes ("working on it...") and a final reply.
 * Microsoft's Direct Line guidance: there is no official "last response", but the final reply carries
 * inputHint "acceptingInput" (a question: "expectingInput") while progress notes carry none.
 * kind(activity, session) -> "final" | "interim" | "unknown":
 *   - inputHint acceptingInput / expectingInput -> final (and remember that this conversation's agent sends hints)
 *   - inputHint ignoringInput, or channelData.streamType "informative" / "streaming" -> interim
 *   - no hint -> interim only once this conversation has shown hints; before that "unknown" (= old behaviour),
 *     so an agent that never sends hints is never stuck in "working".
 * app.js: interim messages keep "Agent is working", don't release the next queued prompt and don't notify.
 * Trace: wraps WebChat.createStore (like voice.js) and keeps the last 100 incoming activities' metadata
 * (type, name, inputHint, streamType, replyToId, attachment types; text length only, never the text).
 * Console: AgentTurn.trace() / AgentTurn.summary(). Off switches in config.js: turnHints: false, debugActivities: false. */
(function (root) {
  "use strict";
  var cfg = root.AGENT_WEBCHAT_CONFIG || {};
  var MAX = 100;
  var events = [];

  function hintOf(a) { return (a && typeof a.inputHint === "string") ? a.inputHint : ""; }
  function streamOf(a) { var c = a && a.channelData; return (c && typeof c.streamType === "string") ? c.streamType : ""; }

  /** Pure (apart from the per-session flag it sets): what this agent message means for the turn. */
  function kind(a, s) {
    if (cfg.turnHints === false || !a) return "unknown";
    var h = hintOf(a), st = streamOf(a);
    if (st === "informative" || st === "streaming") return "interim";
    if (h === "acceptingInput" || h === "expectingInput") { if (s) s.awHints = true; return "final"; }
    if (h === "ignoringInput") return "interim";
    return s && s.awHints ? "interim" : "unknown";
  }

  function meta(a) {
    var atts = (a.attachments || []).map(function (x) { return (x && x.contentType) || "?"; });
    var c = a.channelData || {};
    return {
      at: new Date().toISOString().slice(11, 19), type: a.type || "", name: a.name || "",
      role: (a.from && a.from.role) || "", inputHint: hintOf(a), streamType: streamOf(a),
      streamId: c.streamId || "", streamSequence: c.streamSequence === undefined ? "" : c.streamSequence,
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
    trace: function () { return events.slice(); }
  };
  if (root.WebChat && cfg.debugActivities !== false) install(root.WebChat);
})(typeof window !== "undefined" ? window : globalThis);
