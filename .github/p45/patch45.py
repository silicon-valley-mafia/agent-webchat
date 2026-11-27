import io, shutil

D = '.github/p45/'

def rd(p):
    return io.open(p, encoding='utf-8').read()

def wr(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

def rep(s, old, new, what):
    n = s.count(old)
    assert n == 1, (what, n)
    return s.replace(old, new)

# ---- new page files ----
for f in ['starters.js', 'planboard.js', 'historyfilter.js']:
    shutil.copyfile(D + f, 'web/' + f)

# ---- worker/src/config.js ----
p = 'worker/src/config.js'
s = rd(p)
s = rep(s, '    if (Array.isArray(v.routes)) a.routes = v.routes.map(String).slice(0, 5);\n',
        '    if (Array.isArray(v.routes)) a.routes = v.routes.map(String).slice(0, 5);\n'
        '    // TODO #45 / #46: starter prompt chips on an empty chat (up to 6), plan board in this agent\'s chats\n'
        '    if (Array.isArray(v.starters)) a.starters = v.starters.filter((x) => typeof x === "string" && x.trim() && x.length <= 300).map((x) => x.trim()).slice(0, 6);\n'
        '    if (typeof v.plans === "boolean") a.plans = v.plans;\n', 'normAgents')
s = rep(s, '{"name","description","initials","num","routes","secretName"}', '{"name","description","initials","num","routes","secretName","starters","plans"}', 'config doc')
wr(p, s)

# ---- worker/src/main.js ----
p = 'worker/src/main.js'
s = rd(p)
s = rep(s, 'typeof v.secretName === "string" ? secretValue(env, v.secretName) : "";',
        'typeof v.secretName === "string" ? secretValue(env, v.secretName) : id === defId ? env.DIRECTLINE_SECRET || "" : "";', 'default secret')
s = rep(s, '      name: String(v.name || id).slice(0, 60),\n',
        '      name: String(v.name || (id === defId && env.DEFAULT_AGENT_NAME) || id).slice(0, 60),\n', 'default name')
s = rep(s, '      initials: String(v.initials || "").slice(0, 3),\n',
        '      initials: String(v.initials || (id === defId && env.DEFAULT_AGENT_INITIALS) || "").slice(0, 3),\n', 'default initials')
s = rep(s, '      routes: Array.isArray(v.routes) ? v.routes.map(String).filter((r) => AGENT_ID_RE.test(r)).slice(0, 5) : [],\n',
        '      routes: Array.isArray(v.routes) ? v.routes.map(String).filter((r) => AGENT_ID_RE.test(r)).slice(0, 5) : [],\n'
        '      // TODO #45 / #46: starter prompt chips on an empty chat; plan board in this agent\'s chats\n'
        '      starters: Array.isArray(v.starters) ? v.starters.filter((x) => typeof x === "string" && x.trim() && x.length <= 300).map((x) => x.trim()).slice(0, 6) : [],\n'
        '      plans: v.plans === true,\n', 'registry fields')
s = rep(s, '  if (a.routes && a.routes.length) p.routes = a.routes.slice(); // only agents that have routes (TODO #37b)\n',
        '  if (a.routes && a.routes.length) p.routes = a.routes.slice(); // only agents that have routes (TODO #37b)\n'
        '  if (a.starters && a.starters.length) p.starters = a.starters.slice(); // TODO #45\n'
        '  if (a.plans) p.plans = true; // TODO #46\n', 'publicAgent')
s = rep(s, 'return json({ agents: allowed.map(publicAgent), default: d.agent ? d.agent.id : null, person: person.name }, 200, origin);',
        '// nums: folder number per agent (logs/<N>/), for the History filter (TODO #20)\n'
        '  return json({ agents: allowed.map(publicAgent), default: d.agent ? d.agent.id : null, person: person.name,\n'
        '    nums: Object.fromEntries(allowed.map((a) => [a.id, a.num])) }, 200, origin);', 'handleAgents')
wr(p, s)

# ---- web/agents.js ----
p = 'web/agents.js'
s = rd(p)
s = rep(s, '        st.agents = j.agents;\n', '        st.agents = j.agents;\n        st.nums = j.nums || {}; // TODO #20: folder number per agent (History filter)\n', 'agents nums')
s = rep(s, 'return { enabled: st.enabled, agents: st.agents, current: st.current, selected: ls(K.sel) };',
        'return { enabled: st.enabled, agents: st.agents, current: st.current, selected: ls(K.sel), nums: st.nums || {} };', 'agents state')
wr(p, s)

# ---- web/app.js ----
p = 'web/app.js'
s = rd(p)
s = rep(s, '        var label = document.createElement("span");\n        label.textContent = item.time + (current',
        '        row.setAttribute("data-agent", String(item.agent || 1)); // TODO #20: web/historyfilter.js\n'
        '        var label = document.createElement("span");\n        label.textContent = item.time + (current', 'app row')
wr(p, s)

# ---- web/index.html ----
p = 'web/index.html'
s = rd(p)
s = rep(s, '  <script src="copyprompt.js"></script>\n',
        '  <script src="copyprompt.js"></script>\n  <script src="starters.js"></script>\n  <script src="planboard.js"></script>\n  <script src="historyfilter.js"></script>\n', 'index')
wr(p, s)

# ---- web/config.js ----
p = 'web/config.js'
s = rd(p)
s = rep(s, '  copyPrompt: true,           // web/copyprompt.js - Copy / Reuse under the messages you send (TODO #50)\n',
        '  copyPrompt: true,           // web/copyprompt.js - Copy / Reuse under the messages you send (TODO #50)\n'
        '  starterPrompts: true,       // web/starters.js - prompt chips on an empty chat, for agents with "starters" (TODO #45)\n'
        '  handoffButton: true,        // web/starters.js - \U0001F4DD Hand-off button: asks the agent to write its hand-off file (TODO #47)\n'
        '  handoffText: "End of session. Write the hand-off file now.",\n'
        '  planBoard: true,            // web/planboard.js - task table + "Run next task" for YAML plans in replies (TODO #46)\n'
        '  planBoardAgents: ["conductor"], // agents with the plan board (the Worker can also mark one with "plans": true)\n'
        '  historyFilter: true,        // web/historyfilter.js - filter History by agent (TODO #20)\n', 'web config')
wr(p, s)

# ---- tests ----
p = 'worker/test/config53.test.js'
s = rd(p)
wr(p, s.rstrip('\n') + '\n' + rd(D + 'tests.js'))
print('patched')
