async function handleHistory(env, origin, person) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ items: [], reason: "logging_disabled" }, 200, origin);
  // TODO #52 part 2: the current logs repo first, then each older one (LOG_REPOS_OLD, read only). A session folder
  // found in both (a chat continued after a switch) is listed once and each message file is counted once.
  const repos = [env.LOG_REPO].concat(oldLogRepos(env));
  const sessions = new Map();
  const sortKey = new Map();
  const seen = new Set();
  let read = false;
  let truncated = false;
  for (let ri = 0; ri < repos.length; ri++) {
    const url =
      "https://api.github.com/repos/" + repos[ri] + "/git/trees/" + encodeURIComponent(env.LOG_BRANCH || "main") + "?recursive=1";
    let r;
    try {
      r = await fetch(url, { headers: ghHeaders(env) });
    } catch (e) {
      if (ri === 0) throw e;
      continue;
    }
    if (r.status === 404 || r.status === 409) continue; // empty repo
    if (!r.ok) {
      if (ri === 0) return json({ error: "github_read_" + r.status }, 502, origin);
      continue; // an older repo the token can't read is skipped; the current one still lists
    }
    const tree = await r.json();
    read = true;
    if (tree.truncated) truncated = true;
    for (const t of tree.tree || []) {
      if (t.type !== "blob") continue;
      const slash = t.path.lastIndexOf("/");
      const folder = t.path.slice(0, slash);
      const m = parseSession(folder);
      if (!m || !/^\d{4}-.*\.md$/.test(t.path.slice(slash + 1))) continue;
      if (!person.admin && m.person !== person.slug) continue;
      let s = sessions.get(folder);
      if (!s) {
        s = { path: folder, date: m.date, time: m.hm.slice(0, 2) + ":" + m.hm.slice(2), person: m.person, messages: 0 };
        if (m.num) s.agent = m.num;
        if (ri > 0) s.repo = repos[ri]; // only in an older logs repo
        sessions.set(folder, s);
        sortKey.set(folder, m.date + m.hm + "-" + m.person + "--" + m.conv);
      }
      if (seen.has(t.path)) continue;
      seen.add(t.path);
      if (!t.path.endsWith("/0000-session.md")) s.messages++;
    }
  }
  if (!read) return json({ items: [] }, 200, origin);
  // Newest first by date/time, across the old flat folders and the per-agent ones.
  const items = [...sessions.values()].sort((a, b) => {
    const x = sortKey.get(a.path), y = sortKey.get(b.path);
    return x < y ? 1 : x > y ? -1 : a.path < b.path ? 1 : a.path > b.path ? -1 : 0;
  });
  return json({ items: items.slice(0, 300), truncated: truncated || items.length > 300 }, 200, origin);
}

