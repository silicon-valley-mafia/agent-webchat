# UI templates (not published)

Preview pages tried on 2026-11-27 (PR #14) and kept here for later. Only `web/` is deployed to GitHub Pages,
so nothing in this folder is live. To try one again, copy its folder back to `web/<name>/` (the pages load
`../config.js` and, for v2, `../app.js` etc. from the main page).

| Folder | What | Result of the owner's test (2026-11-27 15:09 IST) |
|---|---|---|
| `v2-fluent-copilot/` | Main page code unchanged + Microsoft's official Fluent theme (Copilot variant) via Web Chat 4.19.2 ES modules from jsDelivr (`?variant=fluent` for plain Fluent) | tried; owner chose to stay on v1 for now |
| `v3-deepchat/` | Deep Chat 2.4.2 web component; Direct Line REST + polling; text only; refresh re-uses the original token; "working" ends on the final reply (`inputHint`) | **broken** in the owner's test (not investigated) |

Useful pieces to reuse in the main page: v3's token re-use on refresh (MCS-4041 fix idea) and its `inputHint` / `from.role` handling
(final reply vs progress notes). Research notes: `agent-webchat-logs/handoff/notes/2026-11-27-copilot-api-options.md`.
