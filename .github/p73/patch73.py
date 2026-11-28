import io, subprocess, glob

p = "web/gfm.js"
s = io.open(p, encoding="utf-8").read()
mark = "  /* ---------- DOM pass ---------- */\n"
assert s.count(mark) == 1
s = s[:s.index(mark)] + io.open(".github/p73/dompass.js", encoding="utf-8").read()
io.open(p, "w", encoding="utf-8", newline="").write(s)

t = "worker/test/gfm.test.js"
s = io.open(t, encoding="utf-8").read()
anchor = 'test("#57 match: an attachment-only'
assert s.count(anchor) == 1
s = s.replace(anchor, io.open(".github/p73/test.js", encoding="utf-8").read() + anchor)
io.open(t, "w", encoding="utf-8", newline="").write(s)

for f in sorted(glob.glob("web/*.js")):
    subprocess.run(["node", "--check", f], check=True)
ci = "token log features artifact files ui pages voice agents turns stop group agentlogs rail replies owners role preflight repofile route agentuploads config copyprompt config53 save".split()
subprocess.run(["node", "--test"] + ["test/%s.test.js" % x for x in ci], cwd="worker", check=True)
print("patch73 ok")
