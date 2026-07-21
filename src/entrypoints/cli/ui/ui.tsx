import { basename } from "node:path";
import { Text, render, useAnimation, type Instance } from "ink";
import type { ReactElement } from "react";
import { build, defineBuilderDeps } from "../../../builder.ts";
import type { AgentInstallStep, AgentInstallTarget } from "../../../modules/install/install.ts";
import type {
  CliUpdatePlan,
  CliUpdateResult,
} from "../../../modules/install/cli-update/cli-update.ts";
import { TerminalColorsSingleton, TerminalIconsSingleton } from "../theme/theme.ts";

const integrationNames: Record<Exclude<AgentInstallTarget, "all">, string> = {
  pi: "Pi",
  claude: "Claude Code",
  codex: "Codex",
};

type CommandUiState = "loading" | "success" | "error";
type CommandUiCompletedItem = { label: string; detail?: string; mutedDetail?: boolean };
export type CommandUiReporter = ((label: string) => void) & {
  complete: (params: CommandUiCompletedItem) => void;
};
function CommandUiView(props: {
  state: CommandUiState;
  label: string;
  detail?: string;
  completed?: CommandUiCompletedItem[];
}) {
  const { frame } = useAnimation({ interval: 80, isActive: props.state === "loading" });
  const symbol =
    props.state === "loading"
      ? TerminalIconsSingleton.loading({ frame })
      : props.state === "success"
        ? TerminalIconsSingleton.success
        : TerminalIconsSingleton.error;
  const color =
    props.state === "success"
      ? TerminalColorsSingleton.success
      : props.state === "error"
        ? TerminalColorsSingleton.error
        : TerminalColorsSingleton.loading;
  const hasCompleted = Boolean(props.completed?.length);
  const current = props.label ? `${symbol} ${props.label}` : "";

  return (
    <Text>
      {props.completed?.map(function renderCompleted(item, index) {
        return (
          <Text key={`${index}-${item.label}`}>
            {index > 0 ? "\n" : ""}
            <Text color={TerminalColorsSingleton.success}>
              {TerminalIconsSingleton.success} {item.label}
            </Text>
            {item.detail ? (
              <Text
                color={
                  item.mutedDetail ? TerminalColorsSingleton.muted : TerminalColorsSingleton.success
                }
              >
                {`\n${item.detail}`}
              </Text>
            ) : null}
          </Text>
        );
      })}
      {hasCompleted && current ? "\n" : ""}
      {current ? <Text color={color}>{current}</Text> : null}
      {props.detail ? (
        <Text color={props.state === "success" ? TerminalColorsSingleton.foreground : color}>
          {`${current ? "\n" : ""}${props.detail}`}
        </Text>
      ) : null}
    </Text>
  );
}

export const { CommandUiComponent, CommandUiComponentBuilder } = build().component(
  "CommandUiComponent",
  CommandUiView,
);

export const { CommandUiRendererService, CommandUiRendererServiceBuilder } = build().service(
  "CommandUiRendererService",
  {
    config: {},
    deps: defineBuilderDeps<{
      stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">;
      render: (
        tree: ReactElement,
        options: {
          stdout: Pick<NodeJS.WriteStream, "isTTY" | "write">;
          patchConsole: boolean;
        },
      ) => Pick<Instance, "rerender" | "unmount" | "waitUntilRenderFlush">;
    }>({
      stdout: process.stdout,
      render: function renderCommandUi(tree, options) {
        return render(tree, {
          stdout: options.stdout as NodeJS.WriteStream,
          patchConsole: options.patchConsole,
        });
      },
    }),
    build({ deps }) {
      async function run<Result>(params: {
        label: string;
        successLabel?: string;
        execute: (report: CommandUiReporter) => Promise<Result>;
        renderSuccess: (result: Result) => string;
      }): Promise<Result> {
        const successLabel = params.successLabel ?? params.label;
        const completed: CommandUiCompletedItem[] = [];
        if (!deps.stdout.isTTY) {
          const reporter = createReporter({
            onUpdate: function ignoreUpdate() {},
            onComplete: function captureCompleted(item) {
              completed.push(item);
            },
          });
          const result = await params.execute(reporter);
          const detail = params.renderSuccess(result);
          const output = [
            formatCompleted({ completed }),
            `${TerminalIconsSingleton.success} ${successLabel}`,
            detail,
          ]
            .filter(Boolean)
            .join("\n");
          deps.stdout.write(`${output}\n`);
          return result;
        }

        const instance = deps.render(<CommandUiComponent state="loading" label={params.label} />, {
          stdout: deps.stdout,
          patchConsole: false,
        });
        let currentLabel = params.label;
        function report(label: string) {
          currentLabel = label;
          instance.rerender(
            <CommandUiComponent state="loading" label={label} completed={completed} />,
          );
        }
        const reporter = createReporter({
          onUpdate: report,
          onComplete: function complete(item) {
            completed.push(item);
            currentLabel = "";
            instance.rerender(
              <CommandUiComponent state="loading" label="" completed={completed} />,
            );
          },
        });

        try {
          const result = await params.execute(reporter);
          instance.rerender(
            <CommandUiComponent
              state="success"
              label={successLabel}
              detail={params.renderSuccess(result)}
              completed={completed}
            />,
          );
          await instance.waitUntilRenderFlush();
          instance.unmount();
          return result;
        } catch (error) {
          instance.rerender(
            <CommandUiComponent
              state="error"
              label={currentLabel || params.label}
              detail={error instanceof Error ? error.message : String(error)}
              completed={completed}
            />,
          );
          await instance.waitUntilRenderFlush();
          instance.unmount();
          throw error;
        }
      }

      function formatDetail(params: { lines: string[] }): string {
        return params.lines.join("\n");
      }

      function formatChecklist(params: { lines: string[] }): string {
        return formatDetail({
          lines: params.lines.map((line) => `${TerminalIconsSingleton.success} ${line}`),
        });
      }

      function createSilentReporter(params: {}): CommandUiReporter {
        void params;
        return createReporter({
          onUpdate: function ignoreUpdate() {},
          onComplete: function ignoreComplete() {},
        });
      }

      function formatIntegrationName(params: {
        target: Exclude<AgentInstallTarget, "all">;
      }): string {
        return integrationNames[params.target];
      }

      function formatCommandOutputGroups(params: {
        steps: { command: string; args: string[] }[];
        outputs: string[];
      }): string | undefined {
        const groups = params.steps.flatMap(function formatStep(step, index) {
          const output = params.outputs[index]?.trim();
          if (!output) {
            return [];
          }
          const command = [basename(step.command), ...step.args].join(" ");
          return [
            `  ${command}`,
            ...output.split("\n").map(function indent(line) {
              return `    ${line}`;
            }),
          ];
        });
        if (groups.length === 0) {
          return undefined;
        }
        return groups.join("\n");
      }

      function formatIntegrationResult(params: {
        action: "setup" | "update";
        target: AgentInstallTarget;
        steps: AgentInstallStep[];
        skippedTargets?: Exclude<AgentInstallTarget, "all">[];
        cli?: CliUpdatePlan | CliUpdateResult;
        dryRun?: boolean;
      }): string {
        const lines: string[] = [];
        if (params.action === "setup") {
          lines.push(
            params.dryRun
              ? `Would set up lgtm integrations for ${params.target}.`
              : `Set up lgtm integrations for ${params.target}. Start a new agent session to load the plugin and skill.`,
          );
          return formatChecklist({ lines });
        }

        if (params.cli?.status === "ready") {
          lines.push(
            `  CLI: would update from ${params.cli.currentVersion} to ${params.cli.latestVersion}`,
          );
        }
        if (params.cli?.status === "updated") {
          lines.push(`  CLI: updated from ${params.cli.previousVersion} to ${params.cli.version}`);
        }
        if (params.cli?.status === "current") {
          lines.push(`  CLI: already current at ${params.cli.version}`);
        }
        if (params.cli?.status === "skipped") {
          lines.push(`  CLI: skipped; ${params.cli.reason}`);
        }

        const updatedTargets = [
          ...new Set(
            params.steps.map(function selectTarget(step) {
              return step.target;
            }),
          ),
        ];
        const ListFormatter = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
        if (updatedTargets.length > 0) {
          const targets = ListFormatter.format(
            updatedTargets.map(function selectName(target) {
              return integrationNames[target];
            }),
          );
          lines.push(`  Integrations: ${params.dryRun ? "would update" : "updated"} (${targets})`);
          if (!params.dryRun) {
            lines.push("  Restart your agent session to load the updated plugin and skill.");
          }
        }
        return formatDetail({ lines });
      }

      function createReporter(params: {
        onUpdate: (label: string) => void;
        onComplete: (item: CommandUiCompletedItem) => void;
      }): CommandUiReporter {
        function report(label: string) {
          params.onUpdate(label);
        }
        const reporter = report as CommandUiReporter;
        reporter.complete = function complete(item) {
          params.onComplete(item);
        };
        return reporter;
      }

      function formatCompleted(params: { completed: CommandUiCompletedItem[] }): string {
        return params.completed
          .map(function formatItem(item) {
            return `${TerminalIconsSingleton.success} ${item.label}${item.detail ? `\n${item.detail}` : ""}`;
          })
          .join("\n");
      }
      return {
        createSilentReporter,
        formatChecklist,
        formatCommandOutputGroups,
        formatDetail,
        formatIntegrationName,
        formatIntegrationResult,
        run,
      };
    },
  },
);
