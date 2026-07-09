#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  collectGitReviewFiles,
  finishReview,
  openReview,
  stopReviews,
  type DiffReviewFileInput,
  type ReviewPointer,
} from "./core.ts";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";
const jsonOutput = takeFlag("--json");
const cwd = resolve(takeOption("--cwd") ?? process.cwd());

function takeFlag(flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(option: string) {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  args.splice(index, 2);
  return value;
}

function reviewOptions() {
  return {
    cwd,
    onUpdate: jsonOutput ? undefined : (message: string) => console.error(message),
  };
}

function printPointer(pointer: ReviewPointer) {
  if (jsonOutput) {
    console.log(JSON.stringify(pointer, null, 2));
    return;
  }
  console.log(`LGTM review opened: ${pointer.name}`);
  console.log(`URL: ${pointer.url}`);
  console.log(`Review JSON: ${pointer.reviewPath}`);
}

async function readStdin() {
  return await Bun.stdin.text();
}

async function readInput(path: string | undefined) {
  return path ? await readFile(resolve(cwd, path), "utf8") : await readStdin();
}

function assertFiles(value: unknown): asserts value is DiffReviewFileInput[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Custom review input requires a non-empty files array.");
  for (const file of value) {
    if (!file || typeof file !== "object")
      throw new Error("Every custom review file must be an object.");
    const candidate = file as Record<string, unknown>;
    if (
      typeof candidate.location !== "string" ||
      typeof candidate.oldContent !== "string" ||
      typeof candidate.newContent !== "string"
    ) {
      throw new Error(
        "Every custom review file requires location, oldContent, and newContent strings.",
      );
    }
  }
}

function printHelp() {
  console.log(`LGTM, human approval for agent work

Usage:
  lgtm git [--name <name>] [--cwd <path>] [--json]
  lgtm worktree <path> [--name <name>] [--cwd <path>] [--json]
  lgtm custom [--input <review.json>] [--name <name>] [--cwd <path>] [--json]
  lgtm document [markdown-file] [--name <name>] [--cwd <path>] [--json]
  lgtm finish [--cwd <path>] [--json]
  lgtm stop [--cwd <path>] [--json]

Custom input:
  { "name": "Review name", "files": [{ "location": "file.ts", "oldContent": "", "newContent": "" }] }

Document Markdown and custom JSON are read from stdin when no file is supplied.`);
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "git") {
    const name = takeOption("--name") ?? "Git review";
    const files = await collectGitReviewFiles(cwd);
    printPointer(await openReview({ kind: "diff", name, files }, reviewOptions()));
    return;
  }

  if (command === "worktree") {
    const worktree = args.shift();
    if (!worktree) throw new Error("worktree requires a path.");
    const name = takeOption("--name") ?? "Worktree review";
    const files = await collectGitReviewFiles(resolve(cwd, worktree));
    printPointer(await openReview({ kind: "diff", name, files }, reviewOptions()));
    return;
  }

  if (command === "custom") {
    const inputPath = takeOption("--input");
    const parsed = JSON.parse(await readInput(inputPath)) as
      | { name?: unknown; files?: unknown }
      | unknown[];
    const files = Array.isArray(parsed) ? parsed : parsed.files;
    assertFiles(files);
    const inputName = Array.isArray(parsed) ? undefined : parsed.name;
    const name =
      takeOption("--name") ?? (typeof inputName === "string" ? inputName : "Custom review");
    printPointer(await openReview({ kind: "diff", name, files }, reviewOptions()));
    return;
  }

  if (command === "document") {
    const documentPath = args[0]?.startsWith("--") ? undefined : args.shift();
    const markdown = await readInput(documentPath);
    if (!markdown.trim()) throw new Error("Document review requires Markdown input.");
    const name =
      takeOption("--name") ?? (documentPath ? `Review ${documentPath}` : "Document review");
    printPointer(
      await openReview(
        {
          kind: "document",
          name,
          document: { markdown, location: documentPath },
        },
        reviewOptions(),
      ),
    );
    return;
  }

  if (command === "finish") {
    const result = await finishReview(cwd);
    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    else if (!result.found) console.log("No LGTM review found.");
    else
      console.log(
        `${result.formattedReview}\n\nServer stopped: ${result.stoppedServer ? "yes" : "no"}`,
      );
    return;
  }

  if (command === "stop") {
    const stopped = await stopReviews(cwd);
    if (jsonOutput) console.log(JSON.stringify({ stopped }));
    else
      console.log(
        stopped ? "Stopped the LGTM review server." : "No running LGTM review server found.",
      );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
