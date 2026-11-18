import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

/**
 * Collapsible JSON viewer: objects/arrays show "{N items ↑}" toggles, with a Collapse all / Expand all switch.
 * Non-JSON strings are shown as plain text.
 */
export function JsonTree({ value }: { value: unknown }) {
  // bumping `gen` remounts nodes so the global collapse/expand applies to every level
  const [gen, setGen] = useState(0);
  const [allOpen, setAllOpen] = useState(true);

  if (value === undefined || value === null || value === "") return <div className="jt-empty">(empty)</div>;
  if (typeof value !== "object") return <pre className="jt-raw">{String(value)}</pre>;

  return (
    <div className="jt">
      <button className="jt-all" onClick={() => (setAllOpen((o) => !o), setGen((g) => g + 1))}>
        {allOpen ? <>Collapse all <ArrowUp size={13} /></> : <>Expand all <ArrowDown size={13} /></>}
      </button>
      <Node key={gen} value={value} open={allOpen} last />
    </div>
  );
}

function Node({ k, value, open: initial, last }: { k?: string; value: unknown; open: boolean; last?: boolean }) {
  const [open, setOpen] = useState(initial);
  const comma = last ? "" : ",";
  const label = k !== undefined ? <span className="jt-key">"{k}"</span> : null;

  if (value !== null && typeof value === "object") {
    const isArr = Array.isArray(value);
    const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
    const [o, c] = isArr ? ["[", "]"] : ["{", "}"];
    const n = entries.length;

    return (
      <div className="jt-node">
        <span>
          {label}
          {label && ": "}
          {o}
          <button className="jt-toggle" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
            {n} item{n === 1 ? "" : "s"} {open ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          </button>
          {!open && <>{c}{comma}</>}
        </span>
        {open && (
          <>
            <div className="jt-children">
              {entries.map(([ck, cv], i) => (
                <Node key={ck} k={isArr ? undefined : ck} value={cv} open={initial} last={i === n - 1} />
              ))}
            </div>
            <span>{c}{comma}</span>
          </>
        )}
      </div>
    );
  }

  const cls = typeof value === "string" ? "jt-str" : typeof value === "number" ? "jt-num" : "jt-lit";
  const text = typeof value === "string" ? JSON.stringify(value) : String(value);

  return (
    <div className="jt-leaf">
      {label}
      {label && ": "}
      <span className={cls}>{text}</span>
      {comma}
    </div>
  );
}
