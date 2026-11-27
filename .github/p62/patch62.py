import io

def rd(p):
    return io.open(p, encoding='utf-8').read()

def wr(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

def rep(s, old, new, what):
    n = s.count(old)
    assert n == 1, (what, n)
    return s.replace(old, new)

p = 'worker/src/index.js'
s = rd(p)
helper = '''/**
 * A card button click (Adaptive Card Action.Submit) arrives as a user message with no text and a "value" object.
 * Copilot Studio's "Connection Required" card sends {decision: "retry" | "deny", ...}. Without this the transcript
 * showed an empty message. -> "(clicked: Retry)", "(card submitted: {...})" (max 500 chars) or "".
 */
export function clickLabel(a) {
  const v = a && a.value;
  if (!v || typeof v !== "object") return "";
  if (typeof v.decision === "string" && v.decision) return "(clicked: " + v.decision.charAt(0).toUpperCase() + v.decision.slice(1) + ")";
  let j = "";
  try {
    j = JSON.stringify(v);
  } catch (e) {
    j = "";
  }
  if (!j || j === "{}") return "(card submitted)";
  return "(card submitted: " + (j.length > 500 ? j.slice(0, 500) + "..." : j) + ")";
}

export function renderTranscript('''
s = rep(s, 'export function renderTranscript(', helper, 'helper')
s = rep(s, '\n    if (a.text) out.push(a.text, "");\n',
        '\n    if (a.text) out.push(a.text, "");\n    else if (clickLabel(a)) out.push(clickLabel(a), "");\n', 'renderTranscript')
s = rep(s, '\n  if (a.text) out.push(a.text, "");\n',
        '\n  if (a.text) out.push(a.text, "");\n  else if (clickLabel(a)) out.push(clickLabel(a), "");\n', 'messageFile')
wr(p, s)

p = 'worker/test/config53.test.js'
s = rd(p)
wr(p, s.rstrip('\n') + '\n' + rd('.github/p62/tests.js'))
print('patched')
