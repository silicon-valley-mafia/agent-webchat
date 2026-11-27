# One-shot (TODO #55): two small edits in web/app.js and the new tests appended to worker/test/turns.test.js.
# Every target must occur exactly once, otherwise nothing is written.
import os, sys

A = "web/app.js"
t = open(A, encoding="utf-8").read()
R = [
    (
        '''  function agentTyping(s) {
    if (!s.pendingSince || !s.replyTimer) return; // only after a first reply of this turn
''',
        '''  function agentTyping(s, kind) {
    if (kind === "interim" && s.pendingSince) s.lastKind = "interim"; // #55: informative / streaming typing note
    if (!s.pendingSince || !s.replyTimer) return; // only after a first reply of this turn
''',
    ),
    (
        '''        if (a.type === "typing" && !mine(s, a)) { agentTyping(s); return; }
''',
        '''        if (a.type === "typing" && !mine(s, a)) { agentTyping(s, turnKind(s, a)); return; }
        if (a.type === "endOfConversation" && !mine(s, a)) { if (s.pendingSince && turnKind(s, a) === "end") markReplied(s); return; } // #55
''',
    ),
]
for old, new in R:
    n = t.count(old)
    if n != 1:
        print("app.js target found %d times: %r" % (n, old[:70]))
        sys.exit(1)
for old, new in R:
    t = t.replace(old, new)
open(A, "w", encoding="utf-8", newline="").write(t)

P = "worker/test/turns55.part.js"
T = "worker/test/turns.test.js"
part = open(P, encoding="utf-8").read()
base = open(T, encoding="utf-8").read()
if "#55 bug fix" not in base:
    open(T, "w", encoding="utf-8", newline="").write(base + part)
os.remove(P)
print("patched app.js, appended #55 tests")
