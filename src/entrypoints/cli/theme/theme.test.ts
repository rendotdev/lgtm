import { describe, expect, it } from "vite-plus/test";
import { TerminalColorsSingletonBuilder, TerminalIconsSingletonBuilder } from "./theme.ts";

describe("TerminalColorsSingleton", () => {
  it("defines the shared terminal palette", () => {
    const Colors = TerminalColorsSingletonBuilder();

    expect(Colors).toMatchObject({
      loading: "cyan",
      success: "green",
      error: "red",
      muted: "gray",
    });
  });
});

describe("TerminalIconsSingleton", () => {
  it("defines status icons and cycles loading frames", () => {
    const Icons = TerminalIconsSingletonBuilder();

    expect(Icons.success).toBe("✔");
    expect(Icons.error).toBe("✖");
    expect(Icons.loading({ frame: 0 })).toBe("⠋");
    expect(Icons.loading({ frame: 10 })).toBe("⠋");
  });
});
