import { useEffect, useState } from "react";
import { api, type HistogramBucket, type Page, type Source, type Destination, type Stats } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { type RangeKey } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { ErrorBox } from "../components/ui";
import { Histogram, RangePicker, rangeBounds } from "../components/Timeline";

export function MetricsPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [bounds, setBounds] = useState(() => rangeBounds(range));
  useEffect(() => setBounds(rangeBounds(range)), [range]);

  const hist = useQuery(
    () => api.get<{ buckets: HistogramBucket[] }>("/events/histogram", { from: bounds.from, to: bounds.to, buckets: 60 }),
    [bounds],
    15_000,
  );
  const stats = useQuery(() => api.get<Stats>("/stats"), [], 15_000);
  const sources = useQuery(() => api.get<Page<Source>>("/sources", { limit: 250 }), []);
  const dests = useQuery(() => api.get<Page<Destination>>("/destinations", { limit: 250 }), []);

  const sum = (k: keyof HistogramBucket["status"]) => hist.data?.buckets.reduce((a, b) => a + (b.status[k] ?? 0), 0) ?? 0;
  const total = hist.data?.buckets.reduce((a, b) => a + b.total, 0) ?? 0;
  const ok = sum("SUCCESSFUL");
  const failed = sum("FAILED");
  const pending = sum("QUEUED") + sum("SCHEDULED") + sum("HOLD");
  const rate = ok + failed ? Math.round((ok / (ok + failed)) * 1000) / 10 : null;

  return (
    <>
      <PageHeader title="Metrics" />
      <div className="toolbar">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="content">
        <ErrorBox error={hist.error} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, padding: "20px 24px" }}>
          <Tile label="Events" value={total} />
          <Tile label="Successful" value={ok} color="var(--success)" />
          <Tile label="Failed" value={failed} color="var(--danger)" />
          <Tile label="Pending" value={pending} color="var(--info)" />
          <Tile label="Success rate" value={rate == null ? "—" : `${rate}%`} />
        </div>
        {hist.data && <Histogram buckets={hist.data.buckets} from={bounds.from} to={bounds.to} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16, padding: 24 }}>
          <Breakdown title="Requests by source (24h)" rows={(sources.data?.models ?? []).map((s) => [s.name, stats.data?.requests_24h[s.id] ?? 0])} />
          <Breakdown title="Delivery attempts by destination (24h)" rows={(dests.data?.models ?? []).map((d) => [d.name, stats.data?.attempts_24h[d.id] ?? 0])} />
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, marginTop: 4, color }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...sorted.map((r) => r[1]));
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
      <div className="section-title">{title}</div>
      {sorted.length === 0 && <span className="faint">Nothing yet.</span>}
      {sorted.map(([name, n]) => (
        <div key={name} style={{ display: "grid", gridTemplateColumns: "160px 1fr 50px", gap: 10, alignItems: "center", padding: "5px 0" }}>
          <span className="mono truncate">{name}</span>
          <div style={{ height: 8, background: "var(--bg-elev)", borderRadius: 4 }}>
            <div style={{ height: "100%", width: `${(n / max) * 100}%`, background: "var(--primary)", borderRadius: 4 }} />
          </div>
          <span className="mono" style={{ textAlign: "right" }}>{n}</span>
        </div>
      ))}
    </div>
  );
}
