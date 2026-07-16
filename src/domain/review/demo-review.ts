import { DomainClass } from "../domain-class.ts";
import type { DocumentComment, OpenReviewInput, ReviewComment } from "./review.ts";

export type DemoReviewKind = "diff" | "document";
export type DemoReviewComments = {
  files: { location: string; comments: ReviewComment[] }[];
  documentComments: DocumentComment[];
};

export class DemoReviewFactoryClass extends DomainClass<{}, {}> {
  public create(params: { kind: DemoReviewKind }): OpenReviewInput {
    return params.kind === "document" ? this.createDocumentReview() : this.createDiffReview();
  }

  public createComments(params: { kind: DemoReviewKind }): DemoReviewComments {
    const timestamp = "2026-07-15T12:00:00.000Z";
    if (params.kind === "document") {
      return {
        files: [],
        documentComments: [
          {
            id: "demo-document-comment",
            selectedText:
              "When a task fails, the runner retries it automatically. The interface shows the current attempt and preserves the final error if every attempt fails.",
            startBlockId: "p:9:9",
            endBlockId: "p:9:9",
            startLine: 9,
            endLine: 9,
            prefix: "",
            suffix: "",
            comment: "Could we show the next retry time so users know the task is still active?",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      };
    }
    return {
      files: [
        {
          location: "src/task-runner.ts",
          comments: [
            {
              id: "demo-diff-comment",
              fileLocation: "src/task-runner.ts",
              selectedRowIds: ["additions:12-12"],
              selectedText: "const delay = 250 * 2 ** (attempt - 1);",
              side: "additions",
              selectedRange: { start: 12, end: 12, side: "additions", endSide: "additions" },
              startLine: 12,
              endLine: 12,
              lineNumbers: [12],
              comment: "Could we add jitter so concurrent retries do not synchronize?",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
      ],
      documentComments: [],
    };
  }

  private createDiffReview(): OpenReviewInput {
    return {
      kind: "diff",
      name: "Demo: Add resilient task retries",
      files: [
        {
          location: "src/task-runner.ts",
          oldContent: `export async function runTask(task: Task, deps: Dependencies) {
  const result = await deps.execute(task);
  return result;
}
`,
          newContent: `export async function runTask(task: Task, deps: Dependencies) {
  const maximumAttempts = 3;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await deps.execute(task);
    } catch (error) {
      if (attempt === maximumAttempts) {
        throw error;
      }

      const delay = 250 * 2 ** (attempt - 1);
      await deps.wait(delay);
    }
  }

  throw new Error("Task retry loop finished unexpectedly.");
}
`,
        },
        {
          location: "src/task-runner.test.ts",
          oldContent: `it("runs a task", async () => {
  const result = await runTask(task, dependencies);
  expect(result).toEqual({ status: "complete" });
});
`,
          newContent: `it("retries a failed task with exponential backoff", async () => {
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValue({ status: "complete" });
  const wait = vi.fn().mockResolvedValue(undefined);

  const result = await runTask(task, { execute, wait });

  expect(result).toEqual({ status: "complete" });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledWith(250);
});
`,
        },
        {
          location: "README.md",
          oldContent: `## Task execution

Tasks run once and report their result.
`,
          newContent: `## Task execution

Tasks retry temporary failures up to three times. Retries use exponential
backoff, starting at 250 milliseconds, before reporting the final result.
`,
        },
      ],
    };
  }

  private createDocumentReview(): OpenReviewInput {
    return {
      kind: "document",
      name: "Demo: Review a retry plan",
      document: {
        location: "docs/plans/task-retries.md",
        markdown: `# Resilient task retries

## Goal

Allow task execution to recover from temporary failures while keeping permanent failures visible and actionable.

## User experience

When a task fails, the runner retries it automatically. The interface shows the current attempt and preserves the final error if every attempt fails.

| Setting | Default | Purpose |
| --- | ---: | --- |
| Maximum attempts | 3 | Limits repeated work |
| Initial delay | 250 ms | Gives temporary failures time to recover |
| Backoff | 2x | Reduces pressure on dependencies |

## Implementation

1. Add retry orchestration around the task executor.
2. Inject the wait boundary so tests remain deterministic.
3. Preserve the original error after the final attempt.

## Acceptance criteria

- Successful tasks still execute once.
- Temporary failures retry with exponential backoff.
`,
      },
    };
  }
}

export const DemoReviewFactory = new DemoReviewFactoryClass({}, {});
