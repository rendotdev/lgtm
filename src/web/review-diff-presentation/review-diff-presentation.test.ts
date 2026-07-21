import { describe, expect, it } from "vite-plus/test";
import { ReviewDiffPresentationService } from "./review-diff-presentation.ts";

describe("ReviewDiffPresentationService", () => {
  it("shares themes and diff behavior across review renderers", () => {
    expect(ReviewDiffPresentationService.resolveTheme({ resolvedTheme: "light" })).toEqual({
      name: "github-light",
      type: "light",
    });
    expect(ReviewDiffPresentationService.resolveTheme({ resolvedTheme: "dark" })).toEqual({
      name: "github-dark",
      type: "dark",
    });
    expect(ReviewDiffPresentationService.highlighterOptions({})).toEqual({
      lineDiffType: "word",
      theme: { light: "github-light", dark: "github-dark" },
    });
    expect(ReviewDiffPresentationService.fileOptions({})).toMatchObject({
      diffIndicators: "classic",
      hunkSeparators: "metadata",
      disableFileHeader: true,
      lineDiffType: "word",
    });
    expect(ReviewDiffPresentationService.fileOptions({}).unsafeCSS).toContain(
      "[data-line] { user-select: none",
    );
  });

  it("derives the GitHub diff palette from Pierre's configured themes", async () => {
    const styles = await ReviewDiffPresentationService.themeStyles({});

    expect(styles).toContain("--diffs-light-bg:#fff");
    expect(styles).toContain("--diffs-dark-bg:#24292e");
    expect(styles).toContain("--diffs-light-addition-color:#28a745");
    expect(styles).toContain("--diffs-dark-addition-color:#34d058");
    expect(styles).toContain("--diffs-light-deletion-color:#d73a49");
    expect(styles).toContain("--diffs-dark-deletion-color:#ea4a5a");
  });
});
