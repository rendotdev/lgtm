import { describe, expect, it } from "vite-plus/test";
import { jsonReviewInputParser } from "./json-review-input.ts";

const file = {
  location: "src/example.ts",
  oldContent: "before",
  newContent: "after",
};

describe("JsonReviewInputParserClass", () => {
  it("parses the documented review object", () => {
    expect(
      jsonReviewInputParser.parse({
        value: { name: "Example review", files: [file] },
      }),
    ).toEqual({ name: "Example review", files: [file] });
  });

  it("parses the shorthand file array", () => {
    expect(jsonReviewInputParser.parse({ value: [file] })).toEqual({ files: [file] });
  });

  it("rejects an empty file array", () => {
    expect(() => jsonReviewInputParser.parse({ value: { files: [] } })).toThrow(
      "JSON review input requires at least one file.",
    );
  });

  it("reports the invalid file field", () => {
    expect(() =>
      jsonReviewInputParser.parse({
        value: { files: [{ ...file, newContent: 42 }] },
      }),
    ).toThrow("files[0].newContent");
  });
});
