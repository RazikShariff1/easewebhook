import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Crosshair, Download, ListChecks, Send, Split, Waypoints } from "lucide-react";
import { api, type Connection, type Page, type Source, type WebhookEvent, type WebhookRequest } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { useSourceTypes, type SourceType } from "../lib/sourceTypes";
import { CopyText, Field, useAction } from "../components/ui";
import { SourceTypePicker } from "../components/SourceTypePicker";
import { OutboundEvents } from "../components/OutboundEvents";
import { LandCards, ObStep, RequestList, TriggerStep, WaitingCard, Dots, type Land } from "./ConnectionTest";

/**
 * Step-by-step "first connection" flow (Hookdeck-style): create a source and get its URL, fire a request at it,
 * inspect it, pick where events land, then watch deliveries. Progress lives in the URL (?source=&connection=)
 * so a reload resumes where you were.
 */
export function FirstConnectionPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const sourceId = params.get("source") ?? "";
  const connectionId = params.get("connection") ?? "";
  const [nextClicked, setNext] = useState(false);

  const src = useQuery(() => (sourceId ? api.get<Source>(`/sources/${sourceId}`) : Promise.resolve(undefined)), [sourceId]);
  const conn = useQuery(() => (connectionId ? api.get<Connection>(`/connections/${connectionId}`) : Promise.resolve(undefined)), [connectionId]);
  const reqs = useQuery(
    () => (sourceId ? api.get<Page<WebhookRequest>>("/requests", { source_id: sourceId, limit: 10 }) : Promise.resolve(undefined)),
    [sourceId],
    2000,
  );
  const evts = useQuery(
    () => (connectionId ? api.get<Page<WebhookEvent>>("/events", { connection_id: connectionId, limit: 10 }) : Promise.resolve(undefined)),
    [connectionId],
    2000,
  );

  const s = src.data;
  const c = conn.data;
  const hasReqs = (reqs.data?.models.length ?? 0) > 0;
  const hasEvts = (evts.data?.models.length ?? 0) > 0;

  // highest unlocked step: 1 source, 2-3 trigger/inspect, 4 destination, 5 deliveries
  const stage = c ? 5 : s ? (nextClicked ? 4 : 3) : 1;

  const setQ = (k: string, v: string) => {
    params.set(k, v);
    setParams(params, { replace: true });
  };

  const reloadAll = () => (reqs.reload(), evts.reload());

  return (
    <>
      <header className="page-header">
        <button className="btn icon ghost" onClick={() => navigate("/connections")} aria-label="Back to connections"><ArrowLeft /></button>
        <h1>Create your first connection</h1>
        <span className="spacer" />
        <Link className="btn ghost" to="/connections/new">Advanced setup</Link>
        {c && <Link className="btn primary" to="/connections">Go to dashboard</Link>}
      </header>

      <div className="content">
        <div className="ob">
          <ObStep icon={<Download size={15} />} title="Configure an inbound source"
            text="A source receives webhooks from a provider (Stripe, Shopify, GitHub…) or your own app on a unique URL.">
            {s ? <SourceSummary s={s} /> : <SourceCreate onCreated={(x) => setQ("source", x.id)} />}
          </ObStep>

          <ObStep icon={<Send size={15} />} title="Trigger HTTP requests to your source URL" dim={stage < 3}
            text="The source above receives HTTP requests on its own unique URL.">
            {s ? <TriggerStep src={s} onSent={reloadAll} /> : <Placeholder />}
          </ObStep>

          <ObStep icon={<Waypoints size={15} />} title="Inspect inbound HTTP requests" dim={stage < 3}
            text="View the headers, body and metadata of the HTTP requests you triggered above.">
            {s && hasReqs ? <RequestList reqs={reqs.data!.models} onChanged={reloadAll} /> : s ? <WaitingCard src={s} /> : <Placeholder />}
            {stage === 3 && (
              <button className="btn" style={{ marginTop: 16 }} disabled={!hasReqs} onClick={() => setNext(true)}>Next</button>
            )}
          </ObStep>

          <ObStep icon={<Crosshair size={15} />} title="Where should your events land?" dim={stage < 4}
            text="When HTTP requests hit your source, an outgoing event is queued to a destination of one of these types.">
            {c ? (
              <div className="ob-done" style={{ margin: 0 }}>
                <CheckCircle2 size={18} color="var(--success)" />
                <span>Delivering to <span className="mono">{c.destination.name}</span> · <span className="mono">{c.destination.url}</span></span>
              </div>
            ) : (
              <DestinationCreate source={s} disabled={stage < 4} onCreated={(x) => setQ("connection", x.id)} />
            )}
          </ObStep>

          <ObStep icon={<Split size={15} />} title="Inspect outbound events" dim={stage < 5} last
            text="View the response of events that were directed to your destination.">
            {c && hasEvts ? (
              <OutboundEvents evts={evts.data!.models} />
            ) : (
              <div className="ob-wait small">
                <Dots />
                <span className="muted">Send a request to your source to see it delivered.</span>
              </div>
            )}
            {c && s && (
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <ResendButton src={s} last={reqs.data?.models.find((r) => r.status === "ACCEPTED")} onSent={reloadAll} />
                <Link className="btn" to={`/connections/${c.id}/edit`}><ListChecks size={15} /> Add rules (transform, filter, retry)</Link>
                <Link className="btn primary" to="/connections">Go to dashboard</Link>
              </div>
            )}
          </ObStep>
        </div>
      </div>
    </>
  );
}

function Placeholder() {
  return <div className="ob-wait small"><span className="faint">Complete the step above first.</span></div>;
}

function SourceCreate({ onCreated }: { onCreated: (s: Source) => void }) {
  const types = useSourceTypes();
  const [type, setType] = useState<SourceType>();
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const t = type ?? types[0];
  const fields = (t?.fields ?? []).filter((f) => !f.generated);

  const create = async () => {
    const s = await run(() => api.post<Source>("/sources", { name: name.trim(), type: t?.id, config }), "Source created");
    if (s) onCreated(s);
  };

  return (
    <div className="ob-form">
      <div className="field-row">
        <Field label="Source name" hint="Lowercase letters, numbers and dashes, e.g. shopify-orders">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-source" autoFocus />
        </Field>
        <Field label="Source type">
          <SourceTypePicker
            types={types}
            value={t?.id ?? ""}
            onChange={(nt) => {
              setType(nt);
              setConfig({});
              if (!name && nt.category === "provider") setName(nt.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
            }}
          />
        </Field>
      </div>
      {fields.map((f) => (
        <Field key={f.key} label={`${f.label}${t?.category === "provider" ? " (optional)" : ""}`} hint={f.help}>
          <input
            className="input mono"
            type={f.secret ? "password" : "text"}
            autoComplete="off"
            value={config[f.key] ?? ""}
            onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
          />
        </Field>
      ))}
      <div>
        <button className="btn primary" onClick={create} disabled={busy || !name.trim() || !t}>Create source</button>
      </div>
    </div>
  );
}

function SourceSummary({ s }: { s: Source }) {
  const types = useSourceTypes();
  const t = types.find((x) => x.id === s.type);
  return (
    <div className="ob-done" style={{ margin: 0, flexWrap: "wrap" }}>
      <CheckCircle2 size={18} color="var(--success)" />
      <span><span className="mono">{s.name}</span>{t ? ` · ${t.name}` : ""} is ready at</span>
      <span className="mono"><CopyText text={s.url} /></span>
    </div>
  );
}

function DestinationCreate({ source, disabled, onCreated }: { source?: Source; disabled: boolean; onCreated: (c: Connection) => void }) {
  const cfg = useQuery(() => api.get<{ mock_destination_url?: string }>("/auth/config"), []);
  const [choice, setChoice] = useState<Land>("http");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const { run, busy } = useAction();
  const mockUrl = cfg.data?.mock_destination_url;

  const derived = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "").split(".")[0] || "my-api";
    } catch {
      return "my-api";
    }
  })();

  const valid = !!source && (choice === "http" ? /^https?:\/\/\S+$/.test(url.trim()) : choice === "mock" && !!mockUrl);

  const create = async () => {
    const destination =
      choice === "mock"
        ? { type: "MOCK_API", name: "mock-api" }
        : { type: "HTTP", name: (name.trim() || derived).toLowerCase(), url: url.trim() };
    const c = await run(() => api.post<Connection>("/connections", { source_id: source!.id, destination }), "Connection created");
    if (c) onCreated(c);
  };

  return (
    <fieldset className="ob-fieldset" disabled={disabled}>
      <LandCards choice={choice} onChange={setChoice} />
      {choice === "http" && (
        <div className="field-row">
          <Field label="Endpoint URL">
            <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/webhooks" />
          </Field>
          <Field label="Destination name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={derived} />
          </Field>
        </div>
      )}
      {choice === "mock" && (
        <p className="muted small" style={{ margin: 0 }}>
          Events go to the built-in mock endpoint <span className="mono">{mockUrl ?? "…"}</span>, which accepts everything and answers 200.
        </p>
      )}
      {choice === "cli" && (
        <p className="muted small" style={{ margin: 0 }}>
          The CLI isn't available yet. Use HTTP with a tunnel (for example ngrok or Cloudflare Tunnel) to reach a local server, or Mock API to try the flow.
        </p>
      )}
      <div>
        <button className="btn primary" onClick={create} disabled={disabled || busy || !valid}>Create connection</button>
      </div>
    </fieldset>
  );
}

/** Re-sends the last accepted request's body (or a sample) so it flows through the new connection. */
function ResendButton({ src, last, onSent }: { src: Source; last?: WebhookRequest; onSent: () => void }) {
  const { run, busy } = useAction();
  const key = src.url.split("/").pop();

  const send = () =>
    run(async () => {
      const body = last?.body !== undefined && last?.body !== null ? last.body : { hello: "world" };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (src.type === "PUBLISH_API" && src.config.api_key) headers.Authorization = `Bearer ${src.config.api_key}`;
      const res = await fetch(`/api/e/${key}`, {
        method: "POST",
        headers,
        credentials: "omit",
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Source responded ${res.status}`);
      onSent();
      return true;
    }, last ? "Sent your last request again" : "Sent a sample request");

  return (
    <button className="btn" onClick={send} disabled={busy}>
      <Send size={15} /> {last ? "Send the last request again" : "Send a sample request"}
    </button>
  );
}
