
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
