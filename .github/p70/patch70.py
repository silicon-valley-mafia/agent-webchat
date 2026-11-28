import io, subprocess, glob

def rep(path, old, new):
    s = io.open(path, encoding="utf-8").read()
    assert s.count(old) == 1, (path, old[:60], s.count(old))
    io.open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new))

# Copy / Reuse (#50) copy the raw Markdown typed, not the rendered prompt (#56b)
rep("web/copyprompt.js",
    'function typedText(b) { return api.stripHeader(contentOf(b).innerText || contentOf(b).textContent || ""); }',
    'function typedText(b) {\n'
    '    // #56: gfm.js renders the prompt and keeps the raw text on the bubble\n'
    '    if (typeof b.__awRaw === "string") return api.stripHeader(b.__awRaw);\n'
    '    return api.stripHeader(contentOf(b).innerText || contentOf(b).textContent || "");\n'
    '  }')

rep("web/index.html",
    '  <link rel="stylesheet" href="rail.css" />\n',
    '  <link rel="stylesheet" href="rail.css" />\n  <link rel="stylesheet" href="gfm.css" />\n')
rep("web/index.html",
    '  <script src="markdown.js"></script>\n',
    '  <script src="markdown.js"></script>\n  <script src="gfm.js"></script>\n')

rep("web/group.html",
    '  <link rel="stylesheet" href="group.css" />\n',
    '  <link rel="stylesheet" href="group.css" />\n  <link rel="stylesheet" href="gfm.css" />\n')
rep("web/group.html",
    '  <script src="group.js"></script>\n',
    '  <script src="group.js"></script>\n  <script src="gfm.js"></script>\n')

rep("web/config.js",
    '  timestampMode: "relative",  // "relative" ("5 minutes ago", exact time on hover) or "absolute" (exact time always shown)\n',
    '  timestampMode: "both",      // "both" = "03:05 \u00b7 8 minutes ago" (TODO #57), "relative" = only "5 minutes ago", "absolute" = Web Chat\'s exact time\n'
    '  timeFormat: "",             // "" = browser locale, "24h" or "12h" for the time shown on messages (#57)\n')
rep("web/config.js",
    '  historyFilter: true,        // web/historyfilter.js - filter History by agent (TODO #20)\n',
    '  historyFilter: true,        // web/historyfilter.js - filter History by agent (TODO #20)\n'
    '  gfmMarkdown: true,          // web/gfm.js - GitHub-style Markdown look for replies, prompts and History (TODO #56)\n'
    '  userMarkdown: true,         // web/gfm.js - your prompts rendered as Markdown in a blue theme (false = plain text) (#56b)\n'
    '  agentColors: true,          // web/gfm.css - one background tint per agent column in group chat (#56c)\n'
    '  codeCopyButtons: true,      // web/gfm.js - Copy button on every code block (TODO #58)\n')

# gfm tests run in CI through an existing test file (the CI list in worker.yml stays unchanged)
with io.open("worker/test/rail.test.js", "a", encoding="utf-8", newline="") as f:
    f.write('\n// TODO #56 / #57 / #58 tests live in gfm.test.js; imported here so the CI test list stays unchanged.\nimport "./gfm.test.js";\n')

for js in sorted(glob.glob("web/*.js")):
    subprocess.run(["node", "--check", js], check=True)
ci = "token log features artifact files ui pages voice agents turns stop group agentlogs rail replies owners role preflight repofile route agentuploads config copyprompt config53 save".split()
subprocess.run(["node", "--test"] + ["test/%s.test.js" % t for t in ci], cwd="worker", check=True)
print("patch70 ok")
