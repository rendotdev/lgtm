import { build } from "../../../builder.ts";

type HandoffComment = {
  selectedText: string;
  startLine: number | null;
  endLine: number | null;
  comment: string;
};

type HandoffReview = {
  kind: "diff" | "document";
  name: string;
  reviewPath: string;
  files: Array<{
    location: string;
    comments: HandoffComment[];
  }>;
  document?: { location?: string };
  documentComments: HandoffComment[];
};

export const { ReviewHandoffSingleton, ReviewHandoffSingletonBuilder } = build().singleton(
  "ReviewHandoffSingleton",
  {
    build() {
      function clipboardText(params: {
        decision: "approved" | "changes_requested";
        review: HandoffReview;
      }): string {
        const prefix =
          params.decision === "approved"
            ? "LGTM, approving the following changes"
            : "PTAL, please address the review comments";
        return `${prefix}: ${params.review.reviewPath}`;
      }

      function lineRange(params: { startLine: number | null; endLine: number | null }) {
        if (params.startLine === null) {
          return "";
        }
        const isSingleLine = params.endLine === null || params.endLine === params.startLine;
        if (isSingleLine) {
          return `:${params.startLine}`;
        }
        return `:${params.startLine}-${params.endLine}`;
      }

      function appendComment(params: {
        lines: string[];
        location: string;
        comment: HandoffComment;
      }) {
        const text = params.comment.comment.trim();
        if (!text) {
          return;
        }
        const range = lineRange({
          startLine: params.comment.startLine,
          endLine: params.comment.endLine,
        });
        params.lines.push("", `## ${params.location}${range}`, "", text);
        if (params.comment.selectedText.trim()) {
          params.lines.push(
            "",
            "Selected text:",
            "",
            "> " + params.comment.selectedText.trim().replaceAll("\n", "\n> "),
          );
        }
      }

      function fallbackText(params: { review: HandoffReview }): string {
        const lines = [
          clipboardText({ decision: "changes_requested", review: params.review }),
          "",
          `# ${params.review.name}`,
        ];

        if (params.review.kind === "document") {
          for (const comment of params.review.documentComments) {
            appendComment({
              lines,
              location: params.review.document?.location ?? "Document",
              comment,
            });
          }
        } else {
          for (const file of params.review.files) {
            for (const comment of file.comments) {
              appendComment({ lines, location: file.location, comment });
            }
          }
        }

        return `${lines.join("\n").trimEnd()}\n`;
      }

      return { clipboardText, fallbackText };
    },
  },
);
