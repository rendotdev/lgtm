import { describe, expect, it } from "vite-plus/test";
import { DemoReviewFactory } from "./demo-review.ts";

describe("DemoReviewFactoryClass", () => {
  it("builds a compact multi-file diff demo", () => {
    const demo = DemoReviewFactory.create({ kind: "diff" });

    expect(demo).toMatchObject({
      kind: "diff",
      name: "Demo: Add resilient task retries",
    });
    expect(demo.files).toHaveLength(3);
    expect(demo.files?.map((file) => file.location)).toEqual([
      "src/task-runner.ts",
      "src/task-runner.test.ts",
      "README.md",
    ]);
  });

  it("builds a Markdown-rich document demo", () => {
    const demo = DemoReviewFactory.create({ kind: "document" });

    expect(demo).toMatchObject({
      kind: "document",
      name: "Demo: Review a retry plan",
      document: { location: "docs/plans/task-retries.md" },
    });
    expect(demo.document?.markdown).toContain("| Maximum attempts | 3 |");
    expect(demo.document?.markdown).toContain("## Acceptance criteria");
  });

  it("builds realistic comments for both demo kinds", () => {
    const diffComments = DemoReviewFactory.createComments({ kind: "diff" });
    const documentComments = DemoReviewFactory.createComments({ kind: "document" });

    expect(diffComments.files[0]?.comments[0]?.comment).toContain("jitter");
    expect(documentComments.documentComments[0]?.comment).toContain("next retry time");
  });
});
