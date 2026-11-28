import io, subprocess, glob

def rep(path, old, new):
    s = io.open(path, encoding="utf-8").read()
    assert s.count(old) == 1, (path, old[:70], s.count(old))
    io.open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new))

# Web Chat 4.19 with sendBoxTextWrap (multilineInput: true) renders a <textarea class="webchat__send-box-text-box__html-text-area">;
# ".webchat__send-box-text-box__input" only exists for the single-line box, so Reuse / starters / Hand-off found nothing.
SEL = ('".webchat__send-box-text-box__html-text-area, .webchat__send-box-text-box__input, '
       '.webchat__send-box textarea, .webchat__send-box input[type=\'text\']"')

# ---------- copyprompt.js (#50 Reuse) ----------
p = "web/copyprompt.js"
rep(p, '  var END = "\\n[end of header]";\n',
    '  var END = "\\n[end of header]";\n'
    '  /** Send box: multi-line (multilineInput: true, Web Chat 4.19 textarea) or single-line input. */\n'
    '  var BOX_SEL = ' + SEL + ';\n'
    '  api.BOX_SEL = BOX_SEL;\n')
rep(p, '    var sel = ".webchat__send-box-text-box__input";\n', '    var sel = BOX_SEL;\n')
rep(p, '  function contentOf(b) {',
    '  /** Reuse: the typed text into the open chat\'s send box through Web Chat\'s store (like the File button), else the DOM box. */\n'
    '  api.reuse = function (bubble) {\n'
    '    var text = typedText(bubble), box = sendBox(bubble);\n'
    '    var a = root.__agentWebchat, s = a && a.cur ? a.cur() : null;\n'
    '    if (s && s.store && typeof s.store.dispatch === "function") {\n'
    '      s.store.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: text } });\n'
    '      if (box) setTimeout(function () { try { box.focus(); box.setSelectionRange(text.length, text.length); } catch (e) {} }, 0);\n'
    '      return true;\n'
    '    }\n'
    '    return api.fill(box, text);\n'
    '  };\n\n'
    '  function contentOf(b) {')
rep(p, 'function () { api.fill(sendBox(bubble), typedText(bubble)); }', 'function () { api.reuse(bubble); }')

# ---------- starters.js (#45 starter chips, #47 Hand-off) ----------
p = "web/starters.js"
rep(p, '    var all = root.document.querySelectorAll(".webchat__send-box-text-box__input");\n',
    '    var all = root.document.querySelectorAll(' + SEL + ');\n')
rep(p,
    '    var proto = box.tagName === "TEXTAREA" ? root.HTMLTextAreaElement : root.HTMLInputElement;\n'
    '    var desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value");\n'
    '    if (desc && desc.set) desc.set.call(box, text); else box.value = text;\n'
    '    box.dispatchEvent(new root.Event("input", { bubbles: true }));\n',
    '    var s = cur();\n'
    '    if (s && s.store && typeof s.store.dispatch === "function") {\n'
    '      s.store.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text: text } });\n'
    '    } else {\n'
    '      var proto = box.tagName === "TEXTAREA" ? root.HTMLTextAreaElement : root.HTMLInputElement;\n'
    '      var desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value");\n'
    '      if (desc && desc.set) desc.set.call(box, text); else box.value = text;\n'
    '      box.dispatchEvent(new root.Event("input", { bubbles: true }));\n'
    '    }\n')

# ---------- tests ----------
with io.open("worker/test/copyprompt.test.js", "a", encoding="utf-8", newline="") as f:
    f.write(io.open(".github/p74/test.js", encoding="utf-8").read())

for js in sorted(glob.glob("web/*.js")):
    subprocess.run(["node", "--check", js], check=True)
ci = "token log features artifact files ui pages voice agents turns stop group agentlogs rail replies owners role preflight repofile route agentuploads config copyprompt config53 save".split()
subprocess.run(["node", "--test"] + ["test/%s.test.js" % t for t in ci], cwd="worker", check=True)
print("patch74 ok")
