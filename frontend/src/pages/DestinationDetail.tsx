import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Pencil, Power, RefreshCw, Trash2, Waypoints, Zap } from "lucide-react";
import { api, type Connection, type Destination, type HistogramBucket, type Page } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, timeAgo, type RangeKey } from "../lib/format";
import { Badge, CopyText, Empty, ErrorBox, HttpBadge, Loading, useAction } from "../components/ui";
import { ConnectionGraph } from "../components/ConnectionGraph";
import { DestinationForm } from "../components/forms";
import { RangePicker, rangeBounds, ZoomOut } from "../components/Timeline";
import { useZoomRange } from "../lib/brush";
import { StatusBarChart } from "../components/StatusBarChart";
import { DEST_TYPES, DestinationIcon } from "../components/DestinationIcon";

type Tab = "overview" | "metrics" | "connections" | "settings";

interface DestStats {
  pending: number;
  oldest_pending_at: string | null;
  responses: { response: string; count: number }[];
  connections: number;
}

const AUTH: Record<string, string> = {
  NONE: "None",
  BEARER_TOKEN: "Bearer token",
  BASIC_AUTH: "Basic auth",
  API_KEY: "API key",
  EASE_SIGNATURE: "EaseWebhook signature",
};

export function DestinationDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const [editing, setEditing] = useState(false);
  const d = useQuery(() => api.get<Destination>(`/destinations/${id}`), [id]);
  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { destination_id: id, limit: 250 }), [id]);

  const setTab = (t: Tab) => {
    params.set("tab", t);
    setParams(params, { replace: true });
  };

  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const dest = d.data;

  return (
    <>
      <header className="page-header">
        <h1 className="crumbs">
          <Link to="/destinations" className="muted">Destinations</Link>
          <span className="faint">/</span>
          <span>{dest.name}</span>
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
        {tab === "overview" && <ConnectionGraph focus="destination" entity={dest} connections={conns.data?.models ?? []} />}
        {tab === "overview" && (
          <div className="dd-grid">
            <DetailsPanel dest={dest} onEdit={() => setEditing(true)} />
            <MetricsPanel dest={dest} compact />
          </div>
        )}
        {tab === "metrics" && <div className="dd-pad"><MetricsPanel dest={dest} /></div>}
        {tab === "connections" && <ConnectionsTab conns={conns.data?.models} />}
        {tab === "settings" && <SettingsTab dest={dest} onEdit={() => setEditing(true)} reload={d.reload} />}
      </div>

      {editing && (
        <DestinationForm destination={dest} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), d.reload())} />
      )}
    </>
  );
}

function DetailsPanel({ dest, onEdit }: { dest: Destination; onEdit: () => void }) {
  return (
    <aside className="dd-details">
      <div className="dd-head">
        <h2>Destination details</h2>
        <button className="btn" onClick={onEdit}><Pencil size={14} /> Edit</button>
      </div>
      <dl className="dd-list">
        <dt>Status</dt>
        <dd>
          {dest.disabled_at ? (
            <Badge tone="neutral">Disabled</Badge>
          ) : (
            <span className="badge success" style={{ display: "inline-flex", gap: 4 }}><Zap size={12} /> Active</span>
          )}
        </dd>
        <dt>Name</dt>
        <dd className="mono"><CopyText text={dest.name} /></dd>
      </dl>
      <hr />
      <h3>Configuration</h3>
      <dl className="dd-list">
        <dt>Type</dt>
        <dd><span className="chip-static"><DestinationIcon type={dest.type} size={14} /> {DEST_TYPES.find((t) => t.value === dest.type)?.label ?? "HTTP"}</span></dd>
        <dt>Endpoint URL</dt>
        <dd className="mono" style={{ wordBreak: "break-all" }}><CopyText text={dest.url} /></dd>
        <dt>HTTP method</dt>
        <dd><span className="chip-static">{dest.http_method ?? "Matching request"}</span></dd>
        <dt>Max delivery rate</dt>
        <dd><span className="chip-static">{dest.rate_limit ? `${dest.rate_limit} / ${dest.rate_limit_period}` : "None"}</span></dd>
        <dt>Authentication method</dt>
        <dd><span className="chip-static">{AUTH[dest.auth_type] ?? dest.auth_type}</span></dd>
        <dt>Path forwarding</dt>
        <dd>{dest.path_forwarding ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}</dd>
      </dl>
      <hr />
      <h3>Metadata</h3>
      <dl className="dd-list">
        <dt>ID</dt>
        <dd className="mono"><CopyText text={dest.id} /></dd>
        <dt>Created</dt>
        <dd>{fmtDate(dest.created_at)}</dd>
        <dt>Updated</dt>
        <dd>{fmtDate(dest.updated_at)}</dd>
      </dl>
    </aside>
  );
}

function MetricsPanel({ dest, compact }: { dest: Destination; compact?: boolean }) {
  const [range, setRange] = useState<RangeKey>(compact ? "1h" : "24h");
  const [bounds, setBounds] = useState(() => rangeBounds(range));
  useEffect(() => setBounds(rangeBounds(range)), [range]);
  const zoom = useZoomRange(range, setRange);

  const hist = useQuery(
    () => api.get<{ buckets: HistogramBucket[] }>("/events/histogram", { destination_id: dest.id, from: bounds.from, to: bounds.to, buckets: 60 }),
    [dest.id, bounds],
    15_000,
  );
  const stats = useQuery(() => api.get<DestStats>(`/destinations/${dest.id}/stats`, { from: bounds.from, to: bounds.to }), [dest.id, bounds], 15_000);
  const total = hist.data?.buckets.reduce((a, b) => a + b.total, 0) ?? 0;
  const refresh = () => setBounds(rangeBounds(range));
  const delivered = stats.data?.responses.filter((r) => /^2\d\d$/.test(r.response)).reduce((a, r) => a + r.count, 0) ?? 0;
  const attempted = stats.data?.responses.filter((r) => r.response !== "none").reduce((a, r) => a + r.count, 0) ?? 0;

  return (
    <section className="dd-metrics">
      <div className="dd-head">
        <h2>Metrics overview</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <ZoomOut onClick={zoom.back} />
          <RangePicker value={range} onChange={zoom.pick} />
          <button className="btn" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <ErrorBox error={hist.error ?? stats.error} />

      <div className="dd-card">
        <div className="dd-card-head">
          <div>
            <div className="dd-card-title">Events</div>
            <div className="dd-big">{hist.data ? total.toLocaleString() : "—"}</div>
          </div>
          <Link to={`/events?destination_id=${dest.id}`} className="dd-explore">Explore <ArrowUpRight size={15} /></Link>
        </div>
        {hist.data ? <StatusBarChart buckets={hist.data.buckets} from={bounds.from} to={bounds.to} onSelect={zoom.zoom} /> : <Loading />}
      </div>

      <div className="dd-two">
        <div className="dd-card">
          <div className="dd-card-title" title="Events queued, scheduled for retry, or held because the connection is paused.">Pending events</div>
          {stats.data && stats.data.pending > 0 ? (
            <div className="dd-big">{stats.data.pending.toLocaleString()}</div>
          ) : (
            <div className="dd-nodata">No data to display.</div>
          )}
        </div>
        <div className="dd-card">
          <div className="dd-card-title" title="How long the oldest undelivered event has been waiting.">Oldest pending event</div>
          {stats.data?.oldest_pending_at ? (
            <>
              <div className="dd-big">{timeAgo(stats.data.oldest_pending_at).replace(" ago", "")}</div>
              <div className="faint small">since {fmtDate(stats.data.oldest_pending_at)}</div>
            </>
          ) : (
            <div className="dd-nodata">No data to display.</div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="dd-two">
          <div className="dd-card">
            <div className="dd-card-title">Delivery success rate</div>
            {attempted ? (
              <>
                <div className="dd-big">{Math.round((delivered / attempted) * 1000) / 10}%</div>
                <div className="faint small">{delivered} of {attempted} events delivered with a 2xx response</div>
              </>
            ) : (
              <div className="dd-nodata">No data to display.</div>
            )}
          </div>
          <div className="dd-card">
            <div className="dd-card-title">Responses</div>
            {stats.data?.responses.length ? (
              <table className="table dd-table">
                <thead><tr><th>Response</th><th style={{ textAlign: "right" }}>Events</th></tr></thead>
                <tbody>
                  {stats.data.responses.map((r) => (
                    <tr key={r.response}>
                      <td>
                        {/^\d+$/.test(r.response) ? <HttpBadge code={Number(r.response)} /> : r.response === "none" ? <span className="faint">Not attempted yet</span> : <HttpBadge code={null} error={r.response} />}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="dd-nodata">No data to display.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ConnectionsTab({ conns }: { conns?: Connection[] }) {
  if (!conns) return <Loading />;
  if (conns.length === 0) return <Empty title="No connections use this destination" />;
  return (
    <table className="table">
      <thead><tr><th>Connection</th><th>Source</th><th>Rules</th><th>Status</th><th /></tr></thead>
      <tbody>
        {conns.map((c) => (
          <tr key={c.id}>
            <td className="mono">{c.name}</td>
            <td className="mono">{c.source.name}</td>
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

function SettingsTab({ dest, onEdit, reload }: { dest: Destination; onEdit: () => void; reload: () => void }) {
  const { run, busy } = useAction();
  const navigate = useNavigate();
  return (
    <div className="settings">
      <section className="settings-card">
        <h2>Configuration</h2>
        <p className="muted" style={{ margin: 0 }}>Endpoint, HTTP method, authentication, rate limit and path forwarding.</p>
        <div><button className="btn" onClick={onEdit}><Pencil size={14} /> Edit destination</button></div>
      </section>
      <section className="settings-card danger-zone">
        <h2>Danger zone</h2>
        <div className="settings-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <strong>{dest.disabled_at ? "Enable" : "Disable"} destination</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {dest.disabled_at ? "Held events are released and delivered." : "New events are held until the destination is enabled again."}
            </div>
          </div>
          <button className="btn" disabled={busy}
            onClick={() => run(() => api.put(`/destinations/${dest.id}/${dest.disabled_at ? "enable" : "disable"}`), dest.disabled_at ? "Destination enabled" : "Destination disabled").then(reload)}>
            <Power size={14} /> {dest.disabled_at ? "Enable" : "Disable"}
          </button>
        </div>
        <div className="settings-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <strong>Delete destination</strong>
            <div className="muted" style={{ fontSize: 13 }}>Deletes its connections and their events too.</div>
          </div>
          <button className="btn danger" disabled={busy}
            onClick={async () => {
              if (!confirm(`Delete destination "${dest.name}"? Its connections and events are deleted too.`)) return;
              if (await run(() => api.del(`/destinations/${dest.id}`).then(() => true), "Destination deleted")) navigate("/destinations");
            }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </section>
    </div>
  );
}
