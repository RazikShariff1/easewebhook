import { useCallback, useEffect, useState } from "react";

export interface Split {
  frac: number;
  dragging: boolean;
  start: (e: React.PointerEvent, container: HTMLElement | null, axis: "x" | "y", origin?: HTMLElement | null) => void;
  nudge: (delta: number) => void;
  reset: () => void;
}

/** Draggable split position as a 0–1 fraction, remembered per `key` in localStorage. */
export function useSplit(key: string, initial: number, min = 0.15, max = 0.85): Split {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);
  const [frac, setFrac] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(key) ?? "");
      if (v >= min && v <= max) return v;
    } catch { /* storage unavailable: fall back to the default */ }
    return initial;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (dragging) return;
    try { localStorage.setItem(key, String(frac)); } catch { /* ignore */ }
  }, [dragging, frac, key]);

  // `container` sizes the fraction; `origin` is where the first pane starts (defaults to the container's edge —
  // pass the first pane itself when something like a header sits above it).
  const start: Split["start"] = (e, container, axis, origin) => {
    if (!container) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const hr = handle.getBoundingClientRect();
    const thickness = axis === "x" ? hr.width : hr.height;
    const grab = axis === "x" ? e.clientX - hr.left : e.clientY - hr.top; // where inside the handle it was grabbed
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    // keep the cursor and avoid text selection for the whole drag, even when the pointer leaves the handle
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    const move = (ev: PointerEvent) => {
      const r = container.getBoundingClientRect();
      const o = (origin ?? container).getBoundingClientRect();
      // columns use `fr` units, which exclude the handle's own width; rows use % of the container height
      const f = axis === "x" ? (ev.clientX - grab - o.left) / (r.width - thickness) : (ev.clientY - grab - o.top) / r.height;
      setFrac(clamp(f));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      setDragging(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return { frac, dragging, start, nudge: (d) => setFrac((f) => clamp(f + d)), reset: () => setFrac(initial) };
}
