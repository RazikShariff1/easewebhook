import { useEffect, useRef, useState } from "react";
import { ArrowRight, Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { HistogramBucket } from "../lib/api";
import { useFloating } from "../lib/floating";
import { SERIES, type Series } from "./StatusBarChart";
import { customRange, fmtAxis, parseCustom, RANGES, rangeLabel, tzLabel, type RangeKey } from "../lib/format";

export function rangeBounds(key: RangeKey) {
  const c = parseCustom(key);
  if (c) return { from: c.from.toISOString(), to: c.to.toISOString() };
  const ms = (RANGES.find((r) => r.key === key) ?? RANGES[8]).ms;
  const to = new Date();
  // round "to" up to the next minute so polling doesn't shift the window every second
  to.setSeconds(60, 0);
  return { from: new Date(to.getTime() - ms).toISOString(), to: to.toISOString() };
}

type Tz = "local" | "utc";
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function dayKey(d: Date) {
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function hms(d: Date, tz: Tz) {
  const p = (n: number) => String(n).padStart(2, "0");
  return tz === "utc"
    ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function combine(day: Date, time: string, tz: Tz): Date {
  const [h = 0, m = 0, sec = 0] = time.split(":").map(Number);
  return tz === "utc"
    ? new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h, m, sec))
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, sec);
}

function Month({ first, start, end, onPick }: { first: Date; start?: Date; end?: Date; onPick: (d: Date) => void }) {
  const today = dayKey(new Date());
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const s = start ? dayKey(start) : undefined;
  const e = end ? dayKey(end) : s;
  return (
    <div className="rp-month">
      <div className="rp-week">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="rp-days">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(first.getFullYear(), first.getMonth(), i + 1);
          const k = dayKey(d);
          const future = k > today;
          const inRange = s !== undefined && e !== undefined && k >= s && k <= e;
          const edge = k === s || k === e;
          return (
            <button
              key={k}
              type="button"
              disabled={future}
              className={`rp-day ${inRange ? "in" : ""} ${edge ? "edge" : ""} ${k === today ? "today" : ""}`}
              onClick={() => onPick(d)}
              aria-pressed={inRange}
              aria-label={d.toDateString()}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Date-range picker: presets on the left, two-month calendar with times and timezone for a custom range. */
export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  const [open, setOpen] = useState(false);
  const [tz, setTz] = useState<Tz>("local");
  const [start, setStart] = useState<Date>();
  const [end, setEnd] = useState<Date>();
  const [startTime, setStartTime] = useState("00:00:00");
  const [endTime, setEndTime] = useState("23:59:59");
  const [anchor, setAnchor] = useState(() => new Date());
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { anchor: triggerRef, floating, style } = useFloating<HTMLButtonElement>(open);

  // seed the calendar from the current range whenever the popover opens
  useEffect(() => {
    if (!open) return;
    const b = rangeBounds(value);
    const f = new Date(b.from);
    const t = new Date(b.to);
    setStart(new Date(f.getFullYear(), f.getMonth(), f.getDate()));
    setEnd(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
    setStartTime(hms(f, tz));
    setEndTime(hms(t, tz));
    setAnchor(new Date(t.getFullYear(), t.getMonth() - 1, 1));
    setErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (d: Date) => {
    if (!start || end) {
      setStart(d);
      setEnd(undefined);
    } else if (d < start) {
      setStart(d);
    } else {
      setEnd(d);
    }
  };

  const apply = () => {
    if (!start) return setErr("Pick a start day.");
    const from = combine(start, startTime, tz);
    const to = combine(end ?? start, endTime, tz);
    if (!(from < to)) return setErr("The start must be before the end.");
    onChange(customRange(from, to));
    setOpen(false);
  };

  const m1 = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const m2 = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthName = (d: Date) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="rp" ref={ref}>
      <button ref={triggerRef} className="btn" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <Calendar />
        {rangeLabel(value)} <span className="faint" style={{ fontSize: 12 }}>{tz === "utc" ? "UTC" : tzLabel()}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="rp-pop" role="dialog" aria-label="Choose a date range" ref={floating} style={style}>
          <div className="rp-presets">
            {[0, 1, 2].map((g) => (
              <div key={g} className="rp-group">
                {RANGES.filter((r) => r.group === g).map((r) => (
                  <button key={r.key} className={`rp-preset ${r.key === value ? "on" : ""}`} onClick={() => (onChange(r.key), setOpen(false))}>
                    {r.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="rp-right">
            <div className="rp-cal">
              <div className="rp-cal-head">
                <button className="btn icon ghost" aria-label="Previous month" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>
                  <ChevronLeft />
                </button>
                <strong>{monthName(m1)}</strong>
                <strong>{monthName(m2)}</strong>
                <button className="btn icon ghost" aria-label="Next month" disabled={m2 >= thisMonth}
                  onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>
                  <ChevronRight />
                </button>
              </div>
              <div className="rp-months">
                <Month first={m1} start={start} end={end} onPick={pick} />
                <Month first={m2} start={start} end={end} onPick={pick} />
              </div>
              <div className="rp-times">
                <label className="field">
                  <span>Start time</span>
                  <input className="input" type="time" step={1} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <span className="rp-arrow"><ArrowRight size={16} /></span>
                <label className="field">
                  <span>End time</span>
                  <input className="input" type="time" step={1} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </label>
                <label className="field">
                  <span>Timezone</span>
                  <select className="select" value={tz} onChange={(e) => setTz(e.target.value as Tz)}>
                    <option value="local">{tzLabel()} (local)</option>
                    <option value="utc">UTC</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="rp-actions">
              {err && <span className="form-error" style={{ marginRight: "auto" }}>{err}</span>}
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={apply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Histogram({
  buckets,
  from,
  to,
  series = SERIES,
}: {
  buckets: HistogramBucket[];
  from: string;
  to: string;
  series?: Series[];
}) {
  const [hover, setHover] = useState<number>();
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const span = new Date(to).getTime() - new Date(from).getTime();
  const ticks = 5;
  const tickTimes = Array.from({ length: ticks + 2 }, (_, i) => new Date(new Date(from).getTime() + (span * i) / (ticks + 1)).toISOString());
  const count = (b: HistogramBucket, s: Series) => s.statuses.reduce((a, st) => a + ((b.status as Record<string, number | undefined>)[st] ?? 0), 0);

  return (
    <div className="histogram">
      <div className="hist-bars">
        {buckets.map((b, i) => (
          <div key={b.time} className="hist-bar" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(undefined)}>
            {series.map((s) => (
              <span key={s.key} style={{ height: `${(count(b, s) / max) * 100}%`, background: s.color }} />
            ))}
            {hover === i && b.total > 0 && (
              <div className="tooltip">
                <div className="muted">{fmtAxis(b.time, span)}</div>
                {series.map((s) =>
                  count(b, s) > 0 ? (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <i style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block" }} />
                      {count(b, s)} {s.label.toLowerCase()}
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="hist-axis">
        {tickTimes.map((t, i) => (
          <span key={t} className={i === 0 || i === tickTimes.length - 1 ? "edge" : ""}>
            {fmtAxis(t, span)}
          </span>
        ))}
      </div>
    </div>
  );
}
