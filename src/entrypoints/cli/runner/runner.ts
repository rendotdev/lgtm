import { build } from "../../../builder.ts";
import { CommandUiRendererService, type CommandUiReporter } from "../ui/ui.tsx";

export const { CliCommandRunnerService, CliCommandRunnerServiceBuilder } = build().service(
  "CliCommandRunnerService",
  {
    config: { jsonOutput: false },
    deps: {
      markErrorRendered: function markErrorRendered() {},
      renderer: CommandUiRendererService,
      writeJson: function writeJson(value: unknown) {
        process.stdout.write(`${JSON.stringify(value)}\n`);
      },
    },
    build({ config, deps }) {
      async function run<Result>(params: {
        label: string;
        successLabel?: string;
        execute: (report: CommandUiReporter) => Promise<Result>;
        renderSuccess: (result: Result) => string;
      }): Promise<Result> {
        if (config.jsonOutput) {
          const result = await params.execute(deps.renderer.createSilentReporter({}));
          deps.writeJson(result);
          return result;
        }
        try {
          return await deps.renderer.run(params);
        } catch (error) {
          deps.markErrorRendered();
          throw error;
        }
      }

      return { run };
    },
  },
);
