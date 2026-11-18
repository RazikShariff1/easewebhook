import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Attempt, type Page, type WebhookEvent } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, timeAgo } from "../lib/format";
import { HttpBadge, StatusBadge } from "./ui";
import { JsonTree } from "./JsonTree";

type Tab = "reqHeaders" | "reqBody" | "resBody" | "meta";

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseMaybeJSON(s?: string | null): unknown {
  if (!s) return s;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Two-pane outbound events inspector: events table on the left, the selected delivery's details on the right. */
export function OutboundEvents({ evts }: { evts: WebhookEvent[] }) {
  const [sel, setSel] = useState<string>();
  const [tab, setTab] = useState<Tab>("reqHeaders");
  const e = evts.find((x) => x.id === sel) ?? evts[0];

  // Full event (with body) and its latest attempt; refreshed while the delivery is in flight.
  const pending = e.status === "QUEUED" || e.status === "SCHEDULED";
  const full = useQuery(() => api.get<WebhookEvent>(`/events/${e.id}`), [e.id, e.attempts, e.status], pending ? 2000 : undefined);
  const atts = useQuery(() => api.get<Page<Attempt>>(`/events/${e.id}/attempts`, { limit: 1 }), [e.id, e.attempts], pending ? 2000 : undefined);
  const a = atts.data?.models[0];

  const tabs: [Tab, string][] = [["reqHeaders", "Request Headers"], ["reqBody", "Request Body"], ["resBody", "Response Body"], ["meta", "Metadata"]];

  return (
    <div className="rq">
      <div className="rq-table">
        <div className="rq-head three"><span>Event Date</span><span>Event Status</span><span>Next Delivery Attempt</span></div>
        <div className="rq-rows" role="listbox" aria-label="Outbound events">
          {evts.map((x) => (
            <div
              key={x.id}
              role="option"
              tabIndex={0}
              aria-selected={x.id === e.id}
              className={`rq-row three ${x.id === e.id ? "sel" : ""}`}
              onClick={() => setSel(x.id)}
              onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setSel(x.id))}
            >
              <span className="mono">{stamp(x.created_at)}</span>
              <span className="rq-status">
                <StatusBadge status={x.status} />
                {x.response_status != null && <HttpBadge code={x.response_status} />}
              </span>
              <span className="rq-status mono">
                {(x.status === "SCHEDULED" || x.status === "QUEUED") && x.next_attempt_at ? timeAgo(x.next_attempt_at) : "–"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rq-detail">
        <div className="rq-head"><span>Event Details</span></div>
        <div className="tabs" style={{ padding: "0 12px" }}>
          {tabs.map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="rq-detail-body">
          {tab === "reqHeaders" &&
            (a?.request_headers ? (
              <HeaderList headers={a.request_headers} />
            ) : (
              <span className="faint small">{pending ? "Delivery in progress…" : "No delivery attempt yet."}</span>
            ))}
          {tab === "reqBody" && <JsonTree key={`${e.id}-b`} value={full.data?.body} />}
          {tab === "resBody" &&
            (a ? (
              <>
                {a.error_message && <div className="form-error" style={{ marginBottom: 8 }}>{a.error_message}</div>}
                <JsonTree key={`${e.id}-r`} value={parseMaybeJSON(a.response_body)} />
              </>
            ) : (
              <span className="faint small">No response yet.</span>
            ))}
          {tab === "meta" && (
            <dl className="kv">
              <dt>Event ID</dt><dd className="mono">{e.id}</dd>
              <dt>Request ID</dt><dd className="mono">{e.request_id}</dd>
              <dt>Status</dt><dd><StatusBadge status={e.status} /></dd>
              <dt>Attempts</dt><dd>{e.attempts}</dd>
              <dt>Response</dt><dd><HttpBadge code={a?.response_status ?? null} error={a?.error_code} /></dd>
              <dt>Duration</dt><dd>{a?.duration_ms != null ? `${a.duration_ms} ms` : "—"}</dd>
              <dt>Delivered to</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{a ? `${a.http_method} ${a.requested_url}` : "—"}</dd>
              <dt>Created</dt><dd>{fmtDate(e.created_at)}</dd>
              <dt>Last attempt</dt><dd>{fmtDate(e.last_attempt_at)}</dd>
              {e.next_attempt_at && pending && (<><dt>Next attempt</dt><dd>{fmtDate(e.next_attempt_at)}</dd></>)}
            </dl>
          )}
          <div style={{ marginTop: 14 }}>
            <Link to={`/events?connection_id=${e.connection_id}`} className="muted small">Open in Events →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderList({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="hdrs mono">
      {entries.map(([k, v]) => (
        <div key={k}>
          <span className="hdr-k">{k.toLowerCase()}:</span> <span className="hdr-v">{v}</span>
        </div>
      ))}
    </div>
  );
}
