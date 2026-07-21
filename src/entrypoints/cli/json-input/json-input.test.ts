import { describe, expect, it } from "vite-plus/test";
import { JsonReviewInputSingleton, ReviewGroupsInputSingleton } from "./json-input.ts";

const file = {
  location: "src/example.ts",
  oldContent: "before",
  newContent: "after",
};

describe("JsonReviewInputSingleton", () => {
  it("parses the documented review object", () => {
    const groups = [{ title: "Runtime", files: [file.location] }];
    expect(
      JsonReviewInputSingleton.parse({
        value: { name: "Example review", files: [file], groups },
      }),
    ).toEqual({ name: "Example review", files: [file], groups });
  });

  it("parses the shorthand file array", () => {
    expect(JsonReviewInputSingleton.parse({ value: [file] })).toEqual({ files: [file] });
  });

  it("rejects an empty file array", () => {
    expect(() => JsonReviewInputSingleton.parse({ value: { files: [] } })).toThrow(
      "JSON review input requires at least one file.",
    );
  });

  it("reports the invalid file field", () => {
    expect(() =>
      JsonReviewInputSingleton.parse({
        value: { files: [{ ...file, newContent: 42 }] },
      }),
    ).toThrow("files[0].newContent");
  });
});

describe("ReviewGroupsInputSingleton", () => {
  it("parses a groups manifest", () => {
    expect(
      ReviewGroupsInputSingleton.parse({
        value: { groups: [{ title: "Tests", files: ["src/example.test.ts"] }] },
      }),
    ).toEqual([{ title: "Tests", files: ["src/example.test.ts"] }]);
  });

  it("rejects group metadata beyond a title and files", () => {
    expect(() =>
      ReviewGroupsInputSingleton.parse({
        value: {
          groups: [{ title: "Tests", summary: "Not supported", files: ["example.test.ts"] }],
        },
      }),
    ).toThrow("Invalid review groups input");
  });

  it("rejects empty groups", () => {
    expect(() => ReviewGroupsInputSingleton.parse({ value: { groups: [] } })).toThrow(
      "Review grouping requires at least one group.",
    );
  });
});
