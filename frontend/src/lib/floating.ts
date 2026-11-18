import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const MARGIN = 8; // keep this far from the window edges
const GAP = 4; // space between anchor and floating element

/**
 * Positions a popover (menu, picker, calendar) with `position: fixed` next to its anchor, so it is never clipped
 * by a scrolling or overflow-hidden ancestor (e.g. a modal). It opens below the anchor and flips above when there
 * isn't room, shifts left to stay inside the window, and caps its height so it can scroll.
 */
export function useFloating<A extends HTMLElement = HTMLElement, F extends HTMLElement = HTMLDivElement>(
  open: boolean,
  opts: { matchWidth?: boolean; align?: "start" | "end" } = {},
) {
  const anchor = useRef<A>(null);
  const floating = useRef<F>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });
  const { matchWidth = false, align = "start" } = opts;

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ position: "fixed", visibility: "hidden" });
      return;
    }

    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const f = floating.current;
      if (!a || !f) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = matchWidth ? a.width : Math.min(f.scrollWidth, vw - 2 * MARGIN);
      const height = f.scrollHeight;

      let left = align === "end" ? a.right - width : a.left;
      if (left + width > vw - MARGIN) left = vw - MARGIN - width;
      left = Math.max(MARGIN, left);

      const below = vh - a.bottom - GAP - MARGIN;
      const above = a.top - GAP - MARGIN;
      const flip = height > below && above > below;
      const maxHeight = Math.max(160, flip ? above : below);
      const top = flip ? Math.max(MARGIN, a.top - GAP - Math.min(height, maxHeight)) : a.bottom + GAP;

      setStyle({
        position: "fixed",
        top,
        left,
        width: matchWidth ? width : undefined,
        maxWidth: vw - 2 * MARGIN,
        maxHeight,
        zIndex: 90,
        visibility: "visible",
      });
    };

    place();
    // re-measure once content (e.g. async options) has rendered
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, matchWidth, align]);

  return { anchor, floating, style };
}
