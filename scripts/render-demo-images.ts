import { resolve } from "node:path";
import process from "node:process";
import { DomainClass } from "../src/domain/domain-class.ts";
import { DemoReviewFactory, type DemoReviewKind } from "../src/domain/review/demo-review.ts";
import { DemoImageRenderer } from "../src/platform/review/demo-image-renderer.ts";

class DemoImageScriptClass extends DomainClass<
  { outputDirectory: string },
  { render: typeof DemoImageRenderer.render }
> {
  public async run(): Promise<void> {
    const kinds: DemoReviewKind[] = ["diff", "document"];
    const themes = ["light", "dark"] as const;
    for (const theme of themes) {
      for (const kind of kinds) {
        const suffix = theme === "dark" ? "-dark" : "";
        const output = resolve(this.params.outputDirectory, `lgtm-demo-${kind}${suffix}.jpg`);
        await this.deps.render({
          comments: DemoReviewFactory.createComments({ kind }),
          input: DemoReviewFactory.create({ kind }),
          output,
          theme,
        });
        process.stdout.write(`Rendered ${theme} ${kind} demo: ${output}\n`);
      }
    }
  }
}

const DemoImageScript = new DemoImageScriptClass(
  { outputDirectory: resolve(process.cwd(), "assets") },
  { render: DemoImageRenderer.render.bind(DemoImageRenderer) },
);
await DemoImageScript.run();
