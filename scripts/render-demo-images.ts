import { resolve } from "node:path";
import process from "node:process";
import { build } from "../src/builder.ts";
import { DemoReviewSingleton, type DemoReviewKind } from "../src/modules/review/demo/demo.ts";
import { DemoImageService } from "../src/modules/review/demo-image/demo-image.ts";

await build().entrypoint({
  config: { outputDirectory: resolve(process.cwd(), "assets") },
  deps: { render: DemoImageService.render },
  async run({ config, deps }): Promise<void> {
    const kinds: DemoReviewKind[] = ["diff", "document"];
    const themes = ["light", "dark"] as const;
    for (const theme of themes) {
      for (const kind of kinds) {
        const suffix = theme === "dark" ? "-dark" : "";
        const output = resolve(config.outputDirectory, `lgtm-demo-${kind}${suffix}.jpg`);
        await deps.render({
          comments: DemoReviewSingleton.createComments({ kind }),
          input: DemoReviewSingleton.create({ kind }),
          output,
          theme,
        });
        process.stdout.write(`Rendered ${theme} ${kind} demo: ${output}\n`);
      }
    }
  },
});
