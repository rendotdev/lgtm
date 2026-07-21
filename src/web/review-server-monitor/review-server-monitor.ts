import { useEffect, useRef } from "react";
import { build } from "../../builder.ts";

export const { useReviewServerMonitor, useReviewServerMonitorBuilder } = build().hook(
  "useReviewServerMonitor",
  {
    config: { intervalMilliseconds: 1_500 },
    deps: {
      useEffect,
      useRef,
      fetch,
      setInterval: function scheduleInterval(
        callback: () => void,
        intervalMilliseconds: number,
      ): ReturnType<typeof setInterval> {
        return globalThis.setInterval(callback, intervalMilliseconds);
      },
      clearInterval: function clearScheduledInterval(timer: ReturnType<typeof setInterval>) {
        globalThis.clearInterval(timer);
      },
      closeWindow: function closeReviewWindow() {
        window.close();
        window.setTimeout(function retryCloseReviewWindow() {
          window.close();
        }, 50);
      },
    },
    build({ config, deps }) {
      const fetchHealth = deps.fetch.bind(globalThis);
      const scheduleInterval = deps.setInterval.bind(globalThis);
      const clearScheduledInterval = deps.clearInterval.bind(globalThis);

      return function useReviewServerMonitor(hookParams: { getCommentCount: () => number }): void {
        const latestGetCommentCountRef = deps.useRef(hookParams.getCommentCount);
        latestGetCommentCountRef.current = hookParams.getCommentCount;

        deps.useEffect(function monitorReviewServer() {
          let isChecking = false;

          async function checkReviewServer() {
            if (isChecking) {
              return;
            }
            isChecking = true;
            try {
              const response = await fetchHealth("/health", { cache: "no-store" });
              const shouldCloseWindow = !response.ok && latestGetCommentCountRef.current() === 0;
              if (shouldCloseWindow) {
                deps.closeWindow();
              }
            } catch {
              if (latestGetCommentCountRef.current() === 0) {
                deps.closeWindow();
              }
            } finally {
              isChecking = false;
            }
          }

          const timer = scheduleInterval(function checkReviewServerOnInterval() {
            void checkReviewServer();
          }, config.intervalMilliseconds);

          return function stopReviewServerMonitor() {
            clearScheduledInterval(timer);
          };
        }, []);
      };
    },
  },
);
