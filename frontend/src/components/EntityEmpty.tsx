import type { ReactNode } from "react";
import { EntityFlow } from "./EntityFlow";

/**
 * Hero empty state: copy + action on the left, the source → hub → destination illustration on the right.
 * The page's own side is drawn solid and the other faded.
 */
export function EntityEmpty({ focus, title, children }: { focus: "source" | "destination"; title: string; children: ReactNode }) {
  return (
    <div className="hero-empty">
      <div style={{ alignSelf: "center" }}>
        <h3>{title}</h3>
        {children}
      </div>
      <EntityFlow focus={focus} />
    </div>
  );
}
