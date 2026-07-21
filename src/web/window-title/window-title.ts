import { build } from "../../builder.ts";

export const { ReviewWindowTitleSingleton, ReviewWindowTitleSingletonBuilder } = build().singleton(
  "ReviewWindowTitleSingleton",
  {
    build() {
      function format(params: { cwd: string; name: string }): string {
        const pathSegments = params.cwd.split(/[\\/]/).filter(Boolean);
        return `${pathSegments.at(-1) ?? params.cwd} / ${params.name}`;
      }

      return { format };
    },
  },
);
