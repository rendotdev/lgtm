import { getHighlighterThemeStyles, getSharedHighlighter } from "@pierre/diffs";
import { build } from "../../builder.ts";

export const { ReviewDiffPresentationService, ReviewDiffPresentationServiceBuilder } =
  build().service("ReviewDiffPresentationService", {
    config: {
      themes: { light: "github-light" as const, dark: "github-dark" as const },
      lineDiffType: "word" as const,
      diffIndicators: "classic" as const,
      hunkSeparators: "metadata" as const,
      unsafeCSS: [
        ':host { --review-radius: 6px; --diffs-font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --diffs-header-font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --diffs-bg-hover-override: #0070f3; --diffs-bg-selection-override: #0070f3; --diffs-bg-selection-number-override: #0070f3; --diffs-selection-number-fg: #0070f3; }',
        '[data-diffs-header="default"] { padding-inline: 0 !important; border-radius: var(--review-radius) var(--review-radius) 0 0 !important; }',
        '[data-diffs-header="default"] [data-header-content] { margin-left: 0 !important; }',
        '[data-diffs-header="default"] [data-metadata] { padding-right: 0 !important; }',
        // Pierre adds vertical inset around the rows when its file header is disabled.
        "[data-code] { padding-block: 0 !important; }",
        // Pierre's scroll mode otherwise reserves a scrollbar gutter even when every line fits.
        "[data-code] { overflow-x: auto !important; }",
        // Comment selection uses whole rows instead of the browser's character ranges.
        "[data-line] { user-select: none !important; -webkit-user-select: none !important; }",
        "[data-change-icon] { opacity: 0.72; transform: scale(0.9); transform-origin: center; }",
        "[data-diff-span] { border-radius: var(--review-radius) !important; }",
        "[data-separator-content], [data-expand-button], [data-separator-wrapper] { border-color: var(--border) !important; border-radius: var(--review-radius) !important; }",
        "[data-separator-wrapper] { background-color: var(--border) !important; }",
      ].join("\n"),
    },
    deps: { getHighlighterThemeStyles, getSharedHighlighter },
    build({ config, deps }) {
      let themeStylesPromise: Promise<string> | null = null;

      function themes(params: {}) {
        void params;
        return config.themes;
      }

      function resolveTheme(params: { resolvedTheme?: string }) {
        const type = params.resolvedTheme === "dark" ? ("dark" as const) : ("light" as const);
        return { name: config.themes[type], type };
      }

      function highlighterOptions(params: {}) {
        void params;
        return { lineDiffType: config.lineDiffType, theme: config.themes };
      }

      function fileOptions(params: {}) {
        void params;
        return {
          diffIndicators: config.diffIndicators,
          hunkSeparators: config.hunkSeparators,
          disableFileHeader: true,
          lineDiffType: config.lineDiffType,
          unsafeCSS: config.unsafeCSS,
        };
      }

      async function loadThemeStyles(): Promise<string> {
        const highlighter = await deps.getSharedHighlighter({
          themes: [config.themes.light, config.themes.dark],
          langs: ["diff"],
        });
        return deps.getHighlighterThemeStyles({ theme: config.themes, highlighter });
      }

      function themeStyles(params: {}): Promise<string> {
        void params;
        themeStylesPromise ??= loadThemeStyles();
        return themeStylesPromise;
      }

      return { fileOptions, highlighterOptions, resolveTheme, themes, themeStyles };
    },
  });
