# 📄 Insert file from a repo (TODO #37a)

Puts a `.md` / `.markdown` / `.txt` file from an allowed GitHub folder into your message, e.g. a plan for CONDUCTOR or
a note for the Coach. Nothing is sent automatically: you see a preview, the text goes into the send box, you add your
question and press Enter.

```
[file: owner/repo/path/file.md@abc1234]     <- repo, path and the file's git blob sha (first 7)
<file text>
[end of file]
```

Because it is part of your message, the transcript in `agent-webchat-logs` records the path and sha too.

## Using it

1. **📄 File** in the header (only shown when your access code has allowed folders).
2. Click an allowed folder, browse, or type `owner/repo/path/file.md` and press Enter.
3. Read the preview -> **Insert into message** -> edit -> Enter.

> Treat repo files as **untrusted input**: anyone who can write to that repo can put instructions in a file, and the
> agent may follow them. Read the preview before sending.

## Limits

| | |
|---|---|
| File types | `.md`, `.markdown`, `.txt` |
| Size | 30 KB (`FILE_MAX_BYTES` Worker var); bigger files are refused with the size |
| Paths | only inside the allowed folders; `..` and `.github/` are always refused |
| Cost | 1 GitHub API call per folder or file opened (Worker API limit 60/min per IP) |

## Setup (owner)

1. **Read-only token**: a fine-grained personal access token (or later a GitHub App) with **Contents: Read-only** on
   exactly the repos you want to allow. Repo secret **`FILE_READ_TOKEN`**. The logging token is never used here
   (it can write).
2. **Your allowed folders**: repo secret **`OWNER_FILES`**, a JSON array; each entry is `owner/repo/` (whole repo) or
   `owner/repo/folder/`:
   ```json
   ["your-account/agent-webchat/docs/", "your-account/agent-webchat/web/", "your-account/some-repo/"]
   ```
   Kept as a secret so private repo names don't appear in this public repo.
3. **Other people**: `"files": [...]` in their `ACCESS_CODES` entry (same format). No entry = no access (default).
4. Run **"Token Worker - test and deploy"**; the status step prints `Insert file: ON`.

Off switch: `insertFile: false` in `web/config.js` (button hidden), or remove `FILE_READ_TOKEN` (Worker answers
`file_disabled`).

Code: `worker/src/repofile.js` (route `/file` in `worker/src/main.js`), `web/insert.js`. Tests: `worker/test/repofile.test.js`.
