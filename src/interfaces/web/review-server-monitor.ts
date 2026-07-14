import { DomainClass } from "../../domain/domain-class.ts";

type ReviewServerMonitorDependencies = {
  fetch: typeof fetch;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  closeWindow: () => void;
};

export class ReviewServerMonitorClass extends DomainClass<
  { intervalMilliseconds: number },
  ReviewServerMonitorDependencies
> {
  private interval: ReturnType<typeof setInterval> | undefined;
  private isChecking = false;

  public constructor(
    params: { intervalMilliseconds: number },
    deps: ReviewServerMonitorDependencies,
  ) {
    super(params, {
      ...deps,
      fetch: deps.fetch.bind(globalThis),
      setInterval: deps.setInterval.bind(globalThis),
      clearInterval: deps.clearInterval.bind(globalThis),
    });
  }

  public start(params: { getCommentCount: () => number }): void {
    if (this.interval !== undefined) {
      return;
    }
    this.interval = this.deps.setInterval(() => {
      void this.check(params);
    }, this.params.intervalMilliseconds);
  }

  public stop(): void {
    if (this.interval === undefined) {
      return;
    }
    this.deps.clearInterval(this.interval);
    this.interval = undefined;
  }

  public async check(params: { getCommentCount: () => number }): Promise<void> {
    if (this.isChecking) {
      return;
    }
    this.isChecking = true;
    try {
      const response = await this.deps.fetch("/health", { cache: "no-store" });
      if (!response.ok && params.getCommentCount() === 0) {
        this.deps.closeWindow();
      }
    } catch {
      if (params.getCommentCount() === 0) {
        this.deps.closeWindow();
      }
    } finally {
      this.isChecking = false;
    }
  }
}

export const ReviewServerMonitor = new ReviewServerMonitorClass(
  { intervalMilliseconds: 1_500 },
  {
    fetch,
    setInterval,
    clearInterval,
    closeWindow: function closeReviewWindow() {
      window.close();
      window.setTimeout(function retryCloseReviewWindow() {
        window.close();
      }, 50);
    },
  },
);
