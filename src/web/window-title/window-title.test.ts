import { describe, expect, it } from "vite-plus/test";
import { ReviewWindowTitleSingletonBuilder } from "./window-title.ts";

describe("ReviewWindowTitleSingleton", () => {
  const Title = ReviewWindowTitleSingletonBuilder();

  it.each([
    ["/Users/rene/GitHub/lgtm", "Review preferences", "lgtm / Review preferences"],
    ["C:\\Users\\rene\\GitHub\\rig", "Review scheduler", "rig / Review scheduler"],
  ])("formats the project directory and review name from %s", (cwd, name, expected) => {
    expect(Title.format({ cwd, name })).toBe(expected);
  });
});
