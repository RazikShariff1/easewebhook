import { useEffect, useRef, useState } from "react";
import type { HistogramBucket } from "../lib/api";
import { fmtAxis } from "../lib/format";

// Status series, bottom of the stack first. Colours validated for CVD on the dark surface
// (success/failed ΔE 10.4 protan); identity is never colour-alone: legend + tooltip labels.
export interface Series {
  key: string;
  label: string;
  color: string;
  statuses: string[];
}

export const SERIES: Series[] = [
  { key: "ok", label: "Successful", color: "#239a5a", statuses: ["SUCCESSFUL"] },
  { key: "fail", label: "Failed", color: "#ff9b93", statuses: ["FAILED"] },
  { key: "pending", label: "Pending", color: "#a3a3a3", statuses: ["QUEUED", "SCHEDULED", "HOLD"] },
  { key: "cancel", label: "Cancelled", color: "#525252", statuses: ["CANCELLED"] },
];

// Inbound requests: same validated green/red pair.
export const REQUEST_SERIES: Series[] = [
  { key: "acc", label: "Accepted", color: "#239a5a", statuses: ["ACCEPTED"] },
  { key: "rej", label: "Rejected", color: "#ff9b93", statuses: ["REJECTED"] },
];

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 28 };

function niceMax(n: number) {
  if (n <= 5) return Math.max(1, n);
  const p = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / p) * p;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Stacked bar chart of events per time bucket, split by delivery status. */
export function StatusBarChart({
  buckets,
  from,
  to,
  series: SERIES_ = SERIES,
  noun = "events",
}: {
  buckets: HistogramBucket[];
  from: string;
  to: string;
  series?: Series[];
  noun?: string;
}) {
  const SERIES = SERIES_;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();

  const vals = buckets.map((b) => SERIES.map((s) => s.statuses.reduce((a, st) => a + ((b.status as Record<string, number | undefined>)[st] ?? 0), 0)));
  const max = niceMax(Math.max(0, ...vals.map((v) => v.reduce((a, x) => a + x, 0))));
  const present = SERIES.filter((_, i) => vals.some((v) => v[i] > 0));

  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = Math.max(1, buckets.length);
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const span = new Date(to).getTime() - new Date(from).getTime();
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));

  return (
    <div className="sbc" ref={ref}>
      <svg width={width} height={H} role="img" aria-label={`${noun} by status, ${buckets.length} time buckets, peak ${max}`}>
        {/* grid: baseline + max line */}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} className="sbc-axis" />
        <line x1={PAD.left} x2={width - PAD.right} y1={y(max)} y2={y(max)} className="sbc-grid" />
        <text x={PAD.left - 8} y={y(max) + 4} textAnchor="end" className="sbc-tick">{max}</text>
        <text x={PAD.left - 8} y={y(0) + 4} textAnchor="end" className="sbc-tick">0</text>

        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          let acc = 0;
          const segs = SERIES.map((s, si) => ({ s, v: vals[i][si] })).filter((x) => x.v > 0);
          return (
            <g key={b.time}>
              {hover === i && <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} className="sbc-hover" />}
              {segs.map(({ s, v }, k) => {
                const bottom = y(acc) - (k > 0 ? 2 : 0); // 2px surface gap between stacked fills
                acc += v;
                const yy = y(acc);
                const h = Math.max(1, bottom - yy);
                const top = k === segs.length - 1;
                const r = top ? Math.min(4, barW / 2, h) : 0;
                return top ? (
                  <path
                    key={s.key}
                    fill={s.color}
                    d={`M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${yy + h} Z`}
                  />
                ) : (
                  <rect key={s.key} x={x} y={yy} width={barW} height={h} fill={s.color} />
                );
              })}
              {/* hit target wider than the mark */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(undefined)}
              />
              {i % tickEvery === 0 && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="sbc-tick">
                  {fmtAxis(b.time, span)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== undefined && buckets[hover] && (
        <div
          className="sbc-tip"
          style={{ left: Math.min(width - 170, Math.max(0, PAD.left + hover * slot + slot / 2 - 80)) }}
          role="status"
        >
          <div className="faint">{new Date(buckets[hover].time).toLocaleString()}</div>
          {SERIES.map((s, si) =>
            vals[hover][si] > 0 ? (
              <div key={s.key} className="sbc-tip-row">
                <i style={{ background: s.color }} /> {s.label} <strong>{vals[hover][si]}</strong>
              </div>
            ) : null,
          )}
          {vals[hover].every((v) => v === 0) && <div className="faint">No {noun}</div>}
        </div>
      )}

      <div className="sbc-legend">
        {(present.length ? present : SERIES.slice(0, 2)).map((s) => (
          <span key={s.key}><i style={{ background: s.color }} /> {s.label}</span>
        ))}
      </div>
    </div>
  );
}
