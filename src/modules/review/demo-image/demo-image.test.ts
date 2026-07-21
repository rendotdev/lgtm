import { describe, expect, it, vi } from "vite-plus/test";
import { DemoImageServiceBuilder } from "./demo-image.ts";

const pointer = {
  name: "Demo",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "review-id",
  appDir: "/project/.lgtm/review-id",
  url: "http://localhost:4000/",
  reviewPath: "/project/.lgtm/review-id/review.json",
};

describe("DemoImageService", () => {
  it("renders and stops a headless demo review", async () => {
    const openReview = vi.fn().mockResolvedValue(pointer);
    const stopReview = vi.fn().mockResolvedValue(true);
    const renderBrowserImage = vi.fn().mockResolvedValue("/project/demo.jpg");
    const rm = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const Renderer = DemoImageServiceBuilder({
      config: {},
      deps: {
        mkdtemp: vi.fn().mockResolvedValue("/tmp/lgtm-demo"),
        openReview,
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            files: [{ location: "demo.ts", comments: [] }],
            documentComments: [],
          }),
        ),
        rm,
        stopReview,
        writeFile,
        renderBrowserImage,
      },
    });

    const result = await Renderer.render({
      comments: {
        files: [
          {
            location: "demo.ts",
            comments: [
              {
                id: "comment",
                fileLocation: "demo.ts",
                selectedRowIds: ["additions:1-1"],
                selectedText: "demo",
                side: "additions",
                selectedRange: { start: 1, end: 1 },
                startLine: 1,
                endLine: 1,
                lineNumbers: [1],
                comment: "Explain this.",
                createdAt: "2026-07-15T12:00:00.000Z",
                updatedAt: "2026-07-15T12:00:00.000Z",
              },
            ],
          },
        ],
        documentComments: [],
      },
      input: { kind: "diff", name: "Demo", files: [] },
      output: "/project/demo.jpg",
      theme: "light",
    });

    expect(result).toBe("/project/demo.jpg");
    expect(openReview).toHaveBeenCalledWith(expect.anything(), {
      cwd: "/tmp/lgtm-demo",
      openBrowser: false,
      reviewUUID: "preview",
      sessionId: "demo",
      trackAsActiveReview: false,
    });
    expect(stopReview).toHaveBeenCalledWith("/tmp/lgtm-demo", pointer.reviewPath);
    expect(rm).toHaveBeenCalledWith("/tmp/lgtm-demo", { force: true, recursive: true });
    expect(writeFile.mock.calls[0]?.[1]).toContain("Explain this.");
  });

  it("stops the review when image rendering fails", async () => {
    const stopReview = vi.fn().mockResolvedValue(true);
    const Renderer = DemoImageServiceBuilder({
      config: {},
      deps: {
        mkdtemp: vi.fn().mockResolvedValue("/tmp/lgtm-demo"),
        openReview: vi.fn().mockResolvedValue(pointer),
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            files: [{ location: "demo.ts", comments: [] }],
            documentComments: [],
          }),
        ),
        rm: vi.fn().mockResolvedValue(undefined),
        stopReview,
        writeFile: vi.fn().mockResolvedValue(undefined),
        renderBrowserImage: vi.fn().mockRejectedValue(new Error("Capture failed")),
      },
    });

    await expect(
      Renderer.render({
        comments: { files: [], documentComments: [] },
        input: { kind: "diff", name: "Demo", files: [] },
        output: "/project/demo.jpg",
        theme: "light",
      }),
    ).rejects.toThrow("Capture failed");
    expect(stopReview).toHaveBeenCalledWith("/tmp/lgtm-demo", pointer.reviewPath);
  });
});
