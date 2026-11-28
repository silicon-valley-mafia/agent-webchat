// TODO #50: Copy / Reuse buttons on the messages you send (web/copyprompt.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Minimal DOM: enough for decorate() and fill().
function el(tag, props = {}) {
  const node = {
    tagName: tag.toUpperCase(), children: [], parentNode: null, className: "", textContent: "", value: "",
    style: {}, attrs: {}, listeners: {}, offsetParent: {}, ...props,
    appendChild(c) { c.parentNode = node; node.children.push(c); return c; },
    remove() {},
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener(t, f) { node.listeners[t] = f; },
    dispatchEvent(e) { node.lastEvent = e.type; },
    focus() { node.focused = true; },
    setSelectionRange() {},
    select() {},
    querySelectorAll(sel) { return all(node).filter((n) => matches(n, sel)); },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
  };
  Object.defineProperty(node, "innerText", { get: () => node.text ?? node.textContent });
  return node;
}
function all(n) { return n.children.flatMap((c) => [c, ...all(c)]); }
function matches(n, sel) { return sel.split(",").some((s) => (" " + n.className + " ").includes(" " + s.trim().replace(/^\./, "") + " ")); }

function page(cfg, { withObserver = true } = {}) {
  const head = el("head");
  const body = el("body");
  const document = {
    head, body, documentElement: el("html"),
    createElement: (t) => el(t),
    querySelectorAll: (s) => body.querySelectorAll(s),
    addEventListener() {},
    execCommand: () => true,
  };
  body.parentNode = null;
  const copied = [];
  const window = {
    AGENT_WEBCHAT_CONFIG: cfg, document,
    navigator: { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } },
    Event: class { constructor(type) { this.type = type; } },
    HTMLTextAreaElement: { prototype: {} }, HTMLInputElement: { prototype: {} },
  };
  if (withObserver) window.MutationObserver = class { constructor(f) { window.__mo = f; } observe() { window.__observing = true; } };
  vm.runInContext(fs.readFileSync(new URL("../../web/copyprompt.js", import.meta.url), "utf8"),
    vm.createContext({ window, Object, String, Promise, setTimeout: () => 0 }), { filename: "copyprompt.js" });
  return { window, document, copied };
}

function chat(document, texts) {
  const wrap = document.body.appendChild(el("div", { className: "chat" }));
  const box = wrap.appendChild(el("textarea", { className: "webchat__send-box-text-box__input" }));
  const bubbles = texts.map((t) => {
    const b = wrap.appendChild(el("div", { className: "webchat__bubble webchat__bubble--from-user" }));
    b.appendChild(el("div", { className: "webchat__bubble__content", text: t }));
    return b;
  });
  const bot = wrap.appendChild(el("div", { className: "webchat__bubble" }));
  bot.appendChild(el("div", { className: "webchat__bubble__content", text: "agent reply" }));
  return { box, bubbles, bot };
}
const bar = (b) => b.children.find((c) => c.className === "aw-ptools");
const btnOf = (b, label) => bar(b).children.find((c) => c.textContent === label);

test("stripHeader removes the #51 session header block, keeps plain text", () => {
  const { window } = page({});
  const s = window.AgentCopyPrompt.stripHeader;
  assert.equal(s("[session header]\nDeepesh, IST\nline 2\n[end of header]\n\nfix the bug"), "fix the bug");
  assert.equal(s("[session header]\nx\n[end of header]"), "", "header only = nothing typed");
  assert.equal(s("plain prompt\n"), "plain prompt");
  assert.equal(s("[session header] not a block"), "[session header] not a block");
  assert.equal(s("[session header]\nno end marker"), "[session header]\nno end marker");
  assert.equal(s(null), "");
});

test("decorate: user bubbles with text get Copy + Reuse once; agent and empty bubbles get none", () => {
  const { window, document } = page({});
  const { bubbles, bot } = chat(document, ["hello", "", "[session header]\nH\n[end of header]\n\nsecond"]);
  assert.equal(window.AgentCopyPrompt.decorate(), 2);
  assert.ok(bar(bubbles[0]) && bar(bubbles[2]));
  assert.equal(bar(bubbles[1]), undefined, "attachment-only bubble");
  assert.equal(bar(bot), undefined, "agent reply untouched");
  assert.deepEqual(bar(bubbles[0]).children.map((c) => c.textContent), ["Copy", "Reuse"]);
  assert.equal(window.AgentCopyPrompt.decorate(), 0, "idempotent");
});

test("Copy copies the typed text without the header; Reuse fills this chat's send box", async () => {
  const { window, document, copied } = page({});
  const { box, bubbles } = chat(document, ["[session header]\nH\n[end of header]\n\nrun the tests"]);
  window.AgentCopyPrompt.decorate();
  btnOf(bubbles[0], "Copy").listeners.click({ preventDefault() {}, stopPropagation() {} });
  await Promise.resolve();
  assert.deepEqual(copied, ["run the tests"]);
  btnOf(bubbles[0], "Reuse").listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(box.value, "run the tests");
  assert.equal(box.lastEvent, "input", "React sees the change");
  assert.ok(box.focused);
});

test("on by default (observer + style); copyPrompt:false adds nothing", () => {
  const on = page({});
  assert.equal(on.window.__observing, true);
  assert.equal(on.document.head.children.length, 1, "one <style>");
  const off = page({ copyPrompt: false });
  assert.equal(off.window.__observing, undefined);
  assert.equal(off.document.head.children.length, 0);
  assert.equal(typeof off.window.AgentCopyPrompt.stripHeader, "function", "helpers still exported");
});

// Owner 07:33 IST: "Reuse didn't work". Web Chat 4.19 with multilineInput renders a textarea with class
// webchat__send-box-text-box__html-text-area; the old lookup only knew webchat__send-box-text-box__input.
test("Reuse: multi-line send box (Web Chat 4.19 textarea class) is found", () => {
  const { window, document } = page({});
  const wrap = document.body.appendChild(el("div", { className: "chat" }));
  const box = wrap.appendChild(el("textarea", { className: "webchat__send-box-text-box__html-text-area" }));
  const b = wrap.appendChild(el("div", { className: "webchat__bubble webchat__bubble--from-user" }));
  b.appendChild(el("div", { className: "webchat__bubble__content", text: "[route: coach]\nsummarise chapter 4" }));
  window.AgentCopyPrompt.decorate();
  btnOf(b, "Reuse").listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(box.value, "summarise chapter 4");
  assert.ok(window.AgentCopyPrompt.BOX_SEL.includes("webchat__send-box-text-box__html-text-area"));
});

test("Reuse: goes through the open chat's Web Chat store (SET_SEND_BOX) when there is one; raw text from gfm.js", () => {
  const { window, document } = page({});
  const sent = [];
  window.__agentWebchat = { cur: () => ({ store: { dispatch: (a) => sent.push(a) } }) };
  const { box, bubbles } = chat(document, ["shown text"]);
  bubbles[0].__awRaw = "[session header]\nH\n[end of header]\n\n| a | b |\n|---|---|\n| 1 | 2 |";
  window.AgentCopyPrompt.decorate();
  btnOf(bubbles[0], "Reuse").listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: "| a | b |\n|---|---|\n| 1 | 2 |" } }]);
  assert.equal(box.value, "", "the DOM box is left to Web Chat");
});
