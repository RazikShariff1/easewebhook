import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Info, Pencil, Power, RefreshCw, Trash2, Waypoints, Zap } from "lucide-react";
import { api, type Connection, type HistogramBucket, type Page, type Source } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, requestStatusLabel, type RangeKey } from "../lib/format";
import { useSourceTypes } from "../lib/sourceTypes";
import { Badge, CopyText, Empty, ErrorBox, Loading, useAction } from "../components/ui";
import { SourceForm } from "../components/forms";
import { SourceIcon } from "../components/SourceIcon";
import { RangePicker, rangeBounds, ZoomOut } from "../components/Timeline";
import { useZoomRange } from "../lib/brush";
import { REQUEST_SERIES, StatusBarChart } from "../components/StatusBarChart";
import { LineChart } from "../components/LineChart";

const fmtNum = (n: number) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));

type Tab = "overview" | "metrics" | "connections" | "settings";

interface SrcStats {
  requests: number;
  accepted: number;
  rejections: { response: string; count: number }[];
  events: number;
  ignored: number;
  last_request_at: string | null;
}

export function SourceDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const [editing, setEditing] = useState(false);
  const s = useQuery(() => api.get<Source>(`/sources/${id}`), [id]);
  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { source_id: id, limit: 250 }), [id]);

  const setTab = (t: Tab) => {
    params.set("tab", t);
    setParams(params, { replace: true });
  };

  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Loading />;
  const src = s.data;

  return (
    <>
      <header className="page-header">
        <h1 className="crumbs">
          <Link to="/sources" className="muted">Sources</Link>
          <span className="faint">/</span>
          <span>{src.name}</span>
        </h1>
      </header>
      <nav className="detail-tabs" role="tablist">
        {(["overview", "metrics", "connections", "settings"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "connections" && <span className="count-pill">{conns.data?.models.length ?? 0}</span>}
          </button>
        ))}
      </nav>

      <div className="content">
        {tab === "overview" && (
          <div className="dd-grid">
            <Details src={src} onEdit={() => setEditing(true)} />
            <Metrics src={src} compact />
          </div>
        )}
        {tab === "metrics" && <Metrics src={src} />}
        {tab === "connections" && <ConnectionsTab src={src} conns={conns.data?.models} />}
        {tab === "settings" && <SettingsTab src={src} onEdit={() => setEditing(true)} reload={s.reload} />}
      </div>

      {editing && <SourceForm source={src} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), s.reload())} />}
    </>
  );
}

function authSummary(src: Source, verifies: boolean, typeName?: string): string {
  if (src.type === "PUBLISH_API") return "API key (Bearer / X-Api-Key)";
  if (src.verification) {
    return { hmac: "HMAC signature", api_key: "API key header", basic_auth: "Basic auth" }[src.verification.type] ?? src.verification.type;
  }
  if (verifies && Object.values(src.config).some(Boolean)) return `${typeName} signature`;
  return "Disabled";
}

function Details({ src, onEdit }: { src: Source; onEdit: () => void }) {
  const t = useSourceTypes().find((x) => x.id === src.type);
  return (
    <aside className="dd-details">
      <div className="dd-head">
        <h2>Source details</h2>
        <button className="btn" onClick={onEdit}><Pencil size={14} /> Edit</button>
      </div>
      <dl className="dd-list">
        <dt>Status</dt>
        <dd>
          {src.disabled_at ? (
            <Badge tone="neutral">Disabled</Badge>
          ) : (
            <span className="badge success" style={{ display: "inline-flex", gap: 4 }}><Zap size={12} /> Active</span>
          )}
        </dd>
        <dt>Name</dt>
        <dd className="mono"><CopyText text={src.name} /></dd>
        <dt>Source URL</dt>
        <dd className="mono" style={{ wordBreak: "break-all" }}><CopyText text={src.url} /></dd>
      </dl>
      <hr />
      <h3>Configuration</h3>
      <dl className="dd-list">
        <dt>Type</dt>
        <dd><span className="chip-static"><SourceIcon icon={t?.icon ?? "webhook"} name={t?.name} size={14} /> {t?.name ?? src.type}</span></dd>
        <dt>HTTP methods</dt>
        <dd style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {src.allowed_http_methods.map((m) => <span key={m} className="chip-static mono">{m}</span>)}
        </dd>
        <dt>Authentication method</dt>
        <dd><span className="chip-static">{authSummary(src, !!t?.verifies_signatures, t?.name)}</span></dd>
        <dt>Custom response</dt>
        <dd>
          {src.custom_response ? (
            <>
              <span className="chip-static">On · {{ "application/json": "JSON", "text/plain": "TEXT", "application/xml": "XML" }[src.custom_response.content_type] ?? src.custom_response.content_type}</span>
              <pre className="code" style={{ marginTop: 8, maxHeight: 140 }}>{src.custom_response.body}</pre>
            </>
          ) : (
            <span className="chip-static">Off</span>
          )}
        </dd>
      </dl>
      <hr />
      <h3>Metadata</h3>
      <dl className="dd-list">
        <dt>ID</dt>
        <dd className="mono"><CopyText text={src.id} /></dd>
        <dt>Created</dt>
        <dd>{fmtDate(src.created_at)}</dd>
        <dt>Updated</dt>
        <dd>{fmtDate(src.updated_at)}</dd>
      </dl>
    </aside>
  );
}

function Metrics({ src, compact }: { src: Source; compact?: boolean }) {
  const [range, setRange] = useState<RangeKey>(compact ? "1h" : "24h");
  const [bounds, setBounds] = useState(() => rangeBounds(range));
  useEffect(() => setBounds(rangeBounds(range)), [range]);
  const zoom = useZoomRange(range, setRange);

  const hist = useQuery(
    () => api.get<{ buckets: HistogramBucket[]; bucket_seconds: number }>(`/sources/${src.id}/histogram`, { from: bounds.from, to: bounds.to, buckets: 60 }),
    [src.id, bounds],
    15_000,
  );
  const stats = useQuery(() => api.get<SrcStats>(`/sources/${src.id}/stats`, { from: bounds.from, to: bounds.to }), [src.id, bounds], 15_000);
  const st = stats.data;
  const bucketMin = hist.data ? Math.max(1 / 60, (hist.data.bucket_seconds ?? 60) / 60) : 1;
  const ratePoints = (hist.data?.buckets ?? []).map((b) => ({ time: b.time, value: b.total / bucketMin }));
  // gaps (null) where no request was accepted, so the average isn't drawn as a misleading zero
  const avgPoints = (hist.data?.buckets ?? []).map((b) => {
    const acc = (b.status as Record<string, number | undefined>).ACCEPTED ?? 0;
    return { time: b.time, value: acc ? (b.events ?? 0) / acc : null };
  });
  // "current" rate: the most recent complete bucket
  const currentRate = ratePoints.length > 1 ? ratePoints[ratePoints.length - 2].value ?? 0 : 0;

  return (
    <section className="dd-metrics">
      <div className="dd-head">
        <h2>Metrics overview</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <ZoomOut onClick={zoom.back} />
          <RangePicker value={range} onChange={zoom.pick} />
          <button className="btn" onClick={() => setBounds(rangeBounds(range))}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <ErrorBox error={hist.error ?? stats.error} />

      <div className="dd-card">
        <div className="dd-card-head">
          <div>
            <div className="dd-card-title">Requests</div>
            <div className="dd-big">{st ? st.requests.toLocaleString() : "—"}</div>
          </div>
          <Link to={`/requests?source_id=${src.id}`} className="dd-explore">Explore <ArrowUpRight size={15} /></Link>
        </div>
        {hist.data ? (
          <StatusBarChart buckets={hist.data.buckets} from={bounds.from} to={bounds.to} series={REQUEST_SERIES} noun="requests" onSelect={zoom.zoom} />
        ) : (
          <Loading />
        )}
      </div>

      <div className="dd-two">
        <div className="dd-card">
          <div className="dd-card-head">
            <div>
              <div className="dd-card-title">Requests rate</div>
              <div className="dd-big">{hist.data ? fmtNum(currentRate) : "—"} <span className="dd-unit">per minute</span></div>
            </div>
            <Link to={`/requests?source_id=${src.id}`} className="dd-explore faint">Explore <ArrowUpRight size={15} /></Link>
          </div>
          {hist.data ? (
            <LineChart points={ratePoints} from={bounds.from} to={bounds.to} label="Requests / min" format={fmtNum} onSelect={zoom.zoom} />
          ) : (
            <Loading />
          )}
        </div>
        <div className="dd-card">
          <div className="dd-card-head">
            <div>
              <div className="dd-card-title" title="Events created per accepted request: one per connection that accepted it (after filters).">
                Avg. events per request <Info size={13} style={{ verticalAlign: -1 }} />
              </div>
              <div className="dd-big">{st ? (st.accepted ? fmtNum(st.events / st.accepted) : "—") : "—"}</div>
            </div>
          </div>
          {hist.data ? (
            <LineChart points={avgPoints} from={bounds.from} to={bounds.to} label="Events / request" format={fmtNum} onSelect={zoom.zoom} />
          ) : (
            <Loading />
          )}
        </div>
      </div>

      {!compact && (
        <div className="dd-two">
          <div className="dd-card">
            <div className="dd-card-title">Acceptance rate</div>
            {st?.requests ? (
              <>
                <div className="dd-big">{Math.round((st.accepted / st.requests) * 1000) / 10}%</div>
                <div className="faint small">{st.accepted} of {st.requests} requests accepted</div>
              </>
            ) : (
              <div className="dd-nodata">No data to display.</div>
            )}
          </div>
          <div className="dd-card">
            <div className="dd-card-title">Rejections</div>
            {st?.rejections.length ? (
              <table className="table dd-table">
                <thead><tr><th>Reason</th><th style={{ textAlign: "right" }}>Requests</th></tr></thead>
                <tbody>
                  {st.rejections.map((r) => (
                    <tr key={r.response}>
                      <td><Badge tone="danger">{requestStatusLabel("REJECTED", r.response)}</Badge></td>
                      <td className="mono" style={{ textAlign: "right" }}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="dd-nodata">No rejected requests.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ConnectionsTab({ src, conns }: { src: Source; conns?: Connection[] }) {
  if (!conns) return <Loading />;
  if (conns.length === 0)
    return (
      <Empty title="No connections from this source">
        <p>Requests are logged but not delivered anywhere until you add a connection.</p>
        <Link className="btn primary" to={`/connections/new?source_id=${src.id}`}>New connection</Link>
      </Empty>
    );
  return (
    <table className="table">
      <thead><tr><th>Connection</th><th>Destination</th><th>Rules</th><th>Status</th><th /></tr></thead>
      <tbody>
        {conns.map((c) => (
          <tr key={c.id}>
            <td className="mono">{c.name}</td>
            <td className="mono"><Link to={`/destinations/${c.destination_id}`}>{c.destination.name}</Link></td>
            <td><div style={{ display: "flex", gap: 4 }}>{c.rules.map((r) => <span key={r.type} className="rule-pill">{r.type}</span>)}</div></td>
            <td>{c.disabled_at ? <Badge tone="neutral">Disabled</Badge> : c.paused_at ? <Badge tone="warn">Paused</Badge> : <Badge tone="success">Active</Badge>}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <Link className="btn sm" to={`/connections/${c.id}/test`}><Waypoints size={13} /> Test</Link>{" "}
              <Link className="btn sm" to={`/connections/${c.id}/edit`}><Pencil size={13} /> Edit</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingsTab({ src, onEdit, reload }: { src: Source; onEdit: () => void; reload: () => void }) {
  const { run, busy } = useAction();
  const navigate = useNavigate();
  return (
    <div className="settings">
      <section className="settings-card">
        <h2>Configuration</h2>
        <p className="muted" style={{ margin: 0 }}>Name, verification secrets, allowed methods and custom response.</p>
        <div><button className="btn" onClick={onEdit}><Pencil size={14} /> Edit source</button></div>
      </section>
      <section className="settings-card danger-zone">
        <h2>Danger zone</h2>
        <div className="settings-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <strong>{src.disabled_at ? "Enable" : "Disable"} source</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {src.disabled_at ? "The URL accepts requests again." : "The URL answers 410 Gone and nothing is logged until you enable it."}
            </div>
          </div>
          <button className="btn" disabled={busy}
            onClick={() => run(() => api.put(`/sources/${src.id}/${src.disabled_at ? "enable" : "disable"}`), src.disabled_at ? "Source enabled" : "Source disabled").then(reload)}>
            <Power size={14} /> {src.disabled_at ? "Enable" : "Disable"}
          </button>
        </div>
        <div className="settings-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <strong>Delete source</strong>
            <div className="muted" style={{ fontSize: 13 }}>Deletes its connections, requests and events. The URL stops working.</div>
          </div>
          <button className="btn danger" disabled={busy}
            onClick={async () => {
              if (!confirm(`Delete source "${src.name}"? Its connections, requests and events are deleted too.`)) return;
              if (await run(() => api.del(`/sources/${src.id}`).then(() => true), "Source deleted")) navigate("/sources");
            }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </section>
    </div>
  );
}
