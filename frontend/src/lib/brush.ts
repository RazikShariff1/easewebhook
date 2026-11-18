import { useEffect, useRef, useState, type PointerEvent } from "react";
import { customRange, type RangeKey } from "./format";

/**
 * Drag-to-select over a bucketed time axis ("brush"). Tracks the hovered bucket and, while the pointer is held,
 * the dragged bucket range; on release over more than one bucket it calls `onSelect(firstIndex, lastIndex)`.
 * Attach `handlers` to one element covering the plot area; `count` is the number of buckets across it.
 */
export function useBrush(
  count: number,
  onSelect?: (a: number, b: number) => void,
  /** maps a 0..1 position across the element to a bucket index (default: equal-width slots) */
  pick: (frac: number) => number = (f) => Math.floor(f * count),
) {
  const [hover, setHover] = useState<number>();
  const [drag, setDrag] = useState<{ a: number; b: number }>();
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // Escape cancels a drag in progress
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrag(undefined);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drag]);

  const indexAt = (e: PointerEvent<Element>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = pick((e.clientX - r.left) / Math.max(1, r.width));
    return Math.max(0, Math.min(count - 1, i));
  };

  const handlers = {
    onPointerDown: (e: PointerEvent<Element>) => {
      if (!onSelect || e.button !== 0 || count < 2) return;
      e.preventDefault(); // no text selection while dragging
      try {
        e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves outside the plot
      } catch {
        /* pointer already released */
      }
      const i = indexAt(e);
      dragRef.current = { a: i, b: i };
      setDrag(dragRef.current);
    },
    onPointerMove: (e: PointerEvent<Element>) => {
      const i = indexAt(e);
      setHover(i);
      if (dragRef.current) {
        dragRef.current = { a: dragRef.current.a, b: i };
        setDrag(dragRef.current);
      }
    },
    onPointerUp: () => {
      const d = dragRef.current;
      dragRef.current = undefined;
      setDrag(undefined);
      if (d && d.a !== d.b && onSelect) onSelect(Math.min(d.a, d.b), Math.max(d.a, d.b));
    },
    onPointerCancel: () => {
      dragRef.current = undefined;
      setDrag(undefined);
    },
    onPointerLeave: () => {
      if (!dragRef.current) setHover(undefined);
    },
  };

  const sel = drag && drag.a !== drag.b ? ([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] as const) : undefined;
  return { hover, sel, dragging: !!drag, handlers, enabled: !!onSelect && count > 1 };
}

/** Converts a selected bucket range into absolute times: start of the first bucket to the end of the last. */
export function bucketRange(times: string[], from: string, to: string, a: number, b: number): [Date, Date] {
  const step = (new Date(to).getTime() - new Date(from).getTime()) / Math.max(1, times.length);
  const start = new Date(times[a]);
  const end = new Date(Math.min(new Date(to).getTime(), new Date(times[b]).getTime() + step));
  return [start, end];
}

/**
 * Zoom history for a page's date range: `zoom(from, to)` narrows to a dragged range and remembers where it came
 * from, `back` (when set) returns to the previous range, and `pick` is for the range picker (clears the history).
 */
export function useZoomRange(range: RangeKey, setRange: (r: RangeKey) => void) {
  const [stack, setStack] = useState<RangeKey[]>([]);
  return {
    zoom: (from: Date, to: Date) => {
      setStack((s) => [...s, range]);
      setRange(customRange(from, to));
    },
    back: stack.length
      ? () => {
          setRange(stack[stack.length - 1]);
          setStack((s) => s.slice(0, -1));
        }
      : undefined,
    pick: (r: RangeKey) => {
      setStack([]);
      setRange(r);
    },
  };
}
