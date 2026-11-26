# Plan file format (for CONDUCTOR "plan, then delegate")

_Draft from the Coach, 2026-11-27. Location not decided yet — proposed: new **private** repo `silicon-valley-mafia/agent-plans` (preferred: plans are runtime data, agent commits would clutter app history and could trigger `agent-webchat`'s deploy workflows, and access can be scoped). Alternative: `agent-webchat/plans/` with `paths-ignore` on the deploy workflows._

## Layout

```
plans/2026/2026-11-27-01-webchat-ux.md   # one file per plan
plans/INDEX.md                           # one line per plan: id | title | status | path
results/2026-11-27-01/T3.md              # optional, long task outputs
```

## Template

````markdown
---
plan_id: 2026-11-27-01
title: Webchat UX quick wins
created_by: Coach          # who drafted it
requested_by: Deepesh
created: 2026-11-27T05:10+05:30
status: active             # draft | active | done | cancelled
---

## Goal
One or two sentences.

## Tasks
```yaml
- id: T1
  title: Enable Shift+Enter multi-line input (TODO #16)
  owner: GP               # Coach | RFAST | GP | CONDUCTOR | user
  depends_on: []
  inputs: "agent-webchat web/app.js; TODO.md #16"
  expected_output: "PR link + test notes"
  status: todo            # todo | in_progress | done | blocked | needs_user | skipped
  result: ""              # short summary + links/SHAs, or path in results/
  updated: ""
- id: T2
  title: Log the change in internship records
  owner: Coach
  depends_on: [T1]
  inputs: "T1 result"
  expected_output: "commit SHA in the learning-records repo"
  status: todo
  result: ""
  updated: ""
```

## Log
- 2026-11-27 05:10 plan created by Coach via CONDUCTOR
````

## Rules

- Task list is a YAML block so models can parse and edit it reliably.
- **Single writer:** only CONDUCTOR edits the plan file (no SHA conflicts between delegated agents).
- Delegated agents return compact results (~15 lines + links); long outputs go to `results/`.
- Owners `user` / `deepesh` are never delegated — they're listed as to-dos.
- Status flow: `todo` → `in_progress` → `done`, or `blocked` / `needs_user` (with reason) / `skipped`.
