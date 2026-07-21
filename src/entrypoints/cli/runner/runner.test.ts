import { describe, expect, it, vi } from "vite-plus/test";
import { CommandUiRendererServiceBuilder } from "../ui/ui.tsx";
import { CliCommandRunnerServiceBuilder } from "./runner.ts";

describe("CliCommandRunnerService", () => {
  it("writes structured JSON without starting the interactive renderer", async () => {
    const writeJson = vi.fn();
    const Renderer = CommandUiRendererServiceBuilder({
      config: {},
      deps: {
        stdout: process.stdout,
        render: function renderUnexpectedly() {
          throw new Error("JSON output must not render an Ink app.");
        },
      },
    });
    const Runner = CliCommandRunnerServiceBuilder({
      config: { jsonOutput: true },
      deps: {
        markErrorRendered: vi.fn(),
        renderer: Renderer,
        writeJson,
      },
    });

    await expect(
      Runner.run({
        label: "Opening review",
        execute: async function execute() {
          return { status: "open" };
        },
        renderSuccess: function renderSuccess() {
          return "unused";
        },
      }),
    ).resolves.toEqual({ status: "open" });
    expect(writeJson).toHaveBeenCalledWith({ status: "open" });
  });

  it("records renderer errors before rethrowing them", async () => {
    const markErrorRendered = vi.fn();
    const Renderer = CommandUiRendererServiceBuilder({
      config: {},
      deps: {
        stdout: {
          isTTY: false,
          write: function write() {
            return true;
          },
        },
        render: function renderUnexpectedly() {
          throw new Error("The non-interactive test must not render an Ink app.");
        },
      },
    });
    const Runner = CliCommandRunnerServiceBuilder({
      config: { jsonOutput: false },
      deps: {
        markErrorRendered,
        renderer: Renderer,
        writeJson: vi.fn(),
      },
    });

    await expect(
      Runner.run({
        label: "Opening review",
        execute: async function execute() {
          throw new Error("failed");
        },
        renderSuccess: function renderSuccess() {
          return "unused";
        },
      }),
    ).rejects.toThrow("failed");
    expect(markErrorRendered).toHaveBeenCalledOnce();
  });
});
