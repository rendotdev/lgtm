import { codeToHtml, type ShikiTransformer } from "@pierre/diffs";
import { build, defineBuilderDeps, type BuilderType } from "../../builder.ts";
import {
  ReviewDiffPresentationService,
  type ReviewDiffPresentationServiceBuilder,
} from "../review-diff-presentation/review-diff-presentation.ts";

export const { DocumentCodeHighlighterService, DocumentCodeHighlighterServiceBuilder } =
  build().service("DocumentCodeHighlighterService", {
    config: {},
    deps: defineBuilderDeps<{
      codeToHtml: typeof codeToHtml;
      reviewDiffPresentation: Pick<
        BuilderType<typeof ReviewDiffPresentationServiceBuilder>,
        "themes" | "themeStyles"
      >;
    }>({
      codeToHtml,
      reviewDiffPresentation: ReviewDiffPresentationService,
    }),
    build({ deps }) {
      const cache = new Map<string, Promise<string>>();

      function languageFromClassName(params: { className?: string }): string {
        const language = params.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "text";
        return language === "patch" ? "diff" : language;
      }

      function highlight(params: {
        code: string;
        className?: string;
        sourceStartLine?: number;
      }): Promise<string> {
        const language = languageFromClassName({ className: params.className });
        const sourceStartLine = params.sourceStartLine ?? 1;
        const cacheKey = `${language}\0${sourceStartLine}\0${params.code}`;
        const cached = cache.get(cacheKey);
        if (cached) {
          return cached;
        }
        const highlighted = render({ code: params.code, language, sourceStartLine });
        cache.set(cacheKey, highlighted);
        return highlighted;
      }

      async function render(params: {
        code: string;
        language: string;
        sourceStartLine: number;
      }): Promise<string> {
        const themeStyles = await deps.reviewDiffPresentation.themeStyles({});
        const codeTransformers = [
          themeStylesTransformer({ themeStyles }),
          ...transformers({
            code: params.code,
            language: params.language,
            sourceStartLine: params.sourceStartLine,
          }),
        ];
        try {
          return await deps.codeToHtml(params.code, {
            lang: params.language,
            themes: deps.reviewDiffPresentation.themes({}),
            defaultColor: false,
            transformers: codeTransformers,
          });
        } catch {
          return await deps.codeToHtml(params.code, {
            lang: "text",
            themes: deps.reviewDiffPresentation.themes({}),
            defaultColor: false,
            transformers: [
              themeStylesTransformer({ themeStyles }),
              ...transformers({
                code: params.code,
                language: "text",
                sourceStartLine: params.sourceStartLine,
              }),
            ],
          });
        }
      }

      function themeStylesTransformer(params: { themeStyles: string }): ShikiTransformer {
        return {
          name: "lgtm-review-diff-theme",
          pre: (node) => {
            const existingStyle =
              typeof node.properties.style === "string" ? node.properties.style : "";
            node.properties.style = `${existingStyle}${params.themeStyles}`;
            return node;
          },
        };
      }

      function transformers(params: {
        code: string;
        language: string;
        sourceStartLine: number;
      }): ShikiTransformer[] {
        const lines = params.code.split(/\r?\n/);
        return [
          {
            name: "lgtm-document-diff-lines",
            line: (node, lineNumber) => {
              node.properties["data-document-line"] = params.sourceStartLine + lineNumber - 1;
              const kind =
                params.language === "diff"
                  ? diffLineKind({ line: lines[lineNumber - 1] ?? "" })
                  : null;
              if (kind) {
                node.properties["data-diff-line"] = kind;
              }
              return node;
            },
          },
        ];
      }

      function diffLineKind(params: {
        line: string;
      }): "addition" | "deletion" | "header" | "hunk" | null {
        const isHeader =
          params.line.startsWith("diff --git ") ||
          params.line.startsWith("index ") ||
          params.line.startsWith("--- ") ||
          params.line.startsWith("+++ ");
        if (isHeader) {
          return "header";
        }
        if (params.line.startsWith("@@")) {
          return "hunk";
        }
        if (params.line.startsWith("+")) {
          return "addition";
        }
        if (params.line.startsWith("-")) {
          return "deletion";
        }
        return null;
      }

      return { highlight, languageFromClassName };
    },
  });
