import { describe, expect, it } from "vite-plus/test";
import type { ReviewSourceFile } from "../../modules/review/review/review.ts";
import { FileSearchSingleton } from "./file-search.ts";

const files = [
  "src/web/review-presentation/review-presentation.ts",
  "src/modules/review/server/server.ts",
  "src/web/main.tsx",
  "src/entrypoints/mcp/mcp.ts",
  "README.md",
].map(function createFile(location, index): ReviewSourceFile {
  return {
    id: `file-${index}`,
    location,
    language: "typescript",
    oldContent: "",
    newContent: "",
    added: 0,
    removed: 0,
  };
});

describe("FileSearchSingleton", () => {
  it("preserves the original order for an empty query", () => {
    expect(FileSearchSingleton.search({ files, query: "  " })).toBe(files);
    expect(FileSearchSingleton.search({ files, query: "---" })).toBe(files);
  });

  it("ranks a matching filename ahead of a path-only match", () => {
    expect(FileSearchSingleton.search({ files, query: "review server" })[0]?.location).toBe(
      "src/modules/review/server/server.ts",
    );
  });

  it("matches initials and compact filename queries", () => {
    expect(FileSearchSingleton.search({ files, query: "rvpres" })[0]?.location).toBe(
      "src/web/review-presentation/review-presentation.ts",
    );
    expect(FileSearchSingleton.search({ files, query: "maintsx" })[0]?.location).toBe(
      "src/web/main.tsx",
    );
  });

  it("tolerates transpositions and missing characters", () => {
    expect(
      FileSearchSingleton.search({ files, query: "reveiw presntation" }).map(
        (file) => file.location,
      ),
    ).toEqual(["src/web/review-presentation/review-presentation.ts"]);
  });

  it("requires every query term to match", () => {
    expect(FileSearchSingleton.search({ files, query: "web mcp" })).toEqual([]);
  });

  it("normalizes case and accents", () => {
    const accentedFile = { ...files[4], location: "Guides/Résumé.md" };
    expect(FileSearchSingleton.search({ files: [accentedFile], query: "resume" })).toEqual([
      accentedFile,
    ]);
  });

  it("filters 50,000 indexed files within an interactive time budget", () => {
    const largeFileSet = Array.from({ length: 50_000 }, function createFile(_, index) {
      return {
        id: `large-file-${index}`,
        location: `packages/package-${index % 1_000}/src/components/component-${index}.test.tsx`,
        language: "typescript",
        oldContent: "",
        newContent: "",
        added: 0,
        removed: 0,
      } satisfies ReviewSourceFile;
    });
    FileSearchSingleton.prepare({ files: largeFileSet });

    const startedAt = performance.now();
    const exactResult = FileSearchSingleton.search({
      files: largeFileSet,
      query: "component 49999",
    });
    const typoResult = FileSearchSingleton.search({
      files: largeFileSet,
      query: "componnet 49999",
    });
    const compactResult = FileSearchSingleton.search({ files: largeFileSet, query: "cmp49999" });
    const duration = performance.now() - startedAt;

    expect(exactResult[0]?.location).toBe(
      "packages/package-999/src/components/component-49999.test.tsx",
    );
    expect(typoResult[0]?.location).toBe(
      "packages/package-999/src/components/component-49999.test.tsx",
    );
    expect(compactResult[0]?.location).toBe(
      "packages/package-999/src/components/component-49999.test.tsx",
    );
    expect(duration).toBeLessThan(1_000);
  });
});
