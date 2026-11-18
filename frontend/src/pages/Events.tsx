import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Braces, Check, ChevronDown, Network, Plus, RefreshCw, RotateCcw, Search, Save, X, XCircle, Zap } from "lucide-react";
import {
  api,
  type Attempt,
  type Connection,
  type EventStatus,
  type HistogramBucket,
  type Page,
  type WebhookEvent,
} from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, pretty, timeAgo, tryParseJSON, type RangeKey } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { CopyText, Dropdown, Empty, ErrorBox, HttpBadge, Loading, StatusBadge, useAction, useToast } from "../components/ui";
import { Histogram, RangePicker, rangeBounds, ZoomOut } from "../components/Timeline";
import { useZoomRange } from "../lib/brush";
import { Pager, usePager } from "./Sources";

const STATUSES: EventStatus[] = ["SUCCESSFUL", "FAILED", "QUEUED", "SCHEDULED", "HOLD", "CANCELLED"];

type Preset = "all" | "failed" | "paused";

export function EventsPage({ preset }: { preset: Preset }) {
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<RangeKey>("24h");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statuses, setStatuses] = useState<EventStatus[]>([]);
  const [body, setBody] = useState("");
  const [responseStatus, setResponseStatus] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [selected, setSelected] = useState<string>();
  const pager = usePager();
  const { run, busy } = useAction();
  const alertToast = useToast();

  const connectionIds = params.get("connection_id") ?? "";
  const destinationId = params.get("destination_id") ?? "";
  const sourceId = params.get("source_id") ?? "";
  const requestId = params.get("request_id") ?? "";

  // reset local filters when switching between All / Failed / Paused
  useEffect(() => {
    setStatuses(preset === "failed" ? ["FAILED"] : preset === "paused" ? ["HOLD"] : []);
    setSelected(undefined);
    pager.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // debounce free-text search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [bounds, setBounds] = useState(() => rangeBounds(range));
  useEffect(() => setBounds(rangeBounds(range)), [range]);
  const zoom = useZoomRange(range, setRange);

  const filter = useMemo(
    () => ({
      status: statuses.join(","),
      connection_id: connectionIds,
      destination_id: destinationId,
      source_id: sourceId,
      request_id: requestId,
      search,
      body: body && tryParseJSON(body).ok ? body : "",
      response_status: responseStatus,
      error_code: errorCode,
      from: bounds.from,
      to: bounds.to,
    }),
    [statuses, connectionIds, destinationId, sourceId, requestId, search, body, responseStatus, errorCode, bounds],
  );
  const key = JSON.stringify(filter);

  const events = useQuery(() => api.get<Page<WebhookEvent>>("/events", { ...filter, next: pager.cursor }), [key, pager.cursor], 5000);
  const hist = useQuery(
    () => api.get<{ bucket_seconds: number; buckets: HistogramBucket[] }>("/events/histogram", { ...filter, buckets: 60 }),
    [key],
    10_000,
  );
  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { limit: 250 }), []);
  const connById = useMemo(() => new Map(conns.data?.models.map((c) => [c.id, c])), [conns.data]);

  useEffect(() => pager.reset(), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    setBounds(rangeBounds(range));
    events.reload();
    hist.reload();
  };

  const bulkQuery = {
    status: filter.status,
    connection_id: connectionIds,
    destination_id: destinationId,
    source_id: sourceId,
    search,
    body: filter.body ? JSON.parse(filter.body) : undefined,
    response_status: responseStatus,
    error_code: errorCode,
    from: bounds.from,
    to: bounds.to,
  };

  const bulkRetry = async () => {
    const label = statuses.length ? statuses.join(", ").toLowerCase() : "failed";
    if (!confirm(`Retry all ${label} events matching the current filters?`)) return;
    const r = await run(() => api.post<{ queued: number }>("/bulk/events/retry", { query: bulkQuery }));
    if (r) {
      alertToast(`${r.queued} event(s) queued for retry`);
      refresh();
    }
  };

  const bulkCancel = async () => {
    if (!confirm("Cancel all pending (queued, scheduled, held) events matching the current filters?")) return;
    const r = await run(() => api.post<{ cancelled: number }>("/bulk/events/cancel", { query: bulkQuery }));
    if (r) {
      alertToast(`${r.cancelled} event(s) cancelled`);
      refresh();
    }
  };


  const title = preset === "failed" ? "Failed events" : preset === "paused" ? "Paused events" : "Events";
  const rows = events.data?.models ?? [];
  const total = hist.data?.buckets.reduce((a, b) => a + b.total, 0);

  const clearParam = (k: string) => {
    params.delete(k);
    setParams(params);
  };

  return (
    <>
      <PageHeader title={title} count={total}>
        <div className="btn-group">
          <button className="btn" onClick={bulkCancel} disabled={busy}><XCircle /> Bulk cancel</button>
          <button className="btn" onClick={bulkRetry} disabled={busy}><RotateCcw /> Bulk retry</button>
        </div>
        <button className="btn" onClick={refresh}><RefreshCw /> Refresh</button>
        <button className="btn" disabled title="Saved views are coming soon"><Save /> Save view</button>
      </PageHeader>

      <div className="toolbar">
        <ZoomOut onClick={zoom.back} />
        <RangePicker value={range} onChange={zoom.pick} />
        <div className="search">
          <Search />
          <input className="input" placeholder="Search payload fields" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <span style={{ width: 1, height: 22, background: "var(--border)" }} />
        <StatusChip value={statuses} onChange={setStatuses} />
        <ConnectionChip conns={conns.data?.models ?? []} value={connectionIds} onChange={(v) => {
          if (v) params.set("connection_id", v); else params.delete("connection_id");
          setParams(params);
        }} />
        <JsonChip label="Request Body" value={body} onChange={setBody} />
        <MoreFilters responseStatus={responseStatus} setResponseStatus={setResponseStatus} errorCode={errorCode} setErrorCode={setErrorCode} />
        {[["destination_id", destinationId], ["source_id", sourceId], ["request_id", requestId]].map(([k, v]) =>
          v ? (
            <span key={k} className="chip on" onClick={() => clearParam(k)}>
              {k.replace("_id", "")}: <code>{v}</code> <X />
            </span>
          ) : null,
        )}
      </div>

      {hist.data && <Histogram buckets={hist.data.buckets} from={bounds.from} to={bounds.to} onSelect={zoom.zoom} />}

      <div className={`split ${selected ? "with-panel" : ""}`} style={{ minHeight: 0 }}>
        <div className="content">
          <ErrorBox error={events.error} />
          {events.loading && !events.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty title="No matching events found">
              <ZoomOut onClick={zoom.back} />
        <RangePicker value={range} onChange={zoom.pick} />
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Response</th>
                  <th>Event</th>
                  <th>Connection</th>
                  <th>Attempts</th>
                  <th>Next attempt</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const c = connById.get(e.connection_id);
                  return (
                    <tr key={e.id} className={`clickable ${selected === e.id ? "selected" : ""}`} onClick={() => setSelected(e.id)}>
                      <td><StatusBadge status={e.status} /></td>
                      <td><HttpBadge code={e.response_status} error={e.response_status ? null : e.error_code} /></td>
                      <td className="mono">{e.id}</td>
                      <td className="mono truncate">{c ? c.full_name : e.connection_id}</td>
                      <td>{e.attempts}</td>
                      <td className="muted nowrap">
                        {e.status === "SCHEDULED" || e.status === "QUEUED" ? timeAgo(e.next_attempt_at) : "—"}
                      </td>
                      <td className="muted nowrap">{fmtDate(e.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {selected && (
          <EventPanel
            id={selected}
            conn={connById.get(rows.find((r) => r.id === selected)?.connection_id ?? "")}
            onClose={() => setSelected(undefined)}
            onChanged={refresh}
          />
        )}
      </div>
      <Pager label="events" count={rows.length} page={pager.page} next={events.data?.next} onNext={() => pager.next(events.data?.next)} onPrev={pager.prev} />
    </>
  );
}

// ---------------- filter chips ----------------

function StatusChip({ value, onChange }: { value: EventStatus[]; onChange: (v: EventStatus[]) => void }) {
  return (
    <Dropdown
      trigger={(_, t) => (
        <button className={`chip ${value.length ? "on" : ""}`} onClick={t}>
          <Zap /> Status {value.length ? `: ${value.map((s) => s.toLowerCase()).join(", ")}` : ""} {value.length ? <ChevronDown /> : <Plus />}
        </button>
      )}
    >
      {() => (
        <>
          {STATUSES.map((s) => (
            <button key={s} className="menu-item" onClick={() => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s])}>
              <span className="check">{value.includes(s) && <Check size={14} />}</span>
              <StatusBadge status={s} />
            </button>
          ))}
          {value.length > 0 && (
            <>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => onChange([])}>Clear</button>
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

function ConnectionChip({ conns, value, onChange }: { conns: Connection[]; value: string; onChange: (v: string) => void }) {
  const selected = value ? value.split(",") : [];
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.join(","));
  };
  return (
    <Dropdown
      trigger={(_, t) => (
        <button className={`chip ${selected.length ? "on" : ""}`} onClick={t}>
          <Network /> Connections {selected.length ? `: ${selected.length}` : ""} {selected.length ? <ChevronDown /> : <Plus />}
        </button>
      )}
    >
      {() => (
        <>
          {conns.length === 0 && <div className="menu-pad muted">No connections</div>}
          {conns.map((c) => (
            <button key={c.id} className="menu-item" onClick={() => toggle(c.id)}>
              <span className="check">{selected.includes(c.id) && <Check size={14} />}</span>
              <span className="mono">{c.full_name}</span>
            </button>
          ))}
          {selected.length > 0 && (
            <>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => onChange("")}>Clear</button>
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

export function JsonChip({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const parsed = tryParseJSON(draft);
  return (
    <Dropdown
      trigger={(_, t) => (
        <button className={`chip ${value ? "on" : ""}`} onClick={() => (setDraft(value), t())}>
          <Braces /> {label} {value ? <ChevronDown /> : <Plus />}
        </button>
      )}
    >
      {(close) => (
        <div className="menu-pad" style={{ width: 340, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="faint" style={{ fontSize: 12 }}>Matches events whose JSON body contains this object.</span>
          <textarea className="textarea" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='{"type": "order.created"}' autoFocus />
          {!parsed.ok && <span className="form-error">{parsed.error}</span>}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button className="btn sm" onClick={() => (onChange(""), close())}>Clear</button>
            <button className="btn sm primary" disabled={!parsed.ok} onClick={() => (onChange(draft.trim()), close())}>Apply</button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function MoreFilters(p: { responseStatus: string; setResponseStatus: (v: string) => void; errorCode: string; setErrorCode: (v: string) => void }) {
  const active = !!(p.responseStatus || p.errorCode);
  return (
    <Dropdown
      trigger={(_, t) => (
        <button className={`chip ${active ? "on" : ""}`} onClick={t}>
          More filters {active ? <ChevronDown /> : <Plus />}
        </button>
      )}
    >
      {() => (
        <div className="menu-pad" style={{ width: 280, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label>Response status</label>
            <input className="input" placeholder="e.g. 500,502" value={p.responseStatus} onChange={(e) => p.setResponseStatus(e.target.value)} />
          </div>
          <div className="field">
            <label>Error code</label>
            <input className="input" placeholder="e.g. TIMEOUT, HTTP_500" value={p.errorCode} onChange={(e) => p.setErrorCode(e.target.value)} />
          </div>
        </div>
      )}
    </Dropdown>
  );
}

// ---------------- detail panel ----------------

function EventPanel({ id, conn, onClose, onChanged }: { id: string; conn?: Connection; onClose: () => void; onChanged: () => void }) {
  const ev = useQuery(() => api.get<WebhookEvent>(`/events/${id}`), [id], 4000);
  const attempts = useQuery(() => api.get<Page<Attempt>>(`/events/${id}/attempts`), [id], 4000);
  const [tab, setTab] = useState<"body" | "headers">("body");
  const [openAttempt, setOpenAttempt] = useState<string>();
  const { run, busy } = useAction();

  const e = ev.data;
  const reloadAll = () => {
    ev.reload();
    attempts.reload();
    onChanged();
  };
  const pending = e && ["QUEUED", "SCHEDULED", "HOLD"].includes(e.status);

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="title"><CopyText text={id} /></span>
        <span style={{ flex: 1 }} />
        {pending && (
          <button className="btn sm" disabled={busy} onClick={() => run(() => api.post(`/events/${id}/cancel`), "Event cancelled").then(reloadAll)}>
            <XCircle /> Cancel
          </button>
        )}
        <button className="btn sm primary" disabled={busy} onClick={() => run(() => api.post(`/events/${id}/retry`), "Retry queued").then(reloadAll)}>
          <RotateCcw /> Retry
        </button>
        <button className="btn icon ghost" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      {!e ? (
        <Loading />
      ) : (
        <div className="panel-body">
          <dl className="kv">
            <dt>Status</dt>
            <dd><StatusBadge status={e.status} /></dd>
            <dt>Connection</dt>
            <dd className="mono">{conn?.full_name ?? e.connection_id}</dd>
            <dt>Destination</dt>
            <dd className="mono">{conn?.destination.url ?? e.destination_id}</dd>
            <dt>Request</dt>
            <dd className="mono"><CopyText text={e.request_id} /></dd>
            <dt>Method / path</dt>
            <dd className="mono">{e.method} {e.path || "/"}{e.query ? `?${e.query}` : ""}</dd>
            <dt>Attempts</dt>
            <dd>{e.attempts}</dd>
            {e.next_attempt_at && (e.status === "SCHEDULED" || e.status === "QUEUED") && (
              <>
                <dt>Next attempt</dt>
                <dd>{fmtDate(e.next_attempt_at)} ({timeAgo(e.next_attempt_at)})</dd>
              </>
            )}
            <dt>Created</dt>
            <dd>{fmtDate(e.created_at)}</dd>
          </dl>

          <div>
            <div className="tabs">
              <button className={tab === "body" ? "on" : ""} onClick={() => setTab("body")}>Body</button>
              <button className={tab === "headers" ? "on" : ""} onClick={() => setTab("headers")}>Headers</button>
            </div>
            <pre className="code" style={{ borderTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              {tab === "body" ? pretty(e.body) || <span className="faint">(empty)</span> : pretty(e.headers)}
            </pre>
          </div>

          <div>
            <div className="section-title">Attempts</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {attempts.data?.models.length === 0 && <span className="faint">No attempts yet.</span>}
              {attempts.data?.models.map((a) => {
                const open = openAttempt === a.id;
                return (
                  <div key={a.id} className={`attempt ${open ? "open" : ""}`} onClick={() => setOpenAttempt(open ? undefined : a.id)}>
                    <div className="attempt-row">
                      <span className="mono faint">#{a.attempt_number}</span>
                      <HttpBadge code={a.response_status} error={a.response_status ? null : a.error_code} />
                      <span className="muted" style={{ fontSize: 12 }}>{a.trigger.toLowerCase()}</span>
                      <span style={{ flex: 1 }} />
                      {a.duration_ms != null && <span className="faint mono">{a.duration_ms}ms</span>}
                      <span className="muted nowrap">{fmtDate(a.created_at)}</span>
                    </div>
                    {open && (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }} onClick={(ev) => ev.stopPropagation()}>
                        <div className="mono muted" style={{ fontSize: 12, wordBreak: "break-all" }}>{a.http_method} {a.requested_url}</div>
                        {a.error_message && <div className="form-error">{a.error_message}</div>}
                        <div>
                          <div className="section-title">Response body</div>
                          <pre className="code">{a.response_body || "(empty)"}</pre>
                        </div>
                        {a.response_headers && (
                          <div>
                            <div className="section-title">Response headers</div>
                            <pre className="code">{pretty(a.response_headers)}</pre>
                          </div>
                        )}
                        {a.request_headers && (
                          <div>
                            <div className="section-title">Request headers sent</div>
                            <pre className="code">{pretty(a.request_headers)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
