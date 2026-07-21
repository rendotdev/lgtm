import { useEffect, useRef, useState } from "react";
import { build } from "../../../../../builder.ts";

export const { useLazyVisibility, useLazyVisibilityBuilder } = build().hook("useLazyVisibility", {
  config: { rootMargin: "1000px 0px" },
  deps: {
    IntersectionObserver: window.IntersectionObserver,
    useEffect,
    useRef,
    useState,
  },
  build({ config, deps }) {
    return function useLazyVisibility(_hookParams: {}) {
      const targetRef = deps.useRef<HTMLDivElement | null>(null);
      const [isVisible, setIsVisible] = deps.useState(false);

      deps.useEffect(
        function observeLazyTarget() {
          const target = targetRef.current;
          const shouldSkipObservation = isVisible || !target;
          if (shouldSkipObservation) {
            return;
          }
          if (!deps.IntersectionObserver) {
            setIsVisible(true);
            return;
          }
          const observer = new deps.IntersectionObserver(
            function revealIntersectingTarget(entries) {
              if (!entries.some((entry) => entry.isIntersecting)) {
                return;
              }
              setIsVisible(true);
              observer.disconnect();
            },
            { rootMargin: config.rootMargin },
          );
          observer.observe(target);
          return function stopObservingLazyTarget() {
            observer.disconnect();
          };
        },
        [isVisible],
      );

      return { isVisible, targetRef };
    };
  },
});
