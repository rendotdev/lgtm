import { describe, expect, it } from "vite-plus/test";
import { TerminalColorsClass, TerminalIconsClass } from "./terminal-theme.ts";

describe("TerminalColorsClass", () => {
  it("defines the shared terminal palette", () => {
    const Colors = new TerminalColorsClass({}, {});

    expect(Colors).toMatchObject({
      loading: "cyan",
      success: "green",
      error: "red",
      muted: "gray",
    });
  });
});

describe("TerminalIconsClass", () => {
  it("defines status icons and cycles loading frames", () => {
    const Icons = new TerminalIconsClass({}, {});

    expect(Icons.success).toBe("✔");
    expect(Icons.error).toBe("✖");
    expect(Icons.loading({ frame: 0 })).toBe("⠋");
    expect(Icons.loading({ frame: 10 })).toBe("⠋");
  });
});
