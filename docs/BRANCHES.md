# Branches

_Last checked: 2026-11-27 23:10 IST. **Proposed scope, waiting for the owner's OK**: state of `dev` / `main`, PR rules, deploy flow, branches to delete._

## 1. State

| Branch | Head | What it is |
|---|---|---|
| `main` | docs-only commits on top of PR #17 | **Live.** GitHub Pages deploys `web/` on every push to `main` that touches `web/**`; the Worker deploys on pushes that touch `worker/**`. |
| `dev` | `e925ec4` (PR #29) | Next batch: PRs #18–#29 (#42 turn end, #4 Stop + Web Chat 4.19.2, #43 group chat, #44 log folders, #23/#36 Chats sidebar, Batch A #23–#29). **Not live.** |

`agent-webchat-logs` and `agent-webchat-artifcats-1` only have `main`.

## 2. PR rules

1. **Feature and fix PRs go into `dev`**, never straight into `main`. One PR per item, squash-merged after CI (`test` + `check`) passes.
2. **Docs-only changes may go straight to `main`** (they don't deploy anything). When a docs file also changes on `dev`, keep both copies identical so the deploy merge has no conflict.
3. Every PR: the matching TODO line updated in the same PR, an off switch for new features, nothing private (codes, secrets, private repo names, conversation contents).
4. No force-push. No direct push of code to `main`.

## 3. Deploy flow (only after the owner says "deploy now")

1. Owner adds any new repo secrets the batch needs (see the batch report, e.g. [BATCH-A-REPORT.md](BATCH-A-REPORT.md) §5).
2. **Merge `main` → `dev`** (brings the docs-only commits into `dev`; CI runs on `dev`).
3. **One PR `dev` → `main`** for the whole batch, merged with a **merge commit** (not squash), so `dev` and `main` share history afterwards.
4. That push deploys Pages and the Worker once. Check **Actions** for both runs and the Worker status step.
5. Owner checks from the batch report; then mark the TODO lines ✅ **Done**.

## 4. Branches to delete

**Yes** = the PR is merged and the branch tip is exactly the merged PR head, so nothing on it is missing from the PR's base. The branches listed here on 2026-11-27 09:15 IST are already deleted.

### Merged into `main`: yes, delete any time

| Branch | PR |
|---|---|
| `fix/voice-dictation-diagnostics` | #13 |
| `preview/v2-fluent-v3-deepchat` | #14 |
| `chore/remove-previews-keep-templates` | #15 |
| `fix/notice-buttons-pileup` | #16 |
| `feat/multi-agent` | #17 |

### Merged into `dev`: yes (suggest deleting after the batch is deployed)

| Branch | PR |
|---|---|
| `feat/turn-end-42` | #18 |
| `feat/stop-and-pin-webchat` | #19 |
| `feat/group-chat-43` | #20 |
| `feat/agent-log-folders-44` | #21 |
| `feat/session-rail-23-36` | #22 |
| `refactor/split-app-replies` | #23 |
| `feat/ownership-49` | #24 |
| `feat/role-7` | #25 |
| `fix/agents-preflight` | #26 |
| `feat/insert-file-37a` | #27 |
| `feat/route-toggle-37b` | #28 |
| `feat/upload-agent-folders-20` | #29 |

### Keep

| Branch |
|---|
| `main` |
| `dev` |
