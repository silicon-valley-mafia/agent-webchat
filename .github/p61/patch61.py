import io

def rd(p):
    return io.open(p, encoding='utf-8').read()

def wr(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

def rep(s, old, new, what):
    n = s.count(old)
    assert n == 1, (what, n)
    return s.replace(old, new)

# ---- web/route.js ----
p = 'web/route.js'
s = rd(p)
s = rep(s, ' * - When on, every message you send in that chat carries channelData.awRoute = "coach" (the agent decides what to do;\n *   SPARK forwards it). The page does not forward anything itself and costs no extra request.\n',
        ' * - When on, every message you send in that chat carries channelData.awRoute = "coach" (the agent decides what to do;\n'
        ' *   SPARK forwards it). The page does not forward anything itself and costs no extra request.\n'
        ' * - Fix 2026-11-28 (owner test): a Copilot Studio agent\'s AI never sees channelData (only a topic reading\n'
        ' *   System.Activity.ChannelData can), so SPARK answered "I don\'t see that tag". The message text now also starts\n'
        ' *   with a visible line "[route: coach]" that the agent\'s instructions can act on. routeMarker in config.js:\n'
        ' *   "both" (default: text line + channelData), "text" (same; channelData is always added) or "channelData" (old way).\n', 'doc')
s = rep(s, '''  api.tag = function (activity, route) {
    if (!route || !activity || activity.type !== "message") return activity;
    if (activity.channelData && activity.channelData.awRoute) return activity;
    var out = {};
    for (var k in activity) out[k] = activity[k];
    out.channelData = Object.assign({}, activity.channelData, { awRoute: route });
    return out;
  };''',
'''  api.tag = function (activity, route, mode) {
    if (!route || !activity || activity.type !== "message") return activity;
    if (activity.channelData && activity.channelData.awRoute) return activity;
    var out = {};
    for (var k in activity) out[k] = activity[k];
    out.channelData = Object.assign({}, activity.channelData, { awRoute: route });
    // mode "both" / "text": a visible first line the agent's AI can read (it never sees channelData)
    if (mode === "both" || mode === "text") out.text = "[route: " + route + "]" + (activity.text ? "\\n" + activity.text : "");
    return out;
  };''', 'tag')
s = rep(s, 'var a2 = api.tag(action.payload.activity, route);', 'var a2 = api.tag(action.payload.activity, route, cfg.routeMarker || "both");', 'call')
wr(p, s)

# ---- web/copyprompt.js ----
p = 'web/copyprompt.js'
s = rd(p)
s = rep(s, '  api.stripHeader = function (text) {\n', '  function stripHeader0(text) {\n', 'strip0')
s = rep(s, '  };\n\n  function legacyCopy', '  }\n  /** ...and a #37b "[route: coach]" line, so Copy / Reuse give back only what you typed. */\n'
        '  api.stripHeader = function (text) { return stripHeader0(text).replace(/^\\[route: [A-Za-z0-9_-]+\\]\\n?/, "").trim(); };\n\n  function legacyCopy', 'strip')
wr(p, s)

# ---- web/config.js ----
p = 'web/config.js'
s = rd(p)
old = [l for l in s.split('\n') if l.strip().startswith('routeToggle:')]
assert len(old) == 1, old
s = rep(s, old[0] + '\n', old[0] + '\n  routeMarker: "both",        // "both" = visible "[route: coach]" first line + channelData (the agent\'s AI only sees text); "channelData" = old way\n', 'config')
wr(p, s)

# ---- tests ----
p = 'worker/test/route.test.js'
s = rd(p)
wr(p, s.rstrip('\n') + '\n' + rd('.github/p61/tests.js'))
print('patched')
