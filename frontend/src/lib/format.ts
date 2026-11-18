export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtAxis(iso: string, spanMs: number): string {
  const d = new Date(iso);
  if (spanMs <= 4 * 86_400_000) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return `in ${humanDuration(-s)}`;
  if (s < 5) return "just now";
  return `${humanDuration(s)} ago`;
}

function humanDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function pretty(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}

export function tryParseJSON(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (s.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Preset ranges, in the groups shown by the date picker.
export const RANGES = [
  { key: "1m", label: "Last minute", ms: MIN, group: 0 },
  { key: "5m", label: "Last 5 minutes", ms: 5 * MIN, group: 0 },
  { key: "15m", label: "Last 15 minutes", ms: 15 * MIN, group: 0 },
  { key: "30m", label: "Last 30 minutes", ms: 30 * MIN, group: 0 },
  { key: "1h", label: "Last hour", ms: HOUR, group: 1 },
  { key: "3h", label: "Last 3 hours", ms: 3 * HOUR, group: 1 },
  { key: "6h", label: "Last 6 hours", ms: 6 * HOUR, group: 1 },
  { key: "12h", label: "Last 12 hours", ms: 12 * HOUR, group: 1 },
  { key: "24h", label: "Last day", ms: DAY, group: 2 },
  { key: "3d", label: "Last 3 days", ms: 3 * DAY, group: 2 },
  { key: "7d", label: "Last 7 days", ms: 7 * DAY, group: 2 },
  { key: "14d", label: "Last 14 days", ms: 14 * DAY, group: 2 },
  { key: "30d", label: "Last 30 days", ms: 30 * DAY, group: 2 },
] as const;

export type PresetKey = (typeof RANGES)[number]["key"];
/** A preset, or a custom absolute range encoded as "custom:<fromISO>|<toISO>". */
export type RangeKey = PresetKey | `custom:${string}`;

export function customRange(from: Date, to: Date): RangeKey {
  return `custom:${from.toISOString()}|${to.toISOString()}`;
}

export function parseCustom(key: RangeKey): { from: Date; to: Date } | undefined {
  if (!key.startsWith("custom:")) return undefined;
  const [f, t] = key.slice(7).split("|");
  const from = new Date(f);
  const to = new Date(t);
  return isNaN(+from) || isNaN(+to) ? undefined : { from, to };
}

export function rangeLabel(key: RangeKey): string {
  const c = parseCustom(key);
  if (!c) return RANGES.find((r) => r.key === key)?.label ?? "Last day";
  const f = (d: Date) => d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${f(c.from)} – ${f(c.to)}`;
}

/** The next larger preset (for "Expand to 3 days"), or undefined at the top / for custom ranges. */
export function nextRange(key: RangeKey): (typeof RANGES)[number] | undefined {
  const i = RANGES.findIndex((r) => r.key === key);
  return i >= 0 ? RANGES[i + 1] : undefined;
}

export function tzLabel(): string {
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `GMT${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

// Human label for a request's status: "Accepted", or the rejection cause ("Unsupported Method", "Verification Failed").
export function requestStatusLabel(status: string, cause?: string | null): string {
  if (status !== "REJECTED") return "Accepted";
  const code = (cause ?? "REJECTED").split(":")[0].trim();
  return code
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
