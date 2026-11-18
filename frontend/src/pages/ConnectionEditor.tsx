import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Crosshair, ListChecks, RadioTower, Tag } from "lucide-react";
import { api, type Connection, type Destination, type Page, type Source, type Transformation } from "../lib/api";
import { useQuery } from "../lib/hooks";
import {
  DestinationFields,
  RulesEditor,
  SourceFields,
  destDraft,
  destPayload,
  destValid,
  rulesDraft,
  rulesPayload,
  sourceDraft,
  sourcePayload,
} from "../components/forms";
import { FlowDiagram, nodeKind } from "../components/FlowDiagram";
import { CopyText, ErrorBox, Field, Loading, useAction } from "../components/ui";
import { OptionPicker } from "../components/OptionPicker";
import { SourceTypeIcon } from "../components/SourceIcon";
import { DestinationIcon } from "../components/DestinationIcon";
import { ObStep, RadioCard } from "./ConnectionTest";

type Mode = "existing" | "new";

/** Full-page create / edit for a connection: source → rules → destination, with a live diagram. */
export function ConnectionEditorPage() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const existing = useQuery(() => (id ? api.get<Connection>(`/connections/${id}`) : Promise.resolve(undefined)), [id]);
  const sources = useQuery(() => api.get<Page<Source>>("/sources", { limit: 250 }), []);
  const dests = useQuery(() => api.get<Page<Destination>>("/destinations", { limit: 250 }), []);
  const trs = useQuery(() => api.get<Page<Transformation>>("/transformations", { limit: 250 }), []);

  const [srcMode, setSrcMode] = useState<Mode>(params.get("source_id") ? "existing" : "new");
  const [srcId, setSrcId] = useState(params.get("source_id") ?? "");
  const [src, setSrc] = useState(() => sourceDraft());
  const [dstMode, setDstMode] = useState<Mode>(params.get("destination_id") ? "existing" : "new");
  const [dstId, setDstId] = useState(params.get("destination_id") ?? "");
  const [dst, setDst] = useState(() => destDraft());
  const [rules, setRules] = useState(() => rulesDraft());
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const { run, busy } = useAction();

  // Prefill when editing.
  useEffect(() => {
    const c = existing.data;
    if (!c) return;
    setName(c.name);
    setRules(rulesDraft(c.rules));
    setDstMode("existing");
    setDstId(c.destination_id);
  }, [existing.data]);

  const srcList = sources.data?.models ?? [];
  const dstList = dests.data?.models ?? [];

  const selSrc = editing ? existing.data?.source : srcMode === "existing" ? srcList.find((s) => s.id === srcId) : undefined;
  const selDst = dstMode === "existing" ? dstList.find((d) => d.id === dstId) : undefined;

  const srcLabel = selSrc?.name ?? (srcMode === "new" ? src.name : "");
  const dstLabel = selDst?.name ?? (dstMode === "new" ? dst.name : "");
  const dstUrl = selDst?.url ?? (dstMode === "new" ? dst.url : "");

  const ruleLabels = rules.order.filter((t) => rules[`${t}On` as "retryOn"]).map((t) => {
    if (t === "transform") return trs.data?.models.find((x) => x.id === rules.transformationId)?.name ?? "transform";
    if (t === "retry") return `retry ×${rules.count}`;
    return t;
  });

  const canSave =
    (editing || (srcMode === "existing" ? !!srcId : !!src.name.trim())) && (dstMode === "existing" ? !!dstId : destValid(dst));

  const save = async () => {
    const r = rulesPayload(rules);
    if (r.error) return setErr(r.error);
    setErr("");
    const body: Record<string, unknown> = { name: name.trim() || undefined, rules: r.rules };
    if (!editing) {
      if (srcMode === "existing") body.source_id = srcId;
      else body.source = sourcePayload(src, false);
    }
    if (dstMode === "existing") body.destination_id = dstId;
    else body.destination = destPayload(dst);

    const c = await run(
      () => (editing ? api.put<Connection>(`/connections/${id}`, body) : api.post<Connection>("/connections", body)),
      editing ? "Connection saved" : undefined,
    );
    if (!c) return;
    navigate(editing ? "/connections" : `/connections/${c.id}/test`);
  };

  if (editing && existing.loading && !existing.data) return <Loading />;

  return (
    <>
      <header className="page-header">
        <button className="btn icon ghost" onClick={() => navigate("/connections")} aria-label="Back to connections"><ArrowLeft /></button>
        <h1>{editing ? `Edit ${existing.data?.full_name ?? "connection"}` : "Create connection"}</h1>
        <span className="spacer" />
        {err && <span className="form-error">{err}</span>}
        <button className="btn" onClick={() => navigate("/connections")}>Cancel</button>
        <button className="btn primary" disabled={busy || !canSave} onClick={save}>
          {editing ? "Save changes" : "Create connection"}
        </button>
      </header>
      <ErrorBox error={existing.error ?? sources.error ?? dests.error} />

      <div className="ce-grid">
        <div className="ce-form-scroll">
        <div className="ce-form ce-timeline">
          <ObStep icon={<RadioTower size={15} />} title="Define your event source"
            text="Configure the endpoint representing your HTTP request producer.">
            {editing ? (
              <div className="stp-trigger" style={{ cursor: "default", maxWidth: 520 }}>
                <SourceTypeIcon type={existing.data?.source.type} size={18} /> <span className="stp-name">{existing.data?.source.name}</span>
              </div>
            ) : (
              <div className="ce-step-fields">
                <ModeCards value={srcMode} onChange={setSrcMode} hasExisting={srcList.length > 0} kind="source" />
                {srcMode === "existing" ? (
                  <Field label="Source *">
                    <OptionPicker
                      ariaLabel="Source"
                      searchable
                      value={srcId}
                      onChange={setSrcId}
                      options={srcList.map((x) => ({ value: x.id, label: x.name, icon: <SourceTypeIcon type={x.type} size={18} /> }))}
                    />
                  </Field>
                ) : (
                  <SourceFields d={src} set={(p) => setSrc((x) => ({ ...x, ...p }))} />
                )}
              </div>
            )}
          </ObStep>

          <ObStep icon={<Crosshair size={15} />} title="Define your event destination"
            text="Configure the destination you'd like events routed to.">
            <div className="ce-step-fields">
              <ModeCards value={dstMode} onChange={setDstMode} hasExisting={dstList.length > 0} kind="destination" />
              {dstMode === "existing" ? (
                <Field label="Destination *">
                  <OptionPicker
                    ariaLabel="Destination"
                    searchable
                    value={dstId}
                    onChange={setDstId}
                    options={dstList.map((x) => ({ value: x.id, label: x.name, description: x.url, icon: <DestinationIcon type={x.type} size={18} /> }))}
                  />
                </Field>
              ) : (
                <DestinationFields d={dst} set={(p) => setDst((x) => ({ ...x, ...p }))} />
              )}
            </div>
          </ObStep>

          <ObStep icon={<ListChecks size={15} />} title="Define your connection rules" tag="Optional"
            text="Configure rules that dictate how events are routed to your destination. They run top to bottom.">
            <div className="ce-step-fields">
              <RulesEditor d={rules} set={(p) => setRules((x) => ({ ...x, ...p }))} />
            </div>
          </ObStep>

          <ObStep icon={<Tag size={15} />} title="Name your connection" tag="Optional" last
            text="Defaults to the destination name.">
            <div className="ce-step-fields">
              <input className="input" placeholder={dstLabel || "connection-name"} value={name} onChange={(e) => setName(e.target.value)} aria-label="Connection name" />
            </div>
          </ObStep>
        </div>
        </div>

        <aside className="ce-preview">
          <div className="section-title">Preview</div>
          <FlowDiagram
            source={{ label: srcLabel || "source", placeholder: !srcLabel }}
            destinations={[{ label: dstLabel || "destination", kind: nodeKind(dstUrl), placeholder: !dstLabel }]}
            rules={ruleLabels}
          />
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Source URL</dt>
            <dd className="mono">{selSrc ? <CopyText text={selSrc.url} /> : <span className="faint">Generated when you create it</span>}</dd>
            <dt>Delivers to</dt>
            <dd className="mono">{dstUrl || <span className="faint">—</span>}</dd>
            <dt>Rules</dt>
            <dd>{ruleLabels.length ? ruleLabels.join(" → ") : <span className="faint">None — every event is delivered as-is</span>}</dd>
          </dl>
        </aside>
      </div>
    </>
  );
}

function ModeCards({ value, onChange, hasExisting, kind }: { value: Mode; onChange: (m: Mode) => void; hasExisting: boolean; kind: string }) {
  return (
    <div className="ob-radios compact" role="radiogroup">
      <RadioCard on={value === "new"} onClick={() => onChange("new")} title={`Create new ${kind}`} />
      <RadioCard
        on={value === "existing"}
        onClick={() => hasExisting && onChange("existing")}
        title={`Re-use existing ${kind}`}
        disabled={!hasExisting}
      />
    </div>
  );
}
