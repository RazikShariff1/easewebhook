import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, ExternalLink, Eye, EyeOff, FileCode2, Filter, GripVertical, Info, RefreshCw, RotateCw, Save as SaveIcon } from "lucide-react";
import {
  api,
  type AuthType,
  type Destination,
  type Page,
  type Rule,
  type Source,
  type SourceVerification,
  type Transformation,
} from "../lib/api";
import { useQuery } from "../lib/hooks";
import { pretty, tryParseJSON } from "../lib/format";
import { CopyText, Drawer, Field, Toggle, useAction } from "./ui";
import { OptionPicker } from "./OptionPicker";
import { DEST_TYPES, DestinationIcon } from "./DestinationIcon";
import { useSourceTypes, type SourceType } from "../lib/sourceTypes";
import { SourceTypePicker } from "./SourceTypePicker";
import { SourceIcon } from "./SourceIcon";

const METHODS = ["POST", "PUT", "PATCH", "DELETE", "GET"];

// ======================= Source =======================

export interface SourceDraft {
  type: string;
  config: Record<string, string>;
  name: string;
  description: string;
  methods: string[];
  verifType: "" | SourceVerification["type"];
  header: string;
  secret: string;
  algorithm: string;
  encoding: string;
  prefix: string;
  apiKey: string;
  username: string;
  password: string;
  customBody: string;
  customType: string;
}

export function sourceDraft(s?: Source): SourceDraft {
  const v = s?.verification;
  return {
    type: s?.type ?? "WEBHOOK",
    config: { ...(s?.config ?? {}) },
    name: s?.name ?? "",
    description: s?.description ?? "",
    methods: s?.allowed_http_methods ?? ["POST", "PUT", "PATCH", "DELETE"],
    verifType: v?.type ?? "",
    header: v?.header ?? "",
    secret: v?.secret ?? "",
    algorithm: v?.algorithm ?? "sha256",
    encoding: v?.encoding ?? "hex",
    prefix: v?.prefix ?? "",
    apiKey: v?.api_key ?? "",
    username: v?.username ?? "",
    password: v?.password ?? "",
    customBody: s?.custom_response?.body ?? "",
    customType: s?.custom_response?.content_type ?? "application/json",
  };
}

export function sourcePayload(d: SourceDraft, editing: boolean) {
  let verification: SourceVerification | Record<string, never> | undefined;
  if (d.verifType === "hmac")
    verification = { type: "hmac", header: d.header, secret: d.secret, algorithm: d.algorithm, encoding: d.encoding, prefix: d.prefix };
  else if (d.verifType === "api_key") verification = { type: "api_key", header: d.header, api_key: d.apiKey };
  else if (d.verifType === "basic_auth") verification = { type: "basic_auth", username: d.username, password: d.password };
  else if (editing) verification = {}; // clears it

  return {
    type: editing ? undefined : d.type,
    config: d.config,
    name: d.name,
    description: d.description || null,
    allowed_http_methods: d.methods,
    verification,
    custom_response: d.customBody ? { content_type: d.customType, body: d.customBody } : editing ? { content_type: "", body: "" } : undefined,
  };
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        className="input mono"
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide value" : "Show value"}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

/**
 * Source form body. `source` is set when editing: the type is then fixed, and generated values
 * (the Publish API key) are shown with a rotate action.
 */
export function SourceFields({
  d,
  set,
  source,
  onRotated,
}: {
  d: SourceDraft;
  set: (p: Partial<SourceDraft>) => void;
  source?: Source;
  onRotated?: (s: Source) => void;
}) {
  const types = useSourceTypes();
  const t = types.find((x) => x.id === d.type);
  const { run, busy } = useAction();
  const editable = (t?.fields ?? []).filter((f) => !f.generated);
  const generated = (t?.fields ?? []).filter((f) => f.generated);

  const chooseType = (nt: SourceType) => {
    const suggested = nt.category === "provider" ? nt.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "";
    set({
      type: nt.id,
      config: {},
      methods: nt.methods,
      verifType: nt.custom_auth ? d.verifType : "",
      name: d.name || suggested,
    });
  };

  return (
    <>
      <Field label="Source Type *" hint={source ? "The type can't be changed after the source is created." : <><Info size={13} style={{ verticalAlign: -2 }} /> Represents the producer of your HTTP requests.</>}>
        <SourceTypePicker types={types} value={d.type} onChange={chooseType} disabled={!!source} />
      </Field>
      <Field label="Source name" hint="Lowercase letters, numbers and dashes work best, e.g. stripe-production">
        <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!source} />
      </Field>

      {t && (editable.length > 0 || generated.length > 0) && (
        <div className="fieldset">
          <div className="fieldset-title">
            <SourceIcon icon={t.icon} name={t.name} size={16} /> {t.name} {t.category === "provider" ? "verification" : "authentication"}
            {t.docs_url && (
              <a className="docs-link" href={t.docs_url} target="_blank" rel="noreferrer">
                Docs <ExternalLink size={12} />
              </a>
            )}
          </div>
          {t.category === "provider" && (
            <span className="hint faint" style={{ fontSize: 12, marginTop: -6 }}>
              Requests are checked against {t.name}'s signature. Leave empty to accept unverified requests.
            </span>
          )}
          {editable.map((f) => (
            <Field key={f.key} label={f.label} hint={f.help}>
              {f.secret ? (
                <SecretInput value={d.config[f.key] ?? ""} placeholder={f.placeholder} onChange={(v) => set({ config: { ...d.config, [f.key]: v } })} />
              ) : (
                <input
                  className="input mono"
                  placeholder={f.placeholder}
                  value={d.config[f.key] ?? ""}
                  onChange={(e) => set({ config: { ...d.config, [f.key]: e.target.value } })}
                />
              )}
            </Field>
          ))}
          {generated.map((f) => (
            <Field key={f.key} label={f.label} hint={f.help}>
              {source?.config[f.key] ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="input mono" style={{ flex: 1, display: "flex", alignItems: "center", overflow: "hidden" }}>
                    <CopyText text={source.config[f.key]}>{source.config[f.key].slice(0, 10)}••••••••</CopyText>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm("Rotate the API key? The current key stops working immediately.")) return;
                      const s = await run(() => api.post<Source>(`/sources/${source.id}/rotate-key`), "API key rotated");
                      if (s) onRotated?.(s);
                    }}
                  >
                    <RefreshCw size={14} /> Rotate
                  </button>
                </div>
              ) : (
                <span className="faint" style={{ fontSize: 13 }}>Generated when you create the source.</span>
              )}
            </Field>
          ))}
        </div>
      )}

      <Field label="Allowed HTTP methods">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {METHODS.map((m) => (
            <label key={m} className="check">
              <input
                type="checkbox"
                checked={d.methods.includes(m)}
                onChange={(e) => set({ methods: e.target.checked ? [...d.methods, m] : d.methods.filter((x) => x !== m) })}
              />
              {m}
            </label>
          ))}
        </div>
      </Field>

      {(!t || t.custom_auth) && (
        <>
          <Field label="Authentication / verification" hint="Requests that fail verification are rejected with 401 and logged.">
            <select className="select" value={d.verifType} onChange={(e) => set({ verifType: e.target.value as SourceDraft["verifType"] })}>
              <option value="">None</option>
              <option value="hmac">HMAC signature</option>
              <option value="api_key">API key header</option>
              <option value="basic_auth">Basic auth</option>
            </select>
          </Field>
          {d.verifType === "hmac" && (
            <div className="fieldset">
              <div className="field-row">
                <Field label="Signature header">
                  <input className="input" placeholder="x-signature" value={d.header} onChange={(e) => set({ header: e.target.value })} />
                </Field>
                <Field label="Secret">
                  <SecretInput value={d.secret} onChange={(v) => set({ secret: v })} />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Algorithm">
                  <select className="select" value={d.algorithm} onChange={(e) => set({ algorithm: e.target.value })}>
                    <option value="sha256">SHA-256</option>
                    <option value="sha1">SHA-1</option>
                    <option value="sha512">SHA-512</option>
                  </select>
                </Field>
                <Field label="Encoding">
                  <select className="select" value={d.encoding} onChange={(e) => set({ encoding: e.target.value })}>
                    <option value="hex">hex</option>
                    <option value="base64">base64</option>
                  </select>
                </Field>
              </div>
              <Field label="Value prefix" hint='Stripped before comparing, e.g. "sha256="'>
                <input className="input" value={d.prefix} onChange={(e) => set({ prefix: e.target.value })} />
              </Field>
            </div>
          )}
          {d.verifType === "api_key" && (
            <div className="fieldset field-row">
              <Field label="Header">
                <input className="input" placeholder="x-api-key" value={d.header} onChange={(e) => set({ header: e.target.value })} />
              </Field>
              <Field label="Key">
                <SecretInput value={d.apiKey} onChange={(v) => set({ apiKey: v })} />
              </Field>
            </div>
          )}
          {d.verifType === "basic_auth" && (
            <div className="fieldset field-row">
              <Field label="Username">
                <input className="input" value={d.username} onChange={(e) => set({ username: e.target.value })} />
              </Field>
              <Field label="Password">
                <SecretInput value={d.password} onChange={(v) => set({ password: v })} />
              </Field>
            </div>
          )}
        </>
      )}

      <Field label="Custom response (optional)" hint="Returned to the sender instead of the default JSON acknowledgement.">
        <div className="field-row" style={{ gridTemplateColumns: "180px 1fr" }}>
          <select className="select" value={d.customType} onChange={(e) => set({ customType: e.target.value })}>
            <option>application/json</option>
            <option>text/plain</option>
            <option>application/xml</option>
          </select>
          <input className="input mono" value={d.customBody} onChange={(e) => set({ customBody: e.target.value })} placeholder='{"ok":true}' />
        </div>
      </Field>
    </>
  );
}

export function SourceForm({ source, onClose, onSaved }: { source?: Source; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(() => sourceDraft(source));
  const [cur, setCur] = useState(source);
  const { run, busy } = useAction();
  const set = (p: Partial<SourceDraft>) => setD((x) => ({ ...x, ...p }));

  const save = async () => {
    const body = sourcePayload(d, !!cur);
    const r = await run(
      () => (cur ? api.put(`/sources/${cur.id}`, body) : api.post("/sources", body)),
      cur ? "Source updated" : "Source created",
    );
    if (r) onSaved();
  };

  return (
    <Drawer
      title={cur ? `Edit ${cur.name}` : "New source"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !d.name.trim()} onClick={save}>
            {cur ? "Save" : "Create source"}
          </button>
        </>
      }
    >
      <SourceFields d={d} set={set} source={cur} onRotated={(s) => (setCur(s), set({ config: { ...s.config } }))} />
    </Drawer>
  );
}

// ======================= Destination =======================

export interface DestDraft {
  type: "" | "HTTP" | "MOCK_API" | "CLI";
  name: string;
  description: string;
  url: string;
  method: string;
  authType: AuthType;
  auth: Record<string, string>;
  rateOn: boolean;
  rateLimit: string;
  ratePeriod: "second" | "minute" | "hour";
  pathForwarding: boolean;
}

export function destDraft(x?: Destination): DestDraft {
  return {
    type: x?.type ?? "",
    name: x?.name ?? "",
    description: x?.description ?? "",
    url: x?.url ?? "",
    method: x?.http_method ?? "",
    authType: x?.auth_type ?? "NONE",
    auth: x?.auth ?? {},
    rateOn: !!x?.rate_limit,
    rateLimit: x?.rate_limit ? String(x.rate_limit) : "10",
    ratePeriod: x?.rate_limit_period ?? "second",
    pathForwarding: x?.path_forwarding ?? true,
  };
}

export function destPayload(d: DestDraft) {
  return {
    type: d.type || "HTTP",
    name: d.name,
    description: d.description || null,
    url: d.type === "MOCK_API" ? undefined : d.url,
    http_method: d.method,
    auth_type: d.type === "HTTP" ? d.authType : "NONE",
    auth: d.type === "HTTP" && d.authType !== "NONE" ? d.auth : null,
    rate_limit: d.rateOn && Number(d.rateLimit) > 0 ? Number(d.rateLimit) : 0,
    rate_limit_period: d.ratePeriod,
    path_forwarding: d.pathForwarding,
  };
}

/** Ready to save: a type, a name, and (for HTTP) a URL. */
export function destValid(d: DestDraft) {
  return !!d.type && d.type !== "CLI" && !!d.name.trim() && (d.type !== "HTTP" || /^https?:\/\/\S+$/.test(d.url.trim()));
}

function Collapse({ title, open: initial = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="collapse">
      <button type="button" className="collapse-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {title} {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="collapse-rule" />
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  );
}

/** Destination form: type first (like Hookdeck); the rest appears once a type is chosen. */
export function DestinationFields({ d, set, lockType }: { d: DestDraft; set: (p: Partial<DestDraft>) => void; lockType?: boolean }) {
  const setAuth = (k: string, v: string) => set({ auth: { ...d.auth, [k]: v } });
  return (
    <>
      <Field label="Destination Type *" hint={<><Info size={13} style={{ verticalAlign: -2 }} /> Represents the consumer of your HTTP requests.</>}>
        {lockType ? (
          <div className="stp-trigger" style={{ cursor: "default" }}>
            <DestinationIcon type={d.type} size={18} /> <span className="stp-name">{DEST_TYPES.find((t) => t.value === d.type)?.label}</span>
          </div>
        ) : (
          <OptionPicker
            ariaLabel="Destination type"
            value={d.type}
            onChange={(v) => set({ type: v as DestDraft["type"], name: d.name || (v === "MOCK_API" ? "mock-api" : "") })}
            options={DEST_TYPES.map((t) => ({ ...t, icon: <DestinationIcon type={t.value} size={18} /> }))}
          />
        )}
      </Field>

      {d.type && (
        <>
          <Field label="Destination Name *" hint={<><Info size={13} style={{ verticalAlign: -2 }} /> Used to identify your destination across EaseWebhook.</>}>
            <input className="input mono" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={d.type === "MOCK_API" ? "mock-api" : "my-api"} required />
          </Field>

          {d.type === "HTTP" && (
            <Field label="Endpoint URL *" hint="Events are delivered here. The sub-path after the source key is appended when path forwarding is on.">
              <input className="input mono" placeholder="https://api.example.com/webhooks" value={d.url} onChange={(e) => set({ url: e.target.value })} required />
            </Field>
          )}
          {d.type === "MOCK_API" && (
            <p className="muted small" style={{ margin: 0 }}>
              Delivers to the built-in mock endpoint, which accepts every request and answers 200 — handy for trying filters and transformations.
            </p>
          )}

          <Collapse title="Advanced configuration">
            <div className="field-row">
              <Field label="HTTP method">
                <select className="select" value={d.method} onChange={(e) => set({ method: e.target.value })}>
                  <option value="">Same as original request</option>
                  {METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Path forwarding">
                <label className="check" style={{ height: 32 }}>
                  <input type="checkbox" checked={d.pathForwarding} onChange={(e) => set({ pathForwarding: e.target.checked })} />
                  Append the request's sub-path
                </label>
              </Field>
            </div>
            {d.type === "HTTP" && (
              <>
                <Field label="Destination authentication">
                  <select className="select" value={d.authType} onChange={(e) => set({ authType: e.target.value as AuthType, auth: {} })}>
                    <option value="NONE">None</option>
                    <option value="BEARER_TOKEN">Bearer token</option>
                    <option value="BASIC_AUTH">Basic auth</option>
                    <option value="API_KEY">API key</option>
                    <option value="EASE_SIGNATURE">EaseWebhook signature (HMAC-SHA256)</option>
                  </select>
                </Field>
                {d.authType === "BEARER_TOKEN" && (
                  <Field label="Token"><SecretInput value={d.auth.token ?? ""} onChange={(v) => setAuth("token", v)} /></Field>
                )}
                {d.authType === "BASIC_AUTH" && (
                  <div className="field-row">
                    <Field label="Username"><input className="input" value={d.auth.username ?? ""} onChange={(e) => setAuth("username", e.target.value)} /></Field>
                    <Field label="Password"><SecretInput value={d.auth.password ?? ""} onChange={(v) => setAuth("password", v)} /></Field>
                  </div>
                )}
                {d.authType === "API_KEY" && (
                  <div className="field-row">
                    <Field label="Key name"><input className="input" placeholder="X-Api-Key" value={d.auth.key ?? ""} onChange={(e) => setAuth("key", e.target.value)} /></Field>
                    <Field label="Value"><SecretInput value={d.auth.api_key ?? ""} onChange={(v) => setAuth("api_key", v)} /></Field>
                    <Field label="Send in">
                      <select className="select" value={d.auth.to ?? "header"} onChange={(e) => setAuth("to", e.target.value)}>
                        <option value="header">Header</option>
                        <option value="query">Query string</option>
                      </select>
                    </Field>
                  </div>
                )}
                {d.authType === "EASE_SIGNATURE" && (
                  <Field label="Signing secret" hint="Header X-Ease-Signature: v1=hex(HMAC-SHA256(secret, timestamp + '.' + body)), timestamp in X-Ease-Timestamp.">
                    <SecretInput value={d.auth.secret ?? ""} onChange={(v) => setAuth("secret", v)} />
                  </Field>
                )}
              </>
            )}
          </Collapse>

          <Collapse title="Delivery policy" open>
            <div className="policy">
              <div className="policy-opt">
                <Toggle checked={d.rateOn} onChange={(v) => set({ rateOn: v })} label={<>Max delivery rate <Info size={14} className="faint" aria-label="Caps how fast events are sent to this destination; extra events wait in the queue." /></>} />
                {d.rateOn && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <input className="input" style={{ width: 110 }} type="number" min={1} value={d.rateLimit} onChange={(e) => set({ rateLimit: e.target.value })} aria-label="Events" />
                    <select className="select" value={d.ratePeriod} onChange={(e) => set({ ratePeriod: e.target.value as DestDraft["ratePeriod"] })} aria-label="Period">
                      <option value="second">events per second</option>
                      <option value="minute">events per minute</option>
                      <option value="hour">events per hour</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </Collapse>
        </>
      )}
    </>
  );
}

export function DestinationForm({
  destination,
  onClose,
  onSaved,
  focus,
}: {
  destination?: Destination;
  onClose: () => void;
  onSaved: () => void;
  focus?: "policy";
}) {
  const [d, setD] = useState(() => {
    const x = destDraft(destination);
    if (focus === "policy" && !x.rateOn) x.rateOn = true;
    return x;
  });
  const { run, busy } = useAction();
  const set = (p: Partial<DestDraft>) => setD((x) => ({ ...x, ...p }));
  const save = async () => {
    const body = destPayload(d);
    const r = await run(
      () => (destination ? api.put(`/destinations/${destination.id}`, body) : api.post("/destinations", body)),
      destination ? "Destination updated" : "Destination created",
    );
    if (r) onSaved();
  };
  return (
    <Drawer
      title={destination ? `Edit ${destination.name}` : "Add new destination"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !destValid(d)} onClick={save}>
            <SaveIcon size={15} /> Save
          </button>
        </>
      }
    >
      <DestinationFields d={d} set={set} />
    </Drawer>
  );
}

// ======================= Connection =======================

type RuleType = Rule["type"];
const DEFAULT_ORDER: RuleType[] = ["transform", "filter", "delay", "retry"];

export interface RuleDraft {
  order: RuleType[]; // rules run top to bottom; reorder by drag and drop
  retryOn: boolean;
  strategy: "linear" | "exponential";
  count: string;
  intervalSec: string;
  filterOn: boolean;
  filterBody: string;
  filterHeaders: string;
  transformOn: boolean;
  transformationId: string;
  delayOn: boolean;
  delaySec: string;
}

export function rulesDraft(rules: Rule[] = []): RuleDraft {
  const r = (t: RuleType) => rules.find((x) => x.type === t);
  const retry = r("retry");
  const filter = r("filter");
  const tr = r("transform");
  const delay = r("delay");
  const existing = rules.map((x) => x.type);
  return {
    order: [...existing, ...DEFAULT_ORDER.filter((t) => !existing.includes(t))],
    retryOn: !!retry,
    strategy: retry?.strategy ?? "linear",
    count: String(retry?.count ?? 5),
    intervalSec: String((retry?.interval ?? 60_000) / 1000),
    filterOn: !!filter,
    filterBody: filter?.body ? pretty(filter.body) : "",
    filterHeaders: filter?.headers ? pretty(filter.headers) : "",
    transformOn: !!tr,
    transformationId: tr?.transformation_id ?? "",
    delayOn: !!delay,
    delaySec: String((delay?.delay ?? 5000) / 1000),
  };
}

// Rules are sent in the order shown, e.g. transform above filter lets the filter match transformed payloads.
export function rulesPayload(d: RuleDraft): { rules?: Rule[]; error?: string } {
  const rules: Rule[] = [];
  for (const t of d.order) {
    if (t === "transform" && d.transformOn) {
      if (!d.transformationId) return { error: "Pick a transformation" };
      rules.push({ type: "transform", transformation_id: d.transformationId });
    }
    if (t === "filter" && d.filterOn) {
      const b = tryParseJSON(d.filterBody);
      const h = tryParseJSON(d.filterHeaders);
      if (!b.ok) return { error: `Filter body: ${b.error}` };
      if (!h.ok) return { error: `Filter headers: ${h.error}` };
      rules.push({ type: "filter", body: b.value, headers: h.value });
    }
    if (t === "delay" && d.delayOn) rules.push({ type: "delay", delay: Math.round(Number(d.delaySec) * 1000) });
    if (t === "retry" && d.retryOn)
      rules.push({ type: "retry", strategy: d.strategy, count: Number(d.count), interval: Math.round(Number(d.intervalSec) * 1000) });
  }
  return { rules };
}

export function RulesEditor({ d, set }: { d: RuleDraft; set: (p: Partial<RuleDraft>) => void }) {
  const trs = useQuery(() => api.get<Page<Transformation>>("/transformations", { limit: 250 }), []);
  const [dragging, setDragging] = useState<RuleType>();
  const [over, setOver] = useState<RuleType>();

  const move = (from: RuleType, to: RuleType) => {
    if (from === to) return;
    const next = d.order.filter((t) => t !== from);
    next.splice(next.indexOf(to) + (d.order.indexOf(from) < d.order.indexOf(to) ? 1 : 0), 0, from);
    set({ order: next });
  };

  const sections: Record<RuleType, { title: string; icon: React.ReactNode; on: boolean; toggle: (v: boolean) => void; body: React.ReactNode }> = {
    retry: {
      title: "Retry",
      icon: <RotateCw size={15} />,
      on: d.retryOn,
      toggle: (v) => set({ retryOn: v }),
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Strategy">
            <select className="select" value={d.strategy} onChange={(e) => set({ strategy: e.target.value as RuleDraft["strategy"] })}>
              <option value="linear">Linear</option>
              <option value="exponential">Exponential</option>
            </select>
          </Field>
          <Field label="Max retries">
            <input className="input" type="number" min={1} max={50} value={d.count} onChange={(e) => set({ count: e.target.value })} />
          </Field>
          <Field label="Interval (seconds)">
            <input className="input" type="number" min={1} value={d.intervalSec} onChange={(e) => set({ intervalSec: e.target.value })} />
          </Field>
        </div>
      ),
    },
    transform: {
      title: "Transform",
      icon: <FileCode2 size={15} />,
      on: d.transformOn,
      toggle: (v) => set({ transformOn: v }),
      body: (
        <select className="select" value={d.transformationId} onChange={(e) => set({ transformationId: e.target.value })}>
          <option value="">Select a transformation…</option>
          {trs.data?.models.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ),
    },
    filter: {
      title: "Filter",
      icon: <Filter size={15} />,
      on: d.filterOn,
      toggle: (v) => set({ filterOn: v }),
      body: (
        <>
          <Field label="Body" hint={<>e.g. <code>{'{"type": {"$startsWith": "order."}}'}</code> — operators: $eq $neq $gt $gte $lt $lte $in $nin $startsWith $endsWith $exist $or $and $not</>}>
            <textarea className="textarea" rows={4} value={d.filterBody} onChange={(e) => set({ filterBody: e.target.value })} />
          </Field>
          <Field label="Headers">
            <textarea className="textarea" rows={2} value={d.filterHeaders} onChange={(e) => set({ filterHeaders: e.target.value })} placeholder='{"x-event": "paid"}' />
          </Field>
        </>
      ),
    },
    delay: {
      title: "Delay",
      icon: <Clock size={15} />,
      on: d.delayOn,
      toggle: (v) => set({ delayOn: v }),
      body: (
        <Field label="Delay (seconds)">
          <input className="input" type="number" min={1} value={d.delaySec} onChange={(e) => set({ delaySec: e.target.value })} />
        </Field>
      ),
    },
  };

  return (
    <>
      <span className="hint faint" style={{ fontSize: 12, marginTop: -10 }}>Rules run top to bottom. Drag the handle to reorder.</span>
      {d.order.map((t) => {
        const s = sections[t];
        return (
          <div
            key={t}
            className={`fieldset rule-card ${dragging === t ? "dragging" : ""} ${over === t && dragging !== t ? "drop-target" : ""}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(t);
            }}
            onDragLeave={() => setOver((o) => (o === t ? undefined : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) move(dragging, t);
              setDragging(undefined);
              setOver(undefined);
            }}
          >
            <div className="fieldset-title">
              <span
                className="drag-handle"
                draggable
                title="Drag to reorder"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", t);
                  setDragging(t);
                }}
                onDragEnd={() => (setDragging(undefined), setOver(undefined))}
              >
                <GripVertical size={15} />
              </span>
              <Toggle checked={s.on} onChange={s.toggle} label={<span className="rule-title">{s.icon} {s.title}</span>} />
            </div>
            {s.on && s.body}
          </div>
        );
      })}
    </>
  );
}
