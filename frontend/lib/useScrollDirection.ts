"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether the page is scrolling up or down, so chrome can hide on the
 * way down and reappear on the way up — the student gets the whole screen for
 * browsing, and the filters are one upward flick away.
 */
export function useScrollDirection({
  threshold = 8,
  revealAboveY = 120,
}: { threshold?: number; revealAboveY?: number } = {}) {
  const [isVisible, setIsVisible] = useState(true);
  const [isPinned, setIsPinned] = useState(true);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;

    const onScroll = () => {
      // Coalesce to one update per frame; scroll fires far more often.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;

        // Near the top the bar is always shown, and it sits flush (unpinned)
        // so it doesn't float over the heading.
        if (y < revealAboveY) {
          setIsVisible(true);
          setIsPinned(false);
          lastY = y;
          return;
        }

        setIsPinned(true);
        // Ignore jitter and rubber-banding at the extremes.
        if (Math.abs(delta) > threshold) {
          setIsVisible(delta < 0);
          lastY = y;
        }
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [revealAboveY, threshold]);

  return { isVisible, isPinned };
}
