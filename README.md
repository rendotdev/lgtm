# LGTM

LGTM is a Bun CLI for putting a human approval step into agent workflows. It opens code diffs and Markdown documents in a local browser review, then returns either review comments or an explicit LGTM approval.

## CLI

Bun is required at runtime.

```bash
bunx @rendotdev/lgtm git
```

The package also works through `npx` when Bun is installed because the `lgtm` executable uses a Bun shebang:

```bash
npx @rendotdev/lgtm git
```

Available commands:

```bash
lgtm git
lgtm worktree ../feature-worktree
lgtm custom --input review.json
lgtm document PLAN.md
lgtm document --name "Implementation plan" < PLAN.md
lgtm finish
lgtm stop
```

Add `--json` for machine-readable command output and `--cwd <path>` to choose the review workspace.

Custom reviews accept this JSON shape through `--input` or stdin:

```json
{
  "name": "Authentication changes",
  "files": [
    {
      "location": "src/auth.ts",
      "oldContent": "export const enabled = false;\n",
      "newContent": "export const enabled = true;\n"
    }
  ]
}
```

Every review opens in the browser. **Send comments** completes it with `changes_requested`; **LGTM** completes it with `approved`. Both actions save the review and stop the local server.

## Pi integration

Install the package in Pi:

```bash
pi install git:github.com/rendotdev/lgtm
```

The Pi extension registers:

- `lgtm-open-git-review`
- `lgtm-open-worktree-review`
- `lgtm-open-custom-review`
- `lgtm-open-document-review`
- `lgtm-finish-review`

Load a local checkout directly with:

```bash
pi -e /absolute/path/to/lgtm/extensions/lgtm.ts
```

The CLI core is independent of Pi so future Codex and Claude integrations can use the same review files, server lifecycle, and approval model.
