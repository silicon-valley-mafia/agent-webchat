// Tests for web/voice.js (dictation diagnostics, TODO #40), run in Node with a fake SpeechRecognition.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../web/voice.js";

const V = globalThis.AgentVoice;

class FakeRecognition extends EventTarget {
  constructor() { super(); this.lang = "en-US"; this.continuous = false; this.interimResults = true; this.calls = []; }
  start() { this.calls.push("start"); if (this.failStart) { const e = new Error("already started"); e.name = "InvalidStateError"; throw e; } }
  stop() { this.calls.push("stop"); }
  abort() { this.calls.push("abort"); }
  fire(type, props = {}) { const e = new Event(type); Object.assign(e, props); this.dispatchEvent(e); }
}
const result = (t) => ({ results: [[{ transcript: t, confidence: 0.9 }]] });

function setup() {
  const problems = [];
  const base = () => ({ SpeechRecognition: FakeRecognition, speechSynthesis: { x: 1 }, SpeechSynthesisUtterance: function () {} });
  const factory = V.wrapFactory(base, { onProblem: (msg, info) => problems.push({ msg, info }) });
  const p = factory({ referenceGrammarID: "g" });
  return { problems, p };
}

test("wrapFactory keeps the ponyfill shape and returns real recognizers", () => {
  const { p } = setup();
  assert.equal(typeof p.SpeechRecognition, "function");
  assert.deepEqual(p.speechSynthesis, { x: 1 });
  const r = new p.SpeechRecognition();
  assert.ok(r instanceof FakeRecognition);
  r.start();
  assert.deepEqual(r.calls, ["start"]);
  assert.equal(V.wrapFactory(null), null);
});

test("network error (Brave / no Google speech service) is explained once", () => {
  const { p, problems } = setup();
  const r = new p.SpeechRecognition();
  r.start(); r.fire("start"); r.fire("audiostart"); r.fire("error", { error: "network" }); r.fire("end");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].info.code, "network");
  assert.match(problems[0].msg, /speech-to-text service/);
  assert.match(problems[0].msg, /start\(\) → start → audio → error:network → end/);
  r.fire("end");
  assert.equal(problems.length, 1);
});

test("successful dictation reports nothing; report() shows the text", () => {
  const { p, problems } = setup();
  const r = new p.SpeechRecognition();
  r.start(); r.fire("start"); r.fire("audiostart"); r.fire("soundstart"); r.fire("speechstart");
  r.fire("result", result("hello world")); r.fire("end");
  assert.equal(problems.length, 0);
  assert.match(V.report(), /^ok .*"hello world"/);
});

test("no error but no text: classified from the events seen", () => {
  assert.equal(V.classify({ text: "hi" }), null);
  assert.equal(V.classify({ error: "not-allowed" }), "not-allowed");
  assert.equal(V.classify({ startError: "InvalidStateError" }), "start-failed");
  assert.equal(V.classify({ speech: true }), "no-match");
  assert.equal(V.classify({ sound: true }), "no-speech");
  assert.equal(V.classify({ audio: true }), "silent");
  assert.equal(V.classify({ started: true }), "no-audio");
  assert.equal(V.classify({}), "unknown");
  const { p, problems } = setup();
  const r = new p.SpeechRecognition();
  r.start(); r.fire("start"); r.fire("audiostart"); r.fire("end");
  assert.equal(problems[0].info.code, "silent");
});

test("stop/abort calls are traced (shows who ended the attempt) and start() failures are reported", () => {
  const { p, problems } = setup();
  const r = new p.SpeechRecognition();
  r.start(); r.fire("start"); r.abort(); r.fire("error", { error: "aborted" }); r.fire("end");
  assert.equal(problems[0].info.code, "aborted");
  assert.match(problems[0].info.steps, /abort\(\) → error:aborted → end/);
  const r2 = new p.SpeechRecognition();
  r2.failStart = true;
  assert.throws(() => r2.start(), /already started/);
  assert.equal(problems[1].info.code, "start-failed");
  V.note("WEB_CHAT/STOP_DICTATE");
  assert.equal(V.trace().at(-1).type, "WEB_CHAT/STOP_DICTATE");
});

test("install wraps Web Chat in place: speech factory + a store middleware that records DICTATE actions", () => {
  const problems = [];
  const seen = [];
  const W = {
    createBrowserWebSpeechPonyfillFactory: () => () => ({ SpeechRecognition: FakeRecognition }),
    createStore: (initial, ...mws) => {
      // minimal Redux: run the middleware chain once per dispatch
      const api = { getState: () => initial, dispatch: (a) => chain(a) };
      const base = (a) => { seen.push(a.type); return a; };
      const chain = mws.map((m) => m(api)).reduceRight((next, mw) => mw(next), base);
      return { dispatch: chain, mws: mws.length };
    }
  };
  const done = V.install(W, { onProblem: (m) => problems.push(m) });
  assert.deepEqual(done, { speech: true, store: true });
  assert.deepEqual(V.install(W), { speech: false, store: false }, "second install is a no-op");

  const appMw = () => (next) => (a) => next(a);
  const store = W.createStore({}, appMw);
  assert.equal(store.mws, 2, "app middleware kept, ours appended");
  store.dispatch({ type: "WEB_CHAT/START_DICTATE" });
  store.dispatch({ type: "WEB_CHAT/SET_DICTATE_STATE", payload: { dictateState: 0 } });
  store.dispatch({ type: "DIRECT_LINE/POST_ACTIVITY" });
  assert.deepEqual(seen, ["WEB_CHAT/START_DICTATE", "WEB_CHAT/SET_DICTATE_STATE", "DIRECT_LINE/POST_ACTIVITY"]);
  const types = V.trace().map((e) => e.type);
  assert.ok(types.includes("WEB_CHAT/START_DICTATE") && types.includes("WEB_CHAT/SET_DICTATE_STATE"));
  assert.ok(!types.slice(-3).includes("DIRECT_LINE/POST_ACTIVITY"));

  const p = W.createBrowserWebSpeechPonyfillFactory()();
  const r = new p.SpeechRecognition();
  r.start(); r.fire("start"); r.fire("error", { error: "not-allowed" }); r.fire("end");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /blocked for this site/);
});

test("async factories are wrapped too", async () => {
  const f = V.wrapFactory(() => Promise.resolve({ SpeechRecognition: FakeRecognition }), {});
  const p = await f();
  assert.ok(new p.SpeechRecognition() instanceof FakeRecognition);
});
