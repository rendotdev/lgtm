---
name: lgtm
description: Open a local LGTM review for code or Markdown, wait for a human decision, then continue the task from that result. Use when the user asks for LGTM, `lgtm review`, PTAL, review, approval, a browser diff, document annotations, or a human checkpoint before completion.
---

# LGTM

LGTM adds a human checkpoint to an agent task. It reviews Git changes, Markdown, or explicit before-and-after content in a local browser. Reviewers can annotate exact lines and return `approved`, `changes_requested`, or `canceled`.

## Open a review

Use the bundled MCP tools when they are available. They wait for the human's decision, return the result directly, and stop the local server when the review reaches a terminal state.

- `open_git_review`
- `open_worktree_review`
- `open_json_review`
- `open_document_review`
- `finish_review`

Choose the tool that matches the source. Open it only after the work is ready and proportionately validated. Do not open another review for the same work while one is active.

LGTM writes local review state and preferences to `.lgtm/`. Ensure the reviewed repository ignores that directory.

When MCP is unavailable, use the CLI. Run `lgtm --help` first, then choose the matching command:

```bash
lgtm review --name "Review current changes"
lgtm review --since-last --name "Review follow-up changes"
lgtm review worktree ../feature-worktree --name "Review feature worktree"
lgtm review document PLAN.md --name "Review implementation plan"
lgtm review json review.json --name "Review generated changes"
```

`--since-last` shows changes since the newest compatible completed Git review that was approved or received changes. It ignores open and canceled reviews.

- `git` reviews staged, unstaged, and untracked text changes in the selected checkout.
- `worktree` reviews changes in the supplied worktree.
- `document` reviews Markdown. Without a path, it reads Markdown from standard input.
- `json` accepts explicit `location`, `oldContent`, and `newContent` fields. Run `lgtm --help` for the full schema.

Add `--cwd <path>` for another workspace and `--json` for machine-readable CLI output.

## Handle the decision

1. Keep the user's goal, constraints, completed work, validation, and remaining steps in context.
2. Open one review and give the user its URL. Wait for **Approve**, **Send comments**, or **Cancel**.
3. Act on the result:
   - `approved`: finish any remaining work. Do not reopen unchanged content.
   - `PTAL: <path>`: read that exact `review.json`, address every actionable comment, validate the revision, and open a new review when approval is still needed.
   - `canceled`: preserve the work and wait if continuing requires approval.

If the automatic result is unavailable, recover it with:

```bash
lgtm review result --review-path <path-to-review.json> --cwd <path>
```

That command leaves an active review running. After `approved`, `changes_requested`, or `canceled`, it stops only that review's server. Do not read an active review's result as part of unrelated development work.
