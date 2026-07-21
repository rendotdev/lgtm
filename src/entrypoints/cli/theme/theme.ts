import { build } from "../../../builder.ts";

export const { TerminalColorsSingleton, TerminalColorsSingletonBuilder } = build().singleton(
  "TerminalColorsSingleton",
  {
    build() {
      return {
        loading: "cyan",
        success: "green",
        error: "red",
        muted: "gray",
      };
    },
  },
);

export const { TerminalIconsSingleton, TerminalIconsSingletonBuilder } = build().singleton(
  "TerminalIconsSingleton",
  {
    build() {
      const loadingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

      function loading(params: { frame: number }): string {
        return loadingFrames[params.frame % loadingFrames.length];
      }

      return { success: "✔", error: "✖", loading };
    },
  },
);
