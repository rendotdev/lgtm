import { describe, expect, it, vi } from "vite-plus/test";
import { CliUpdaterClass } from "./cli-update-platform.ts";

describe("CliUpdaterClass", () => {
  it("updates through the npm executable belonging to the active global installation", async () => {
    const runCommand = vi.fn(async () => undefined);
    const updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm" },
      { executableExists: () => true, runCommand },
    );

    const result = await updater.update();

    expect(result).toEqual({
      status: "updated",
      step: {
        command: "/runtime/bin/npm",
        args: ["install", "--global", "--prefix", "/runtime", "@rendotdev/lgtm@latest"],
      },
    });
    expect(runCommand).toHaveBeenCalledWith(result.status === "updated" ? result.step : undefined);
  });

  it("skips local and npx installations", async () => {
    const runCommand = vi.fn(async () => undefined);
    const updater = new CliUpdaterClass(
      { packageRoot: "/project/node_modules/@rendotdev/lgtm" },
      { executableExists: () => true, runCommand },
    );

    await expect(updater.update()).resolves.toEqual({
      status: "skipped",
      reason: "LGTM is not running from a global npm installation.",
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("skips a global installation whose matching npm executable is unavailable", () => {
    const updater = new CliUpdaterClass(
      { packageRoot: "/runtime/lib/node_modules/@rendotdev/lgtm" },
      { executableExists: () => false, runCommand: vi.fn(async () => undefined) },
    );

    expect(updater.plan()).toEqual({
      status: "skipped",
      reason: "The npm executable for this installation was not found at /runtime/bin/npm.",
    });
  });
});
