import { useEffect, useRef, useState } from "react";
import { fmtAxis } from "../lib/format";

export interface LinePoint {
  time: string;
  value: number | null; // null = no data in this bucket (gap, not zero)
}

const H = 200;
const PAD = { top: 12, right: 10, bottom: 26, left: 34 };

function niceMax(n: number) {
  if (n <= 0) return 1;
  if (n <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / p) * p;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(400);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Single-series line over time: 2px line, recessive dashed grid, crosshair + tooltip on hover. */
export function LineChart({
  points,
  from,
  to,
  label,
  format = (n) => String(Math.round(n * 100) / 100),
}: {
  points: LinePoint[];
  from: string;
  to: string;
  label: string;
  format?: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => PAD.left + (i / n) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const span = new Date(to).getTime() - new Date(from).getTime();
  const tickEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 80))));

  // path with gaps where value is null
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
    pen = true;
  });
  // isolated points (no neighbours) get a dot so they stay visible
  const lone = points
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.value !== null && (points[i - 1]?.value ?? null) === null && (points[i + 1]?.value ?? null) === null);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="sbc" ref={ref}>
      <svg width={width} height={H} role="img" aria-label={`${label} over time, peak ${format(max)}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(max * f)} y2={y(max * f)} className={f === 0 ? "sbc-axis" : "sbc-grid"} />
            <text x={PAD.left - 8} y={y(max * f) + 4} textAnchor="end" className="sbc-tick">{format(max * f)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % tickEvery === 0 ? (
            <text key={p.time} x={x(i)} y={H - 6} textAnchor="middle" className="sbc-tick">{fmtAxis(p.time, span)}</text>
          ) : null,
        )}
        <path d={d} className="lc-line" />
        {lone.map(({ p, i }) => (
          <circle key={p.time} cx={x(i)} cy={y(p.value!)} r={4} className="lc-dot" />
        ))}
        {hover !== undefined && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="lc-cross" />
            {points[hover].value !== null && <circle cx={x(hover)} cy={y(points[hover].value!)} r={4} className="lc-dot ring" />}
          </>
        )}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} />
      </svg>
      {hover !== undefined && (
        <div className="sbc-tip" style={{ left: Math.min(width - 170, Math.max(0, x(hover) - 80)) }} role="status">
          <div className="faint">{new Date(points[hover].time).toLocaleString()}</div>
          <div className="sbc-tip-row">
            {label} <strong>{points[hover].value === null ? "—" : format(points[hover].value!)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
