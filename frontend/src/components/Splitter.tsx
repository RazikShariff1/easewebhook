import type { RefObject } from "react";
import type { Split } from "../lib/split";

/** Draggable divider (a slider between two panes). Drag, use the arrow keys, or double-click to reset. */
export function Splitter({ axis, ctl, containerRef, originRef, label }: { axis: "x" | "y"; ctl: Split; containerRef: RefObject<HTMLElement | null>; originRef?: RefObject<HTMLElement | null>; label: string }) {
  const step = 0.02;
  return (
    <div
      className={`splitter ${axis === "x" ? "v" : "h"} ${ctl.dragging ? "on" : ""}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(ctl.frac * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={(e) => ctl.start(e, containerRef.current, axis, originRef?.current)}
      onDoubleClick={ctl.reset}
      onKeyDown={(e) => {
        const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
        const fwd = axis === "x" ? "ArrowRight" : "ArrowDown";
        if (e.key === back) (e.preventDefault(), ctl.nudge(-step));
        else if (e.key === fwd) (e.preventDefault(), ctl.nudge(step));
      }}
    />
  );
}
