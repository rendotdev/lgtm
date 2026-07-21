import { spawn } from "node:child_process";
import { build } from "../../../builder.ts";
import {
  AgentInstallSingleton,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../install.ts";

export type AgentUpdateResult = {
  steps: AgentInstallStep[];
  skippedTargets: Exclude<AgentInstallTarget, "all">[];
  integrations: {
    target: Exclude<AgentInstallTarget, "all">;
    steps: AgentInstallStep[];
    outputs: string[];
  }[];
};

export type AgentUpdateEvent =
  | { phase: "started"; target: Exclude<AgentInstallTarget, "all"> }
  | {
      phase: "completed";
      target: Exclude<AgentInstallTarget, "all">;
      steps: AgentInstallStep[];
      outputs: string[];
    };

export const { AgentInstallCommandService, AgentInstallCommandServiceBuilder } = build().service(
  "AgentInstallCommandService",
  {
    config: {},
    deps: { spawn },
    build({ deps }) {
      async function execute(params: { command: string; args: string[] }): Promise<string> {
        return await new Promise<string>(function runCommand(resolvePromise, reject) {
          const child = deps.spawn(params.command, params.args, {
            stdio: ["ignore", "pipe", "pipe"],
          });
          const output: Buffer[] = [];
          child.stdout.on("data", function captureStdout(chunk: Buffer | string) {
            output.push(Buffer.from(chunk));
          });
          child.stderr.on("data", function captureStderr(chunk: Buffer | string) {
            output.push(Buffer.from(chunk));
          });
          child.once("error", reject);
          child.once("exit", function handleExit(code, signal) {
            if (code === 0) {
              resolvePromise(Buffer.concat(output).toString("utf8"));
              return;
            }
            const detail = Buffer.concat(output).toString("utf8").trim();
            reject(
              new Error(
                `${params.command} exited with ${signal ?? `code ${code ?? "unknown"}`}.${detail ? `\n${detail}` : ""}`,
              ),
            );
          });
        });
      }

      async function run(params: { command: string; args: string[] }): Promise<string> {
        return await execute(params);
      }

      async function read(params: { command: string; args: string[] }): Promise<string> {
        return await execute(params);
      }

      return { read, run };
    },
  },
);

export const { AgentInstallerService, AgentInstallerServiceBuilder } = build().service(
  "AgentInstallerService",
  {
    config: {},
    deps: {
      runCommand: function runCommand(step: AgentInstallStep) {
        return AgentInstallCommandService.run(step);
      },
    },
    build({ deps }) {
      async function install(params: { target: AgentInstallTarget }): Promise<AgentInstallStep[]> {
        const steps = AgentInstallSingleton.createInstallPlan(params);
        for (const step of steps) {
          await deps.runCommand(step);
        }
        return steps;
      }

      return { install };
    },
  },
);

export const { AgentUpdaterService, AgentUpdaterServiceBuilder } = build().service(
  "AgentUpdaterService",
  {
    config: {},
    deps: {
      runCommand: function runCommand(step: AgentInstallStep) {
        return AgentInstallCommandService.run(step);
      },
      readCommand: function readCommand(params: { command: string; args: string[] }) {
        return AgentInstallCommandService.read(params);
      },
    },
    build({ deps }) {
      async function tryIsCodexPluginInstalled(): Promise<boolean> {
        try {
          const output = await deps.readCommand({
            command: "codex",
            args: ["plugin", "list", "--json"],
          });
          const plugins = JSON.parse(output) as { installed?: { pluginId?: unknown }[] };
          return plugins.installed?.some((plugin) => plugin.pluginId === "lgtm@rendotdev") ?? false;
        } catch {
          return false;
        }
      }

      async function tryIsCodexMarketplaceConfigured(): Promise<boolean> {
        try {
          const output = await deps.readCommand({
            command: "codex",
            args: ["plugin", "marketplace", "list", "--json"],
          });
          const marketplaces = JSON.parse(output) as { marketplaces?: { name?: unknown }[] };
          return (
            marketplaces.marketplaces?.some((marketplace) => marketplace.name === "rendotdev") ??
            false
          );
        } catch {
          return false;
        }
      }

      async function isInstalled(target: Exclude<AgentInstallTarget, "all">): Promise<boolean> {
        try {
          if (target === "pi") {
            return (await deps.readCommand({ command: "pi", args: ["list"] })).includes(
              "npm:@rendotdev/lgtm",
            );
          }
          if (target === "claude") {
            return (
              await deps.readCommand({ command: "claude", args: ["plugin", "list"] })
            ).includes("lgtm@rendotdev");
          }
          return (await tryIsCodexPluginInstalled()) || (await tryIsCodexMarketplaceConfigured());
        } catch {
          return false;
        }
      }

      async function update(params: {
        target: AgentInstallTarget;
        onUpdate?: (event: AgentUpdateEvent) => void;
      }): Promise<AgentUpdateResult> {
        const targets =
          params.target === "all" ? (["pi", "claude", "codex"] as const) : [params.target];
        const installed = await Promise.all(
          targets.map(async function checkTarget(target) {
            return { target, installed: await isInstalled(target) };
          }),
        );
        const skippedTargets = installed
          .filter(function isNotInstalled(result) {
            return !result.installed;
          })
          .map(function getTarget(result) {
            return result.target;
          });
        const integrations: AgentUpdateResult["integrations"] = [];
        const steps: AgentInstallStep[] = [];
        for (const integration of installed.filter(function isInstalledResult(result) {
          return result.installed;
        })) {
          const integrationSteps = AgentInstallSingleton.createUpdatePlan({
            target: integration.target,
          });
          const outputs: string[] = [];
          params.onUpdate?.({ phase: "started", target: integration.target });
          for (const step of integrationSteps) {
            steps.push(step);
            outputs.push(await deps.runCommand(step));
          }
          integrations.push({ target: integration.target, steps: integrationSteps, outputs });
          params.onUpdate?.({
            phase: "completed",
            target: integration.target,
            steps: integrationSteps,
            outputs,
          });
        }
        return { steps, skippedTargets, integrations };
      }

      return { update };
    },
  },
);
