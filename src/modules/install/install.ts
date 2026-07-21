import { build } from "../../builder.ts";

export const agentInstallTargets = ["all", "pi", "claude", "codex"] as const;

export type AgentInstallTarget = (typeof agentInstallTargets)[number];

export type AgentInstallStep = {
  target: Exclude<AgentInstallTarget, "all">;
  command: string;
  args: string[];
};

export const { AgentInstallSingleton, AgentInstallSingletonBuilder } = build().singleton(
  "AgentInstallSingleton",
  {
    build() {
      function createInstallSteps(target: Exclude<AgentInstallTarget, "all">): AgentInstallStep[] {
        if (target === "pi") {
          return [{ target, command: "pi", args: ["install", "npm:@rendotdev/lgtm"] }];
        }

        if (target === "claude") {
          return [
            {
              target,
              command: "claude",
              args: ["plugin", "marketplace", "add", "https://github.com/rendotdev/lgtm"],
            },
            { target, command: "claude", args: ["plugin", "install", "lgtm@rendotdev"] },
          ];
        }

        return [
          {
            target,
            command: "codex",
            args: ["plugin", "marketplace", "add", "rendotdev/lgtm"],
          },
          { target, command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
        ];
      }

      function createUpdateSteps(target: Exclude<AgentInstallTarget, "all">): AgentInstallStep[] {
        if (target === "pi") {
          return [{ target, command: "pi", args: ["update", "npm:@rendotdev/lgtm"] }];
        }

        if (target === "claude") {
          return [
            {
              target,
              command: "claude",
              args: ["plugin", "marketplace", "update", "rendotdev"],
            },
            { target, command: "claude", args: ["plugin", "update", "lgtm@rendotdev"] },
          ];
        }

        return [
          {
            target,
            command: "codex",
            args: ["plugin", "marketplace", "upgrade", "rendotdev"],
          },
          { target, command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
        ];
      }

      return {
        createInstallPlan(params: { target: AgentInstallTarget }): AgentInstallStep[] {
          if (params.target !== "all") {
            return createInstallSteps(params.target);
          }
          return (["pi", "claude", "codex"] as const).flatMap(createInstallSteps);
        },

        createUpdatePlan(params: { target: AgentInstallTarget }): AgentInstallStep[] {
          if (params.target !== "all") {
            return createUpdateSteps(params.target);
          }
          return (["pi", "claude", "codex"] as const).flatMap(createUpdateSteps);
        },

        parseTarget(params: { value: string }): AgentInstallTarget | undefined {
          return agentInstallTargets.find((target) => target === params.value);
        },
      };
    },
  },
);
