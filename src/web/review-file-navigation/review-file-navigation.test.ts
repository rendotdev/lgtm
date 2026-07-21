import { describe, expect, it } from "vite-plus/test";
import { ReviewFileNavigationService } from "./review-file-navigation.ts";

describe("ReviewFileNavigationService", () => {
  it("reads the selected file from the query string", () => {
    expect(
      ReviewFileNavigationService.read({
        search: "?theme=dark&file=src%2Fweb%2Fmain.tsx",
      }),
    ).toBe("src/web/main.tsx");
  });

  it("returns null for a missing or empty file", () => {
    expect(ReviewFileNavigationService.read({ search: "?theme=dark" })).toBeNull();
    expect(ReviewFileNavigationService.read({ search: "?file=%20%20" })).toBeNull();
  });

  it("creates a deep link while preserving other query parameters and the hash", () => {
    expect(
      ReviewFileNavigationService.createHref({
        href: "http://127.0.0.1:4173/review?theme=dark#comments",
        fileLocation: "src/web/main.tsx",
      }),
    ).toBe("/review?theme=dark&file=src%2Fweb%2Fmain.tsx#comments");
  });
});
