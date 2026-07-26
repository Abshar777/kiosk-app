"use client";

import { useEffect } from "react";

const RIPPLE_TARGET = ".button, [data-ripple]";
const DURATION_MS = 560;

/**
 * Global touch ripple.
 *
 * Mounted once, this listens for pointer-down in the capture phase and drives a
 * ::after pseudo-element on the pressed control, sized and positioned from the
 * touch point. Nothing is added to the DOM, so it is safe on React-owned nodes
 * and needs no changes at any call site — every HeroUI `.button` and anything
 * marked `data-ripple` gets it for free.
 */
export function Ripple() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timers = new WeakMap<HTMLElement, number>();

    const onPointerDown = (event: PointerEvent) => {
      if (reduceMotion.matches) return;
      // Left button / touch / pen only — a right-click isn't an activation.
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const target = (event.target as Element | null)?.closest?.(RIPPLE_TARGET);
      if (!(target instanceof HTMLElement)) return;
      if (
        target.hasAttribute("disabled") ||
        target.getAttribute("aria-disabled") === "true" ||
        target.dataset.disabled === "true"
      ) {
        return;
      }

      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // A circle that covers the control from wherever it was touched.
      const dx = Math.max(event.clientX - rect.left, rect.right - event.clientX);
      const dy = Math.max(event.clientY - rect.top, rect.bottom - event.clientY);
      const size = Math.ceil(Math.hypot(dx, dy) * 2);

      target.style.setProperty("--ripple-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--ripple-y", `${event.clientY - rect.top}px`);
      target.style.setProperty("--ripple-size", `${size}px`);

      // Restart the animation on a rapid second tap: drop the attribute, force
      // a reflow so the browser sees a real change, then re-apply.
      target.removeAttribute("data-rippling");
      void target.offsetWidth;
      target.setAttribute("data-rippling", "true");

      window.clearTimeout(timers.get(target));
      timers.set(
        target,
        window.setTimeout(() => target.removeAttribute("data-rippling"), DURATION_MS),
      );
    };

    // Capture phase, so a child that stops propagation can't swallow it.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return null;
}
