import io, os, subprocess, glob, tarfile, hashlib, json

def rep(path, old, new):
    s = io.open(path, encoding="utf-8").read()
    assert s.count(old) == 1, (path, old[:60], s.count(old))
    io.open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new))

# 1. vendor highlight.js 11 (BSD-3-Clause) from npm: common languages + the ones this project needs
os.makedirs("/tmp/hl", exist_ok=True)
out = subprocess.run(["npm", "pack", "@highlightjs/cdn-assets@^11", "--json", "--pack-destination", "/tmp/hl"],
                     check=True, capture_output=True, text=True).stdout
info = json.loads(out)[0]
version = info["version"]
tar = tarfile.open(os.path.join("/tmp/hl", info["filename"]))
def member(name):
    return tar.extractfile("package/" + name).read().decode("utf-8")
extra = ["verilog", "vhdl", "tcl", "powershell", "dockerfile", "matlab", "latex", "x86asm", "armasm", "protobuf", "nginx"]
parts = ["/* agent-webchat vendored copy: @highlightjs/cdn-assets " + version + " (npm), highlight.min.js + " +
         ", ".join(extra) + ". BSD-3-Clause, see highlight.LICENSE.txt. Used by web/gfm.js (TODO #56). */",
         member("highlight.min.js")]
for lang in extra:
    parts.append(member("languages/%s.min.js" % lang))
os.makedirs("web/vendor", exist_ok=True)
js = "\n".join(parts) + "\n"
io.open("web/vendor/highlight.min.js", "w", encoding="utf-8", newline="").write(js)
io.open("web/vendor/highlight.LICENSE.txt", "w", encoding="utf-8", newline="").write(member("LICENSE"))
print("highlight.js", version, len(js.encode("utf-8")), "bytes, sha256", hashlib.sha256(js.encode("utf-8")).hexdigest())
io.open("/tmp/hl/version.txt", "w").write(version)

# 2. timestamps: prompts are matched by their raw text (gfm.js keeps it on the bubble)
rep("web/timestamps.js",
    '      var a = match(acts, c.innerText || c.textContent, b.classList.contains("webchat__bubble--from-user"), used);\n',
    '      // #56: a prompt rendered by gfm.js keeps its raw text on the bubble (the folded header changes the visible text)\n'
    '      var shown = typeof b.__awRaw === "string" ? b.__awRaw : (c.innerText || c.textContent);\n'
    '      var a = match(acts, shown, b.classList.contains("webchat__bubble--from-user"), used);\n')

# 3. css: blue only on the part holding the rendered prompt (fixes the empty boxes) + alerts, task lists, code colours
rep("web/gfm.css",
    'html.aw-usermd:not([data-skin="contrast"]) .webchat__bubble--from-user .webchat__bubble__content {\n',
    '/* only the part that holds the rendered prompt (empty parts of the bubble stay unstyled) */\n'
    'html.aw-usermd:not([data-skin="contrast"]) .webchat__bubble--from-user .webchat__bubble__content:has(> .aw-prompt) {\n')
extra_css = io.open(".github/p71/extra.css", encoding="utf-8").read()
rep("web/gfm.css", "/* ---------- #58 copy button on code blocks ---------- */\n",
    extra_css + "\n/* ---------- #58 copy button on code blocks ---------- */\n")

# 4. config switch
rep("web/config.js",
    '  codeCopyButtons: true,      // web/gfm.js - Copy button on every code block (TODO #58)\n',
    '  codeCopyButtons: true,      // web/gfm.js - Copy button on every code block (TODO #58)\n'
    '  codeHighlight: true,        // web/gfm.js - GitHub colours for code with a language (web/vendor/highlight.min.js, loaded on first use)\n')

# 5. checks
for f in sorted(glob.glob("web/*.js")):
    subprocess.run(["node", "--check", f], check=True)
ci = "token log features artifact files ui pages voice agents turns stop group agentlogs rail replies owners role preflight repofile route agentuploads config copyprompt config53 save".split()
subprocess.run(["node", "--test"] + ["test/%s.test.js" % t for t in ci], cwd="worker", check=True)
print("patch71 ok")
