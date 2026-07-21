import { describe, expect, it, vi } from "vite-plus/test";
import { useReviewServerMonitorBuilder } from "./review-server-monitor.ts";

function createHookHarness(params: { fetch: typeof fetch }) {
  let effect: (() => void | (() => void)) | undefined;
  let intervalCallback: (() => void) | undefined;
  let getCommentCountRef: { current: () => number } | undefined;
  const closeWindow = vi.fn();
  const clearInterval = vi.fn();
  const timer = 1 as unknown as ReturnType<typeof setInterval>;
  const useReviewServerMonitor = useReviewServerMonitorBuilder({
    config: { intervalMilliseconds: 1_500 },
    deps: {
      useEffect: function useEffect(nextEffect) {
        effect ??= nextEffect;
      },
      useRef: function useRef<Value>(initialValue: Value) {
        getCommentCountRef ??= {
          current: initialValue as unknown as () => number,
        };
        return getCommentCountRef as unknown as { current: Value };
      },
      fetch: params.fetch,
      setInterval: function setInterval(callback) {
        intervalCallback = callback;
        return timer;
      },
      clearInterval,
      closeWindow,
    },
  });

  function ReviewServerMonitorHookHarness(hookParams: { getCommentCount: () => number }) {
    useReviewServerMonitor(hookParams);
  }

  return {
    check: function check() {
      intervalCallback?.();
    },
    clearInterval,
    closeWindow,
    render: ReviewServerMonitorHookHarness,
    start: function start() {
      return effect?.();
    },
    timer,
  };
}

async function flushHealthCheck() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useReviewServerMonitor", () => {
  it("keeps a healthy review tab open and clears its timer on cleanup", async () => {
    const Harness = createHookHarness({
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    });
    Harness.render({ getCommentCount: () => 0 });
    const cleanup = Harness.start();

    Harness.check();
    await flushHealthCheck();

    expect(Harness.closeWindow).not.toHaveBeenCalled();

    cleanup?.();
    expect(Harness.clearInterval).toHaveBeenCalledWith(Harness.timer);
  });

  it("closes a comment-free tab when its review server is gone", async () => {
    const Harness = createHookHarness({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    Harness.render({ getCommentCount: () => 0 });
    Harness.start();

    Harness.check();
    await flushHealthCheck();

    expect(Harness.closeWindow).toHaveBeenCalledOnce();
  });

  it("reads the latest comment count after a rerender", async () => {
    const Harness = createHookHarness({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    Harness.render({ getCommentCount: () => 1 });
    Harness.start();

    Harness.check();
    await flushHealthCheck();
    expect(Harness.closeWindow).not.toHaveBeenCalled();

    Harness.render({ getCommentCount: () => 0 });
    Harness.check();
    await flushHealthCheck();

    expect(Harness.closeWindow).toHaveBeenCalledOnce();
  });
});
