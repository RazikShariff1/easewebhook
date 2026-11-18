import { useEffect, useRef, useState } from "react";
import type { HistogramBucket } from "../lib/api";
import { bucketRange, useBrush } from "../lib/brush";
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

/** Tooltip time: "17:50" within a day, else "Nov 18, 17:50". */
export function tipTime(iso: string | Date, spanMs: number) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return spanMs <= 86_400_000 ? t : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${t}`;
}

export function useWidth<T extends HTMLElement>() {
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
  onSelect,
}: {
  buckets: HistogramBucket[];
  from: string;
  to: string;
  series?: Series[];
  noun?: string;
  /** Called with the dragged time range; enables drag-to-zoom. */
  onSelect?: (from: Date, to: Date) => void;
}) {
  const SERIES = SERIES_;
  const [ref, width] = useWidth<HTMLDivElement>();
  const times = buckets.map((b) => b.time);
  const brush = useBrush(buckets.length, onSelect && ((a, b) => onSelect(...bucketRange(times, from, to, a, b))));
  const hover = brush.hover;

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
        {brush.sel && (
          <rect x={PAD.left + brush.sel[0] * slot} y={PAD.top} width={(brush.sel[1] - brush.sel[0] + 1) * slot} height={plotH} className="sbc-sel" />
        )}
        {hover !== undefined && !brush.sel && <rect x={PAD.left + hover * slot} y={PAD.top} width={slot} height={plotH} className="sbc-hover" />}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(max)} y2={y(max)} className="sbc-grid" />
        <text x={PAD.left - 8} y={y(max) + 4} textAnchor="end" className="sbc-tick">{max}</text>
        <text x={PAD.left - 8} y={y(0) + 4} textAnchor="end" className="sbc-tick">0</text>

        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          let acc = 0;
          const segs = SERIES.map((s, si) => ({ s, v: vals[i][si] })).filter((x) => x.v > 0);
          return (
            <g key={b.time}>
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
              {i % tickEvery === 0 && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="sbc-tick">
                  {fmtAxis(b.time, span)}
                </text>
              )}
            </g>
          );
        })}
        {hover !== undefined && (
          <line x1={PAD.left + hover * slot + slot / 2} x2={PAD.left + hover * slot + slot / 2} y1={PAD.top} y2={PAD.top + plotH} className="lc-cross" />
        )}
        {/* one hit target over the whole plot: hover + drag-to-zoom */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          className={brush.enabled ? "sbc-brush" : undefined}
          {...brush.handlers}
        >
          {brush.enabled && <title>Drag to zoom into a time range</title>}
        </rect>
      </svg>

      {hover !== undefined && buckets[hover] && (() => {
        const rows = brush.sel
          ? SERIES.map((_, si) => vals.slice(brush.sel![0], brush.sel![1] + 1).reduce((a, v) => a + v[si], 0))
          : vals[hover];
        const shown = SERIES.map((s, si) => ({ s, v: rows[si] })).filter(({ s, v }) => v > 0 || present.includes(s));
        const cx = PAD.left + hover * slot + slot / 2;
        const [rs, re] = brush.sel ? bucketRange(times, from, to, brush.sel[0], brush.sel[1]) : [];
        return (
          <div className="sbc-tip" style={{ left: cx + 190 > width ? cx - 186 : cx + 12, top: PAD.top + plotH / 2 - 30 }} role="status">
            <div className="sbc-tip-head">{rs && re ? `${tipTime(rs, span)} – ${tipTime(re, span)}` : tipTime(buckets[hover].time, span)}</div>
            {(shown.length ? shown : [{ s: SERIES[0], v: 0 }]).map(({ s, v }) => (
              <div key={s.key} className="sbc-tip-row">
                <i style={{ background: s.color }} /> {s.label} <strong>{v}</strong>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="sbc-legend">
        {(present.length ? present : SERIES.slice(0, 2)).map((s) => (
          <span key={s.key}><i style={{ background: s.color }} /> {s.label}</span>
        ))}
      </div>
    </div>
  );
}
