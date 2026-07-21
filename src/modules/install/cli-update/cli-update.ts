import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../../builder.ts";

export type CliUpdateStep = {
  command: string;
  args: string[];
};

export type CliUpdatePlan =
  | {
      status: "ready";
      currentVersion: string;
      latestVersion: string;
      step: CliUpdateStep;
    }
  | { status: "current"; version: string }
  | { status: "skipped"; reason: string };

export type CliUpdateResult =
  | {
      status: "updated";
      previousVersion: string;
      version: string;
      step: CliUpdateStep;
      output: string;
    }
  | { status: "current"; version: string }
  | { status: "skipped"; reason: string };

export const { CliUpdateCommandService, CliUpdateCommandServiceBuilder } = build().service(
  "CliUpdateCommandService",
  {
    config: {},
    deps: { spawn },
    build({ deps }) {
      async function execute(params: CliUpdateStep): Promise<string> {
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

      async function run(params: CliUpdateStep): Promise<string> {
        return await execute(params);
      }

      async function read(params: CliUpdateStep): Promise<string> {
        return await execute(params);
      }

      return { read, run };
    },
  },
);

export const { PackageRootService, PackageRootServiceBuilder } = build().service(
  "PackageRootService",
  {
    config: {},
    deps: { existsSync, readFileSync },
    build({ deps }) {
      function find(params: { moduleUrl: string }): string {
        let directory = dirname(fileURLToPath(params.moduleUrl));
        const root = parse(directory).root;
        while (directory !== root) {
          const packageJson = join(directory, "package.json");
          if (deps.existsSync(packageJson)) {
            const manifest = JSON.parse(deps.readFileSync(packageJson, "utf8")) as {
              name?: unknown;
            };
            if (manifest.name === "@rendotdev/lgtm") {
              return directory;
            }
          }
          directory = dirname(directory);
        }
        throw new Error("Could not locate the lgtm package root.");
      }

      return { find };
    },
  },
);

export const { PackageVersionService, PackageVersionServiceBuilder } = build().service(
  "PackageVersionService",
  {
    config: {},
    deps: { readFileSync },
    build({ deps }) {
      function read(params: { packageRoot: string }): string {
        const manifest = JSON.parse(
          deps.readFileSync(join(params.packageRoot, "package.json"), "utf8"),
        ) as { version?: unknown };
        if (typeof manifest.version !== "string") {
          throw new Error("The lgtm package does not declare a valid version.");
        }
        if (manifest.version.trim().length === 0) {
          throw new Error("The lgtm package does not declare a valid version.");
        }
        return manifest.version;
      }

      return { read };
    },
  },
);

const packageRoot = PackageRootService.find({ moduleUrl: import.meta.url });

export const { CliUpdaterService, CliUpdaterServiceBuilder } = build().service(
  "CliUpdaterService",
  {
    config: {
      packageRoot,
      currentVersion: PackageVersionService.read({ packageRoot }),
    },
    deps: {
      executableExists: existsSync,
      readCommand: function readCommand(step: CliUpdateStep) {
        return CliUpdateCommandService.read(step);
      },
      runCommand: function runCommand(step: CliUpdateStep) {
        return CliUpdateCommandService.run(step);
      },
    },
    build({ config: inputConfig, deps }) {
      const config = { ...inputConfig, packageRoot: resolve(inputConfig.packageRoot) };

      function parseLatestVersion(output: string): string {
        let value: unknown;
        try {
          value = JSON.parse(output);
        } catch {
          throw new Error("npm returned an invalid latest lgtm version.");
        }
        if (typeof value !== "string") {
          throw new Error("npm returned an invalid latest lgtm version.");
        }
        if (value.trim().length === 0) {
          throw new Error("npm returned an invalid latest lgtm version.");
        }
        return value;
      }

      async function plan(params: {}): Promise<CliUpdatePlan> {
        void params;
        const scopeDirectory = dirname(config.packageRoot);
        const nodeModulesDirectory = dirname(scopeDirectory);
        const libDirectory = dirname(nodeModulesDirectory);
        const isOutsideGlobalInstallation =
          basename(config.packageRoot) !== "lgtm" ||
          basename(scopeDirectory) !== "@rendotdev" ||
          basename(nodeModulesDirectory) !== "node_modules" ||
          basename(libDirectory) !== "lib";
        if (isOutsideGlobalInstallation) {
          return {
            status: "skipped",
            reason: "lgtm is not running from a global npm installation.",
          };
        }

        const prefix = dirname(libDirectory);
        const npm = join(prefix, "bin", "npm");
        if (!deps.executableExists(npm)) {
          return {
            status: "skipped",
            reason: `The npm executable for this installation was not found at ${npm}.`,
          };
        }

        const latestVersion = parseLatestVersion(
          await deps.readCommand({
            command: npm,
            args: ["view", "@rendotdev/lgtm@latest", "version", "--json"],
          }),
        );
        if (latestVersion === config.currentVersion) {
          return { status: "current", version: config.currentVersion };
        }

        return {
          status: "ready",
          currentVersion: config.currentVersion,
          latestVersion,
          step: {
            command: npm,
            args: ["install", "--global", "--prefix", prefix, `@rendotdev/lgtm@${latestVersion}`],
          },
        };
      }

      function getCurrentVersion(params: {}): string {
        void params;
        return config.currentVersion;
      }

      async function update(params: { plan?: CliUpdatePlan }): Promise<CliUpdateResult> {
        const updatePlan = params.plan ?? (await plan({}));
        if (updatePlan.status !== "ready") {
          return updatePlan;
        }
        const output = await deps.runCommand(updatePlan.step);
        return {
          status: "updated",
          previousVersion: updatePlan.currentVersion,
          version: updatePlan.latestVersion,
          step: updatePlan.step,
          output,
        };
      }

      return { getCurrentVersion, plan, update };
    },
  },
);
