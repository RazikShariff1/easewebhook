import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { api, type Connection, type HistogramBucket, type Page, type Source, type WebhookEvent, type WebhookRequest } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, nextRange, requestStatusLabel, tryParseJSON, type RangeKey } from "../lib/format";
import { useWorkspace } from "../lib/workspace";
import { PageHeader } from "../components/Layout";
import { Badge, CopyText, Dropdown, ErrorBox, Loading, useAction, useToast } from "../components/ui";
import { RequestFlow } from "../components/RequestFlow";
import { RequestsEmpty } from "../components/RequestsEmpty";
import { Histogram, RangePicker, rangeBounds, ZoomOut } from "../components/Timeline";
import { useZoomRange } from "../lib/brush";
import { REQUEST_SERIES } from "../components/StatusBarChart";
import { JsonTree } from "../components/JsonTree";
import { SourceTypeIcon } from "../components/SourceIcon";
import { JsonChip } from "./Events";
import { Pager, usePager } from "./Sources";

type Preset = "all" | "accepted" | "rejected";

const CAUSES = [
  { value: "UNSUPPORTED_METHOD", label: "Unsupported Method" },
  { value: "VERIFICATION_FAILED", label: "Verification Failed" },
];
const METHODS = ["POST", "PUT", "PATCH", "DELETE", "GET"];

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------- suggested columns: payload fields seen in the loaded requests ----------

function fieldPaths(r: WebhookRequest): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`, depth + 1);
    } else if (depth > 0) out.push(path);
  };
  walk(r.body, "body", 0);
  for (const k of Object.keys(r.headers ?? {})) out.push(`headers.${k}`);
  return out;
}

function fieldValue(r: WebhookRequest, path: string): string {
  const [root, ...rest] = path.split(".");
  let v: unknown = root === "headers" ? r.headers : r.body;
  if (root === "headers") v = (v as Record<string, string> | undefined)?.[rest.join(".")];
  else for (const k of rest) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  if (v === undefined || v === null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function useColumns(wsId: string) {
  const key = `ew_req_cols:${wsId}`;
  const [cols, setCols] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(cols));
    } catch {
      /* storage unavailable */
    }
  }, [key, cols]);
  return [cols, setCols] as const;
}

// ---------- page ----------

export function RequestsPage({ preset = "all" }: { preset?: Preset }) {
  const [params, setParams] = useSearchParams();
  const { current } = useWorkspace();
  const [range, setRange] = useState<RangeKey>("24h");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [causes, setCauses] = useState<string[]>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>();
  const [bounds, setBounds] = useState(() => rangeBounds(range));
  const [cols, setCols] = useColumns(current.id);
  const pager = usePager();
  const toast = useToast();
  const { run, busy } = useAction();
  const sourceIds = params.get("source_id") ?? "";

  useEffect(() => {
    setStatuses(preset === "accepted" ? ["ACCEPTED"] : preset === "rejected" ? ["REJECTED"] : []);
    setSelected(undefined);
  }, [preset]);
  useEffect(() => setBounds(rangeBounds(range)), [range]);
  const zoom = useZoomRange(range, setRange);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filter = {
    source_id: sourceIds,
    status: statuses.join(","),
    cause: causes.join(","),
    method: methods.join(","),
    search,
    body: body && tryParseJSON(body).ok ? body : "",
    from: bounds.from,
    to: bounds.to,
  };
  const key = JSON.stringify(filter);
  useEffect(() => pager.reset(), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery(() => api.get<Page<WebhookRequest>>("/requests", { ...filter, next: pager.cursor }), [key, pager.cursor], 5000);
  const hist = useQuery(() => api.get<{ buckets: HistogramBucket[] }>("/requests/histogram", { ...filter, buckets: 60 }), [key], 10_000);
  const sources = useQuery(() => api.get<Page<Source>>("/sources", { limit: 250 }), []);
  const srcById = useMemo(() => new Map(sources.data?.models.map((s) => [s.id, s])), [sources.data]);
  const rows = list.data?.models ?? [];
  const total = hist.data?.buckets.reduce((a, b) => a + b.total, 0);
  const filtered = !!(sourceIds || statuses.length || causes.length || methods.length || search || filter.body);
  const isEmpty = !!list.data && rows.length === 0 && !filtered && pager.page === 1;

  const suggestions = useMemo(() => {
    const freq = new Map<string, number>();
    for (const r of rows) for (const f of fieldPaths(r)) freq.set(f, (freq.get(f) ?? 0) + 1);
    return [...freq.entries()]
      .filter(([f]) => !cols.includes(f))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([f]) => f);
  }, [rows, cols]);

  const refresh = () => {
    setBounds(rangeBounds(range));
    list.reload();
    hist.reload();
  };

  const retryOne = async (id: string) => {
    const r = await run(() => api.post<{ events: number; ignored: number }>(`/requests/${id}/retry`));
    if (r) {
      toast(`Retried — ${r.events} event(s) created${r.ignored ? `, ${r.ignored} filtered out` : ""}`);
      refresh();
    }
  };

  const bulkRetry = async () => {
    if (!confirm("Retry every rejected request that matches the current filters? Each is accepted and routed to its connections.")) return;
    const r = await run(() =>
      api.post<{ retried: number; events: number; limit_reached: boolean }>("/bulk/requests/retry", {
        query: { source_id: sourceIds, cause: filter.cause, method: filter.method, search, body: filter.body ? JSON.parse(filter.body) : undefined, from: bounds.from, to: bounds.to },
      }),
    );
    if (r) {
      toast(`${r.retried} request(s) retried, ${r.events} event(s) created${r.limit_reached ? " (limit 500 — run again for more)" : ""}`);
      refresh();
    }
  };

  const setSourceIds = (v: string) => {
    if (v) params.set("source_id", v);
    else params.delete("source_id");
    setParams(params);
  };

  const next = nextRange(range);
  const title = preset === "accepted" ? "Accepted requests" : preset === "rejected" ? "Rejected requests" : "Requests";

  return (
    <>
      <PageHeader title={title} count={total}>
        <Dropdown
          align="right"
          trigger={(_, t) => (
            <button className="btn" onClick={t} disabled={busy}>
              <RotateCcw /> Bulk retry <ChevronDown />
            </button>
          )}
        >
          {(close) => (
            <button className="menu-item" onClick={() => (close(), bulkRetry())}>
              <RotateCcw size={14} /> Retry rejected requests matching the filters
            </button>
          )}
        </Dropdown>
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
        <MultiChip
          icon={<Zap />}
          label="Status"
          options={[{ value: "ACCEPTED", label: "Accepted" }, { value: "REJECTED", label: "Rejected" }]}
          value={statuses}
          onChange={setStatuses}
        />
        <MultiChip
          icon={<Webhook />}
          label="Sources"
          options={(sources.data?.models ?? []).map((s) => ({ value: s.id, label: s.name, icon: <SourceTypeIcon type={s.type} size={14} /> }))}
          value={sourceIds ? sourceIds.split(",") : []}
          onChange={(v) => setSourceIds(v.join(","))}
        />
        <JsonChip label="Request Body" value={body} onChange={setBody} />
        <Dropdown
          trigger={(_, t) => (
            <button className={`chip ${causes.length || methods.length ? "on" : ""}`} onClick={t}>
              <SlidersHorizontal /> More filters {causes.length || methods.length ? <ChevronDown /> : <Plus />}
            </button>
          )}
        >
          {() => (
            <div className="menu-pad" style={{ width: 260 }}>
              <div className="section-title">Rejection reason</div>
              {CAUSES.map((c) => (
                <label key={c.value} className="check" style={{ display: "flex", padding: "4px 0" }}>
                  <input type="checkbox" checked={causes.includes(c.value)}
                    onChange={(e) => setCauses(e.target.checked ? [...causes, c.value] : causes.filter((x) => x !== c.value))} />
                  {c.label}
                </label>
              ))}
              <div className="section-title" style={{ marginTop: 12 }}>HTTP method</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {METHODS.map((m) => (
                  <label key={m} className="check">
                    <input type="checkbox" checked={methods.includes(m)}
                      onChange={(e) => setMethods(e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))} />
                    {m}
                  </label>
                ))}
              </div>
            </div>
          )}
        </Dropdown>
      </div>

      {hist.data && <Histogram buckets={hist.data.buckets} from={bounds.from} to={bounds.to} series={REQUEST_SERIES} onSelect={zoom.zoom} />}

      {rows.length > 0 && (suggestions.length > 0 || cols.length > 0) && (
        <div className="suggest">
          <span className="suggest-title"><Columns3 size={15} /> Suggested columns</span>
          <div className="suggest-list">
            {suggestions.slice(0, 5).map((f) => (
              <button key={f} className="chip mono" onClick={() => setCols([...cols, f])} title={`Add ${f} as a column`}>
                {f} <Plus />
              </button>
            ))}
            {suggestions.length > 5 && (
              <Dropdown
                align="right"
                trigger={(_, t) => <button className="chip" onClick={t}>More columns <Plus /></button>}
              >
                {(close) => (
                  <div style={{ maxHeight: 280, overflow: "auto", width: 280 }}>
                    {suggestions.slice(5).map((f) => (
                      <button key={f} className="menu-item mono" onClick={() => (setCols([...cols, f]), close())}>{f}</button>
                    ))}
                  </div>
                )}
              </Dropdown>
            )}
          </div>
        </div>
      )}

      <div className={`split ${selected ? "with-panel" : ""}`} style={{ minHeight: 0 }}>
        <div className="content">
          <ErrorBox error={list.error} />
          {list.loading && !list.data ? (
            <Loading />
          ) : isEmpty ? (
            <RequestsEmpty sourceUrl={sources.data?.models[0]?.url} />
          ) : (
            <table className="table req-table">
              <thead>
                <tr>
                  <th style={{ width: 210 }}>Request Date</th>
                  <th style={{ width: 230 }}>Status</th>
                  <th>Source</th>
                  {cols.map((c) => (
                    <th key={c} className="mono col-custom">
                      {c}
                      <button className="col-x" onClick={() => setCols(cols.filter((x) => x !== c))} aria-label={`Remove column ${c}`}><X size={12} /></button>
                    </th>
                  ))}
                  <th style={{ width: 130 }}>Created Events</th>
                  <th style={{ width: 130 }}>Ignored Events</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = srcById.get(r.source_id);
                  const rejected = r.status === "REJECTED";
                  return (
                    <tr key={r.id} className={`clickable ${selected === r.id ? "selected" : ""}`} onClick={() => setSelected(selected === r.id ? undefined : r.id)}>
                      <td className="mono nowrap">
                        <span className="req-lead">
                          {rejected ? <AlertCircle size={15} className="danger-icon" /> : <ChevronRight size={15} className={`req-chev ${selected === r.id ? "open" : ""}`} />}
                          {stamp(r.ingested_at)}
                        </span>
                      </td>
                      <td>
                        <span className="req-status">
                          <span className={`badge ${rejected ? "danger" : "success"} with-icon`}>
                            {rejected ? <AlertCircle size={12} /> : <Check size={12} />} {requestStatusLabel(r.status, r.rejection_cause)}
                          </span>
                          {rejected && (
                            <button className="btn icon ghost sm" title="Retry: accept this request and route it" aria-label="Retry request"
                              onClick={(e) => (e.stopPropagation(), retryOne(r.id))}>
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </span>
                      </td>
                      <td>{s ? <span className="tag sm">{s.name}</span> : <span className="faint mono">Source deleted</span>}</td>
                      {cols.map((c) => (
                        <td key={c} className="mono truncate" style={{ maxWidth: 220 }} title={fieldValue(r, c)}>{fieldValue(r, c) || <span className="faint">—</span>}</td>
                      ))}
                      <td className="mono">{r.events_count}</td>
                      <td className="mono">{r.ignored_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {list.data && !list.data.next && (
            <div className="end-of-range">
              {rows.length === 0 ? "No requests in the selected date range." : "You've reached the end of the selected date range."}
              {next && (
                <button className="link-btn" onClick={() => setRange(next.key)}>
                  Expand to {next.label.replace(/^Last /, "")}
                </button>
              )}
            </div>
          )}
        </div>
        {selected && <RequestPanel id={selected} onClose={() => setSelected(undefined)} onRetry={retryOne} />}
      </div>
      <Pager label="requests" count={rows.length} page={pager.page} next={list.data?.next} onNext={() => pager.next(list.data?.next)} onPrev={pager.prev} />
    </>
  );
}

function MultiChip({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  options: { value: string; label: string; icon?: React.ReactNode }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const names = value.map((v) => options.find((o) => o.value === v)?.label ?? v);
  return (
    <Dropdown
      trigger={(_, t) => (
        <button className={`chip ${value.length ? "on" : ""}`} onClick={t}>
          {icon} {label}
          {value.length ? `: ${names.length > 2 ? `${names.length} selected` : names.join(", ")}` : ""} {value.length ? <ChevronDown /> : <Plus />}
        </button>
      )}
    >
      {() => (
        <>
          {options.length === 0 && <div className="menu-pad muted">Nothing to filter by yet.</div>}
          {options.map((o) => (
            <button key={o.value} className="menu-item" onClick={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])}>
              <span className="check">{value.includes(o.value) && <Check size={14} />}</span>
              {o.icon}
              {o.label}
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

function RequestPanel({ id, onClose, onRetry }: { id: string; onClose: () => void; onRetry: (id: string) => void }) {
  const req = useQuery(() => api.get<WebhookRequest>(`/requests/${id}`), [id], 5000);
  const events = useQuery(() => api.get<Page<WebhookEvent>>(`/requests/${id}/events`), [id], 4000);
  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { limit: 250 }), []);
  const source = useQuery(() => (req.data?.source_id ? api.get<Source>(`/sources/${req.data.source_id}`) : Promise.resolve(undefined)), [req.data?.source_id]);
  const [tab, setTab] = useState<"body" | "headers">("body");
  const r = req.data;

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="title"><CopyText text={id} /></span>
        <span style={{ flex: 1 }} />
        {r?.status === "REJECTED" && (
          <button className="btn sm primary" onClick={() => onRetry(id)}><RotateCcw size={13} /> Retry</button>
        )}
        <button className="btn icon ghost" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <ErrorBox error={req.error} />
      {!r ? (
        <Loading />
      ) : (
        <div className="panel-body">
          <dl className="kv">
            <dt>Status</dt>
            <dd><Badge tone={r.status === "ACCEPTED" ? "success" : "danger"}>{requestStatusLabel(r.status, r.rejection_cause)}</Badge></dd>
            {r.rejection_cause && (<><dt>Reason</dt><dd className="mono">{r.rejection_cause}</dd></>)}
            <dt>Method / path</dt>
            <dd className="mono">{r.method} {r.path || "/"}{r.query ? `?${r.query}` : ""}</dd>
            <dt>Verified</dt>
            <dd>{r.verified == null ? "—" : r.verified ? "Yes" : "No"}</dd>
            <dt>Content type</dt>
            <dd className="mono">{r.content_type ?? "—"}</dd>
            <dt>Source IP</dt>
            <dd className="mono">{r.original_ip ?? "—"}</dd>
            <dt>Received</dt>
            <dd>{fmtDate(r.ingested_at)}</dd>
          </dl>
          <div>
            <div className="tabs">
              <button className={tab === "body" ? "on" : ""} onClick={() => setTab("body")}>Body</button>
              <button className={tab === "headers" ? "on" : ""} onClick={() => setTab("headers")}>Headers</button>
            </div>
            <div className="code" style={{ borderTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <JsonTree key={`${id}-${tab}`} value={tab === "body" ? r.body : r.headers} />
            </div>
          </div>
          <div>
            <div className="section-title">Flow</div>
            <RequestFlow request={r} source={source.data} events={events.data?.models ?? []} connections={conns.data?.models ?? []} />
          </div>
        </div>
      )}
    </aside>
  );
}
