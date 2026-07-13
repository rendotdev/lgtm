#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  collectGitReviewFiles,
  finishReview,
  openReview,
  serveReviewApp,
  stopReviews,
} from "../../platform/review/review-platform.ts";
import type { ReviewPointer } from "../../domain/review/review.ts";
import {
  agentInstallPlanner,
  agentUpdatePlanner,
  isAgentInstallTarget,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../../domain/install/agent-install.ts";
import { agentInstaller, agentUpdater } from "../../platform/install/agent-install-platform.ts";
import { cliUpdater, type CliUpdateResult } from "../../platform/install/cli-update-platform.ts";
import { runMcpServer } from "../mcp/mcp.ts";
import { jsonReviewInputParser } from "./json-review-input.ts";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const helpRequested = args.includes("--help") || args.includes("-h");
const command = helpRequested
  ? "help"
  : args[0] && !args[0].startsWith("--")
    ? (args.shift() as string)
    : "git";
const jsonOutput = takeFlag("--json");
const cwd = resolve(takeOption("--cwd") ?? process.cwd());
const cancellation = new AbortController();
let cancelling = false;

async function cancel() {
  if (cancelling) return;
  cancelling = true;
  cancellation.abort();
  await stopReviews(cwd).catch(() => false);
}

process.once("SIGINT", () => {
  void cancel().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void cancel().finally(() => process.exit(143));
});

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
    signal: cancellation.signal,
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
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(path: string | undefined) {
  return path ? await readFile(resolve(cwd, path), "utf8") : await readStdin();
}

function printHelp() {
  console.log(`LGTM, human approval for agent work

Usage:
  lgtm [--name <name>] [--cwd <path>] [--json]
  lgtm git [--name <name>] [--cwd <path>] [--json]
  lgtm worktree <path> [--name <name>] [--cwd <path>] [--json]
  lgtm json [review.json] [--name <name>] [--cwd <path>] [--json]
  lgtm document [markdown-file] [--name <name>] [--cwd <path>] [--json]
  lgtm finish [--cwd <path>] [--json]
  lgtm mcp
  lgtm setup [--target <all|pi|claude|codex>] [--dry-run] [--json]
  lgtm update [--target <all|pi|claude|codex>] [--dry-run] [--json]

JSON review schema:
  {
    "name": "Review name",
    "files": [
      { "location": "file.ts", "oldContent": "before", "newContent": "after" }
    ]
  }

Bare lgtm reviews the current Git changes. Document Markdown and review JSON are read from stdin when no file is supplied.`);
}

function printIntegrationResult(params: {
  action: "setup" | "update";
  target: AgentInstallTarget;
  steps: AgentInstallStep[];
  skippedTargets?: Exclude<AgentInstallTarget, "all">[];
  cli?: CliUpdateResult;
}) {
  if (jsonOutput) {
    console.log(JSON.stringify(params, null, 2));
    return;
  }
  if (params.cli?.status === "updated") console.log("Updated the LGTM CLI.");
  if (params.cli?.status === "skipped") console.log(`Skipped CLI update: ${params.cli.reason}`);
  console.log(
    `${params.action === "setup" ? "Set up" : "Updated"} LGTM integrations for ${params.target}. Start a new agent session to load the plugin and skill.`,
  );
  if (params.skippedTargets?.length) {
    console.log(`Skipped uninstalled integrations: ${params.skippedTargets.join(", ")}.`);
  }
}

async function main() {
  if (command === "mcp") {
    await runMcpServer();
    return;
  }

  if (command === "serve") {
    const appDir = takeOption("--app-dir");
    if (!appDir) throw new Error("serve requires --app-dir.");
    await serveReviewApp(appDir);
    return;
  }

  if (command === "setup" || command === "install") {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("setup --target must be one of: all, pi, claude, codex.");
    }
    const plan = agentInstallPlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      printIntegrationResult({ action: "setup", target, steps: plan });
      return;
    }
    printIntegrationResult({
      action: "setup",
      target,
      steps: await agentInstaller.install({ target }),
    });
    return;
  }

  if (command === "update") {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("update --target must be one of: all, pi, claude, codex.");
    }
    const plan = agentUpdatePlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      printIntegrationResult({ action: "update", target, steps: plan, cli: cliUpdater.plan() });
      return;
    }
    printIntegrationResult({
      action: "update",
      target,
      cli: await cliUpdater.update(),
      ...(await agentUpdater.update({ target })),
    });
    return;
  }

  if (command === "help") {
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

  if (command === "json" || command === "custom") {
    const positionalInput = args[0]?.startsWith("--") ? undefined : args.shift();
    const inputPath = takeOption("--input") ?? positionalInput;
    const input = jsonReviewInputParser.parse({
      value: JSON.parse(await readInput(inputPath)) as unknown,
    });
    const name = takeOption("--name") ?? input.name ?? "JSON review";
    printPointer(await openReview({ kind: "diff", name, files: input.files }, reviewOptions()));
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
    const result = await finishReview(cwd);
    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    else if (!result.found) console.log("No LGTM review found.");
    else
      console.log(
        `${result.formattedReview}\n\nServer stopped: ${result.stoppedServer ? "yes" : "no"}`,
      );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
