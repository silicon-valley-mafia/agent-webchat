async function handleTranscript(env, origin, person, body) {
  if (!env.LOG_REPO || !env.LOG_REPO_TOKEN) return json({ error: "logging_disabled" }, 400, origin);
  const m = typeof body.path === "string" ? parseSession(body.path) : null;
  if (!m) return json({ error: "bad_path" }, 400, origin);
  if (!person.admin && m.person !== person.slug) return json({ error: "forbidden" }, 403, origin);
  // TODO #52 part 2: the folder may be in the current logs repo, an older one, or both (a chat continued after a
  // switch). Files are joined by name; the current repo wins for a name found twice. An older repo that can't be
  // read is skipped; the current one must answer (as before).
  const byName = new Map();
  const repos = [env.LOG_REPO].concat(oldLogRepos(env));
  for (let ri = 0; ri < repos.length; ri++) {
    const res = await readSessionFolder(env, body.path, repos[ri]);
    if (res.error && res.error !== "not_found" && ri === 0) return json({ error: res.error }, 502, origin);
    if (res.error) continue;
    for (const f of res.files) if (!byName.has(f.name)) byName.set(f.name, f);
  }
  if (!byName.size) return json({ error: "not_found" }, 404, origin);
  const files = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return json({ markdown: joinSession(files), path: body.path, files: files.length }, 200, origin);
}

