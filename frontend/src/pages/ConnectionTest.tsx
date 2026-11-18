import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Crosshair,
  FlaskConical,
  Globe,
  Grab,
  HelpCircle,
  History,
  Info,
  ScanSearch,
  RotateCcw,
  Send,
  ShieldAlert,
  Split,
  SquareTerminal,
  TerminalSquare,
  Waypoints,
  Webhook,
  Workflow,
} from "lucide-react";
import { api, type Attempt, type Connection, type Source, type Page, type WebhookEvent, type WebhookRequest } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { requestStatusLabel, timeAgo, tryParseJSON } from "../lib/format";
import { JsonTree } from "../components/JsonTree";
import { OutboundEvents } from "../components/OutboundEvents";
import { useSourceTypes } from "../lib/sourceTypes";
import { LogoMark } from "../components/Logo";
import { Badge, ErrorBox, Field, HttpBadge, Loading, StatusBadge, useAction, useToast } from "../components/ui";

type Mode = "copy" | "mock";

const SAMPLE = `{\n  "hello": "world"\n}`;

/**
 * Guided "try your connection" flow shown after creating a connection (and from its menu):
 * 1. trigger a request (paste the URL into the producer, or send a mock)
 * 2. inspect inbound requests (unlocks "Next" once one arrives)
 * 3. choose where events land (your HTTP API, the built-in Mock API, or CLI later)
 * 4. inspect delivered events
 */
export function ConnectionTestPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const conn = useQuery(() => api.get<Connection>(`/connections/${id}`), [id]);
  const cfg = useQuery(() => api.get<{ mock_destination_url?: string }>("/auth/config"), []);
  const c = conn.data;
  const [stageState, setStage] = useState(2); // highest unlocked step

  // Live: poll this source's requests and this connection's events.
  const reqs = useQuery(
    () => (c ? api.get<Page<WebhookRequest>>("/requests", { source_id: c.source_id, limit: 10 }) : Promise.resolve(undefined)),
    [c?.source_id],
    2000,
  );
  const evts = useQuery(
    () => (c ? api.get<Page<WebhookEvent>>("/events", { connection_id: c.id, limit: 10 }) : Promise.resolve(undefined)),
    [c?.id],
    2000,
  );

  if (conn.error) return <ErrorBox error={conn.error} />;
  if (!c) return <Loading />;

  const hasReqs = (reqs.data?.models.length ?? 0) > 0;
  const hasEvts = (evts.data?.models.length ?? 0) > 0;
  // Coming back to a connection that already delivered events: everything is unlocked.
  const stage = hasEvts ? 4 : stageState;

  return (
    <>
      <header className="page-header">
        <button className="btn icon ghost" onClick={() => navigate("/connections")} aria-label="Back to connections"><ArrowLeft /></button>
        <h1>Test <span className="mono">{c.full_name}</span></h1>
        <span className="spacer" />
        <Link className="btn" to={`/events?connection_id=${c.id}`}>Open in Events</Link>
        <Link className="btn primary" to="/connections">Done</Link>
      </header>

      <div className="content">
        <div className="ob">
          <div className="ob-done">
            <CheckCircle2 size={18} color="var(--success)" />
            <span><span className="mono">{c.full_name}</span> is live and ready to receive requests.</span>
          </div>

          <ObStep icon={<Send size={15} />} title="Trigger HTTP requests to your source URL"
            text="The source above receives HTTP requests on its own unique URL.">
            <TriggerStep src={c.source} onSent={() => (reqs.reload(), evts.reload())} />
          </ObStep>

          <ObStep icon={<Waypoints size={15} />} title="Inspect inbound HTTP requests"
            text="View the headers, body and metadata of the HTTP requests you triggered above.">
            {hasReqs ? <RequestList reqs={reqs.data!.models} onChanged={() => (reqs.reload(), evts.reload())} /> : <WaitingCard src={c.source} />}
            {stage < 3 && (
              <button className="btn" style={{ marginTop: 16 }} disabled={!hasReqs} onClick={() => setStage(3)}>Next</button>
            )}
          </ObStep>

          <ObStep icon={<Crosshair size={15} />} title="Where should your events land?" dim={stage < 3}
            text="When HTTP requests reach your source, an outgoing event is queued to a destination of one of these types.">
            <DestinationStep c={c} mockUrl={cfg.data?.mock_destination_url} disabled={stage < 3}
              onUpdated={() => (conn.reload(), setStage(4))} />
          </ObStep>

          <ObStep icon={<Split size={15} />} title="Inspect outbound events" dim={stage < 4 && !hasEvts} last
            text={`Each accepted request becomes an event delivered to ${c.destination.name}. See the response it returned.`}>
            {hasEvts ? (
              <OutboundEvents evts={evts.data!.models} />
            ) : (
              <div className="ob-wait small"><Dots /><span className="muted">No deliveries yet. Send another request after choosing a destination.</span></div>
            )}
          </ObStep>
        </div>
      </div>
    </>
  );
}

export function Dots() {
  return <span className="ob-dots" aria-hidden="true"><i /><i /><i /></span>;
}

export function WaitingCard({ src }: { src: Source }) {
  const [help, setHelp] = useState(false);
  return (
    <div className="ob-wait">
      <Dots />
      <strong>Waiting on your first request</strong>
      <p className="muted">
        The requests you've triggered from your HTTP request producer will be shown here once they arrive. You should
        expect to see them within 1 minute of firing the event.
      </p>
      <button className="ob-help-toggle" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
        <HelpCircle size={14} /> I'm still not seeing my requests
      </button>
      {help && (
        <ul className="ob-help">
          <li>Check the producer uses exactly <span className="mono">{src.url}</span>, including the key at the end.</li>
          <li>Allowed methods for this source: <span className="mono">{src.allowed_http_methods.join(", ")}</span>. Other methods get 405 and show up as <em>Unsupported Method</em>.</li>
          {src.disabled_at && <li>This source is <strong>disabled</strong>; enable it on the Sources page.</li>}
          <li>Requests that fail signature verification still appear here, marked <em>Rejected</em>, with the reason.</li>
          <li>Some providers only send after you save the webhook or trigger a real event. Try "Test using a mock request" above to check the URL works.</li>
          <li>The source URL must be reachable from the producer. <span className="mono">localhost</span> URLs only work from this machine; use a public URL (or a tunnel) for external services.</li>
        </ul>
      )}
    </div>
  );
}

export type Land = "http" | "mock" | "cli";

function DestinationStep({ c, mockUrl, disabled, onUpdated }: { c: Connection; mockUrl?: string; disabled: boolean; onUpdated: () => void }) {
  const isMock = !!mockUrl && c.destination.url.startsWith(mockUrl);
  const [choice, setChoice] = useState<Land>(isMock ? "mock" : "http");
  const [url, setUrl] = useState(isMock ? "" : c.destination.url);
  const { run, busy } = useAction();
  const shared = useQuery(() => api.get<Page<Connection>>("/connections", { destination_id: c.destination_id, limit: 50 }), [c.destination_id]);
  const others = (shared.data?.models.length ?? 1) - 1;

  const target = choice === "mock" ? mockUrl ?? "" : url.trim();
  const unchanged = target === c.destination.url;
  const valid = choice !== "cli" && /^https?:\/\/\S+$/.test(target);

  const update = async () => {
    const ok = await run(
      () => api.put(`/destinations/${c.destination_id}`, choice === "mock" ? { type: "MOCK_API" } : { type: "HTTP", url: target }),
      "Destination updated",
    );
    if (ok) onUpdated();
  };

  return (
    <fieldset className="ob-fieldset" disabled={disabled}>
      <LandCards choice={choice} onChange={setChoice} />

      {choice === "http" && (
        <Field label="Endpoint URL" hint="Events are POSTed (or sent with the original method) to this URL.">
          <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/webhooks" />
        </Field>
      )}
      {choice === "mock" && (
        <p className="muted small" style={{ margin: 0 }}>
          Events go to the built-in mock endpoint <span className="mono">{mockUrl ?? "…"}</span>, which accepts everything and answers 200.
        </p>
      )}
      {choice === "cli" && (
        <p className="muted small" style={{ margin: 0 }}>
          The CLI isn't available yet. Meanwhile, use HTTP with a tunnel (for example ngrok or Cloudflare Tunnel) to reach a local server.
        </p>
      )}
      {others > 0 && choice !== "cli" && (
        <p className="ob-note" style={{ margin: 0 }}>
          <Info size={15} /> {c.destination.name} is used by {others} other connection{others === 1 ? "" : "s"}; they'll deliver to the new URL too.
        </p>
      )}

      <div>
        <button className="btn" onClick={update} disabled={disabled || busy || !valid || unchanged}>Update</button>
        {unchanged && choice !== "cli" && <span className="faint small" style={{ marginLeft: 10 }}>Already delivering here.</span>}
      </div>
    </fieldset>
  );
}

/** The three "where should your events land" cards. */
export function LandCards({ choice, onChange }: { choice: Land; onChange: (l: Land) => void }) {
  const setChoice = onChange;
  return (
    <div className="ob-cards">
      <LandCard on={choice === "http"} onClick={() => setChoice("http")} title="HTTP"
        text="Send events to any public HTTP endpoint, like your API or a third-party service."
        bullets={[[<Box size={14} key="i" />, "Use in any environment"], [<Code2 size={14} key="i" />, "Triggers real application logic"], [<History size={14} key="i" />, "Automatic retries with durable queueing"]]}
        flow={["https://my-api.com", <Globe size={13} key="g" />]} response={`"my_api_status": "200 OK"`} />
      <LandCard on={choice === "mock"} onClick={() => setChoice("mock")} title="Mock API" tag="Testing"
        text="Observe deliveries before connecting your API or server."
        bullets={[[<ScanSearch size={14} key="i" />, "Inspect webhooks without an API or server"], [<FlaskConical size={14} key="i" />, "Test filters and transformations"], [<CheckCheck size={14} key="i" />, "Validate the whole flow end to end"]]}
        flow={["mock endpoint", <Waypoints size={13} key="g" />]} response={`"easewebhook_mock_endpoint_status": "200 OK"`} />
      <LandCard on={choice === "cli"} onClick={() => setChoice("cli")} title="CLI" tag="Coming soon"
        text="Forward events to your local machine through the EaseWebhook CLI."
        bullets={[[<SquareTerminal size={14} key="i" />, "Receive webhooks on a local server"], [<TerminalSquare size={14} key="i" />, "Replay and inspect event data locally"], [<Workflow size={14} key="i" />, "Use in CI to test event flows"]]}
        flow={["/my-local-server", <SquareTerminal size={13} key="g" />]} terminal />
    </div>
  );
}

function LandCard({
  on, onClick, title, tag, text, bullets, flow, response, terminal,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  tag?: string;
  text: string;
  bullets: [ReactNode, string][];
  flow: [string, ReactNode];
  response?: string;
  terminal?: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`ob-land ${on ? "on" : ""}`} onClick={onClick}>
      <div className="ob-land-head">
        <span className="ob-dot" />
        <strong>{title}</strong>
        {tag && <span className="ob-tag">{tag}</span>}
      </div>
      <p className="muted">{text}</p>
      <ul>
        {bullets.map(([icon, label]) => (
          <li key={label}>{icon}{label}</li>
        ))}
      </ul>
      <div className="ob-land-demo">
        <div className="ob-land-flow mono"><Webhook size={13} /> webhook <ArrowRight size={13} /> {flow[1]} {flow[0]}</div>
        {terminal ? (
          <div className="ob-term mono">
            <div className="faint">TERMINAL</div>
            <div>&gt; 12:34:56 [<span className="ok-text">200</span>] POST</div>
            <div className="faint">REQUEST</div>
            <div>"hello": <span className="str">"world"</span></div>
            <div className="faint">RESPONSE</div>
            <div>"my_local_server_status": <span className="str">"200 OK"</span></div>
          </div>
        ) : (
          <>
            <div className="ob-land-label">REQUEST</div>
            <div className="ob-snip mono">"hello": <span className="str">"world"</span></div>
            <div className="ob-land-label">RESPONSE</div>
            <div className="ob-snip mono">{response!.split(": ")[0]}: <span className="str">{response!.split(": ")[1]}</span></div>
          </>
        )}
      </div>
    </button>
  );
}

export function ObStep({
  icon,
  title,
  text,
  dim,
  last,
  tag,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  dim?: boolean;
  last?: boolean;
  tag?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ob-step ${dim ? "dim" : ""} ${last ? "last" : ""}`}>
      <div className="ob-rail">
        <span className="ob-icon">{icon}</span>
      </div>
      <div className="ob-body">
        <h2>{title}{tag && <span className="ob-tag" style={{ marginLeft: 10, verticalAlign: 2 }}>{tag}</span>}</h2>
        <p className="muted">{text}</p>
        <div className="ob-content">{children}</div>
      </div>
    </section>
  );
}

// ---------------- step 1 ----------------

export function TriggerStep({ src, onSent }: { src: Source; onSent: () => void }) {
  const [mode, setMode] = useState<Mode>("copy");
  const toast = useToast();
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));

  return (
    <>
      <div className="ob-radios" role="radiogroup">
        <RadioCard on={mode === "copy"} onClick={() => setMode("copy")} title="Copy and paste source URL"
          text="Bring the source URL to your request producer. Higher effort, more functional." />
        <RadioCard on={mode === "mock"} onClick={() => setMode("mock")} title="Test using a mock request"
          text="Send a dummy request to the source URL. Lower effort, best for a quick demo." />
      </div>

      {mode === "copy" ? (
        <div className="ob-sub">
          <SubStep n={1} title="Bring the source URL to your request producer"
            text="Paste this source URL as the webhook endpoint in the service producing your requests.">
            <div className="ob-url">
              <span className="mono">{src.url}</span>
              <button className="btn icon ghost" onClick={() => copy(src.url, "Source URL")} aria-label="Copy source URL"><Copy size={16} /></button>
            </div>
            <PasteIllustration url={src.url} />
          </SubStep>
          <SubStep n={2} title="Trigger an event in your request producer"
            text="Do something that fires the webhook (place a test order, push a commit, update a customer…). It will show up in the next step." />
        </div>
      ) : (
        <MockRequest src={src} onSent={onSent} />
      )}
    </>
  );
}

export function RadioCard({ on, onClick, title, text, disabled }: { on: boolean; onClick: () => void; title: string; text?: string; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-disabled={disabled} className={`ob-radio ${on ? "on" : ""} ${disabled ? "disabled" : ""}`} onClick={onClick}
      title={disabled ? "Nothing to re-use yet" : undefined}>
      <span className="ob-dot" />
      <span>
        <strong>{title}</strong>
        {text && <span className="muted">{text}</span>}
      </span>
    </button>
  );
}

function SubStep({ n, title, text, children }: { n: number; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="ob-substep">
      <span className="ob-n">{n}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3>{title}</h3>
        <p className="muted">{text}</p>
        {children}
      </div>
    </div>
  );
}

function PasteIllustration({ url }: { url: string }) {
  return (
    <div className="ob-illus" aria-hidden="true">
      <div className="ob-app">
        <div className="ob-app-head"><Box size={16} /> App</div>
        <div className="ob-app-body">
          <strong>Update webhook</strong>
          <span className="muted small">Event type</span>
          <span className="ob-check"><span className="ob-box">✓</span><span className="mono">new.customer</span></span>
          <span className="muted small">Endpoint URL</span>
          <div className="ob-field">
            <div className="ob-pill">
              <LogoMark size={18} />
              <span className="mono">{url.length > 40 ? url.slice(0, 38) + "…" : url}</span>
              <Grab size={18} className="ob-grab" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockRequest({ src, onSent }: { src: Source; onSent: () => void }) {
  const [tab, setTab] = useState<"web" | "curl">("web");
  const [body, setBody] = useState(SAMPLE);
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; text: string }>();
  const toast = useToast();
  const types = useSourceTypes();
  const stype = types.find((t) => t.id === src.type);
  const parsed = tryParseJSON(body);
  const key = src.url.split("/").pop();
  const pubKey = src.type === "PUBLISH_API" ? src.config.api_key : undefined;
  const providerVerified = stype?.category === "provider" && stype.fields.some((f) => src.config[f.key]);

  const curl = useMemo(() => {
    const compact = parsed.ok ? JSON.stringify(parsed.value ?? {}) : body;
    const auth = pubKey ? ` \\\n  -H "Authorization: Bearer ${pubKey}"` : "";
    return `curl -X POST ${src.url} \\\n  -H "Content-Type: application/json"${auth} \\\n  -d '${compact.replace(/'/g, "'\\''")}'`;
  }, [body, parsed, src.url, pubKey]);

  const send = async () => {
    if (!parsed.ok) return;
    setSending(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (pubKey) headers.Authorization = `Bearer ${pubKey}`;
      // credentials: "omit" so the dashboard's own cookies aren't sent (and stored) with the mock request
      const res = await fetch(`/api/e/${key}`, { method: "POST", headers, credentials: "omit", body: JSON.stringify(parsed.value ?? {}) });
      const j = await res.json().catch(() => ({}));
      setLast(
        res.ok
          ? { ok: true, text: `Accepted · ${j.events ?? 0} event(s) created${j.ignored ? `, ${j.ignored} filtered out` : ""}` }
          : { ok: false, text: `${res.status} · ${j.message ?? "rejected"}` },
      );
      onSent();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ob-mock">
      <div className="ob-tabs">
        <div className="tabs">
          <button className={tab === "web" ? "on" : ""} onClick={() => setTab("web")} title="Send from this page">
            Web UI <Info size={13} />
          </button>
          <button className={tab === "curl" ? "on" : ""} onClick={() => setTab("curl")} title="Run from your terminal">
            cURL (via terminal) <Info size={13} />
          </button>
        </div>
        {tab === "web" ? (
          <div className="ob-editor">
            <textarea className="textarea" spellCheck={false} rows={8} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Request body (JSON)" />
            <span className="ob-lang">{parsed.ok ? "JSON" : <span className="form-error">Invalid JSON</span>}</span>
          </div>
        ) : (
          <div className="ob-editor">
            <pre className="code" style={{ border: 0, margin: 0, maxHeight: "none" }}>{curl}</pre>
            <button className="btn sm ob-copy" onClick={() => navigator.clipboard?.writeText(curl).then(() => toast("cURL copied"))}><Copy size={13} /> Copy</button>
          </div>
        )}
      </div>

      {providerVerified && (
        <div className="ob-note">
          <ShieldAlert size={15} />
          This source verifies {stype?.name} signatures, so an unsigned mock request is rejected with 401. You'll still see it
          in the next step, marked as rejected.
        </div>
      )}

      {tab === "web" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn primary" onClick={send} disabled={sending || !parsed.ok}><Send size={15} /> Send mock request</button>
          {last && <span className={last.ok ? "ok-text" : "form-error"}>{last.text}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------- steps 2 & 3 ----------------

export function RequestList({ reqs, onChanged }: { reqs: WebhookRequest[]; onChanged: () => void }) {
  const [sel, setSel] = useState<string>();
  const [tab, setTab] = useState<"body" | "headers">("body");
  const { run } = useAction();
  const toastMsg = useToast();
  const r = reqs.find((x) => x.id === sel) ?? reqs[0];

  const retry = async (id: string) => {
    const res = await run(() => api.post<{ events: number; ignored: number }>(`/requests/${id}/retry`));
    if (res) {
      toastMsg(`Retried — ${res.events} event(s) created${res.ignored ? `, ${res.ignored} filtered out` : ""}`);
      onChanged();
    }
  };

  return (
    <div className="rq">
      <div className="rq-table">
        <div className="rq-head"><span>Request Date</span><span>Request Status</span></div>
        <div className="rq-rows" role="listbox" aria-label="Inbound requests">
          {reqs.map((x) => (
            <div
              key={x.id}
              role="option"
              tabIndex={0}
              aria-selected={x.id === r.id}
              className={`rq-row ${x.id === r.id ? "sel" : ""}`}
              onClick={() => setSel(x.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(x.id))}
            >
              <span className="mono">{fmtStamp(x.ingested_at)}</span>
              <span className="rq-status">
                <Badge tone={x.status === "ACCEPTED" ? "success" : "danger"}>{requestStatusLabel(x.status, x.rejection_cause)}</Badge>
                {x.status === "REJECTED" && (
                  <button
                    className="btn icon ghost rq-retry"
                    title="Retry: accept this request and route it to its connections"
                    aria-label="Retry request"
                    onClick={(e) => (e.stopPropagation(), retry(x.id))}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rq-detail">
        <div className="rq-head"><span>Request Details</span></div>
        <div className="tabs" style={{ padding: "0 12px" }}>
          <button className={tab === "body" ? "on" : ""} onClick={() => setTab("body")}>Body</button>
          <button className={tab === "headers" ? "on" : ""} onClick={() => setTab("headers")}>Headers</button>
        </div>
        <div className="rq-detail-body">
          {r.rejection_cause && <div className="form-error" style={{ marginBottom: 10 }}>{r.rejection_cause}</div>}
          <div className="faint mono" style={{ fontSize: 12, marginBottom: 8 }}>
            {r.method} {r.path || "/"}{r.query ? `?${r.query}` : ""} · {r.id}
            {r.status === "ACCEPTED" && ` · ${r.events_count} event${r.events_count === 1 ? "" : "s"}${r.ignored_count ? `, ${r.ignored_count} filtered` : ""}`}
          </div>
          <JsonTree key={`${r.id}-${tab}`} value={tab === "body" ? r.body : r.headers} />
        </div>
      </div>
    </div>
  );
}

function fmtStamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function EventList({ evts }: { evts: WebhookEvent[] }) {
  const [open, setOpen] = useState<string>();
  const attempts = useQuery(
    () => (open ? api.get<Page<Attempt>>(`/events/${open}/attempts`, { limit: 1 }) : Promise.resolve(undefined)),
    [open],
  );
  const a = attempts.data?.models[0];

  return (
    <div className="ob-list">
      {evts.map((e) => (
        <div key={e.id} className={`ob-item ${open === e.id ? "open" : ""}`}>
          <button className="ob-item-row" onClick={() => setOpen(open === e.id ? undefined : e.id)} aria-expanded={open === e.id}>
            <ChevronRight size={14} className="ob-chev" />
            <StatusBadge status={e.status} />
            <HttpBadge code={e.response_status} error={e.response_status ? null : e.error_code} />
            <span className="faint mono" style={{ fontSize: 12 }}>{e.id}</span>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {e.attempts} attempt{e.attempts === 1 ? "" : "s"} · {timeAgo(e.created_at)}
            </span>
          </button>
          {open === e.id && (
            <div className="ob-item-body">
              {!a ? (
                <span className="faint">{e.status === "QUEUED" || e.status === "SCHEDULED" ? "Delivery in progress…" : "No attempts yet."}</span>
              ) : (
                <>
                  <div className="mono muted" style={{ fontSize: 12, wordBreak: "break-all" }}>{a.http_method} {a.requested_url} · {a.duration_ms ?? "—"}ms</div>
                  {a.error_message && <div className="form-error">{a.error_message}</div>}
                  <div className="section-title">Response from your endpoint</div>
                  <pre className="code">{a.response_body || "(empty)"}</pre>
                </>
              )}
              <Link to={`/events?connection_id=${e.connection_id}`} className="muted" style={{ fontSize: 13 }}>Open in Events →</Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
