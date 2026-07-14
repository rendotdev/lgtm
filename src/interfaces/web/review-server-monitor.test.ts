import { describe, expect, it, vi } from "vite-plus/test";
import { ReviewServerMonitorClass } from "./review-server-monitor.ts";

function createMonitor(params: { fetch: typeof fetch; closeWindow: () => void }) {
  return new ReviewServerMonitorClass(
    { intervalMilliseconds: 1_500 },
    {
      fetch: params.fetch,
      setInterval,
      clearInterval,
      closeWindow: params.closeWindow,
    },
  );
}

describe("ReviewServerMonitorClass", () => {
  it("keeps a healthy review tab open", async () => {
    const closeWindow = vi.fn();
    const Monitor = createMonitor({
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
      closeWindow,
    });

    await Monitor.check({ getCommentCount: () => 0 });

    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("closes a comment-free tab when its review server is gone", async () => {
    const closeWindow = vi.fn();
    const Monitor = createMonitor({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      closeWindow,
    });

    await Monitor.check({ getCommentCount: () => 0 });

    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("reads the current comment count on every check", async () => {
    const closeWindow = vi.fn();
    let commentCount = 1;
    const Monitor = createMonitor({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      closeWindow,
    });

    await Monitor.check({ getCommentCount: () => commentCount });

    expect(closeWindow).not.toHaveBeenCalled();

    commentCount = 0;
    await Monitor.check({ getCommentCount: () => commentCount });

    expect(closeWindow).toHaveBeenCalledOnce();
  });
});
