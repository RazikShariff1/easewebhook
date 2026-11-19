import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpDown, FileCode2, PlusCircle, Search, Trash2 } from "lucide-react";
import { api, type Page, type Transformation, type TransformRun, type WebhookRequest } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, pretty, timeAgo, tryParseJSON } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { TransformFlow } from "../components/TransformFlow";
import { RunIcon } from "../components/RunIcon";
import { SaveIcon, type SaveState } from "../components/SaveIcon";
import { Splitter } from "../components/Splitter";
import { useSplit } from "../lib/split";
import { ChangeList, diffRequests, prettyWithLines } from "../components/TransformRunFlow";
import { Empty, ErrorBox, Loading, Select, useAction } from "../components/ui";

const JsonEditor = lazy(() => import("../components/JsonEditor").then((m) => ({ default: m.JsonEditor })));
const CodeEditor = lazy(() => import("../components/CodeEditor").then((m) => ({ default: m.CodeEditor })));

const TEMPLATE = `addHandler("transform", (request, context) => {
  // request = { method, path, query, headers, body }
  // process.env holds this transformation's variables
  request.headers["x-processed-by"] = "easewebhook";

  if (request.body && typeof request.body === "object") {
    request.body.event_type = "purchases";
  }

  return request;
});
`;

const SAMPLE = {
  method: "POST",
  path: "",
  query: "",
  headers: { "content-type": "application/json" },
  body: { event_details: [{ date: "05_15_2025" }] },
};

export function TransformationsPage() {
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const navigate = useNavigate();
  const list = useQuery(() => api.get<Page<Transformation>>("/transformations", { name: q, limit: 250 }), [q]);
  const rows = order === "oldest" ? [...(list.data?.models ?? [])].reverse() : list.data?.models ?? [];
  const isEmpty = !list.loading && rows.length === 0 && !q;

  return (
    <>
      <PageHeader title="Transformations">
        <button className="btn primary" onClick={() => navigate("/transformations/new")}><PlusCircle /> New transformation</button>
      </PageHeader>
      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="spacer" />
        <Select icon={<ArrowUpDown />} prefix="Order by" value={order} onChange={setOrder}
          options={[{ value: "newest", label: "Newest → Oldest" }, { value: "oldest", label: "Oldest → Newest" }]} />
      </div>
      <div className="content">
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? (
          <Loading />
        ) : isEmpty ? (
          <div className="hero-empty">
            <div style={{ alignSelf: "center" }}>
              <h3>Modify event payloads</h3>
              <p>
                Transformations are a rule that lets you use a JavaScript function to modify the request body, headers, query, or
                path before it reaches your endpoint.
              </p>
              <button className="btn primary" onClick={() => navigate("/transformations/new")}><PlusCircle /> Create a transformation</button>
            </div>
            <TransformFlow />
          </div>
        ) : rows.length === 0 ? (
          <Empty title="No matching transformations" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Variables</th>
                <th>Updated</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/transformations/${t.id}`)}>
                  <td><span className="tag"><FileCode2 />{t.name}</span></td>
                  <td className="muted">{Object.keys(t.env).length || "—"}</td>
                  <td className="muted">{timeAgo(t.updated_at)}</td>
                  <td className="muted">{fmtDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function envToText(env: Record<string, string>) {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
}

function textToEnv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function TransformationEditor() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const { run, busy } = useAction();

  const existing = useQuery(() => (isNew ? Promise.resolve(undefined) : api.get<Transformation>(`/transformations/${id}`)), [id]);
  const recent = useQuery(() => api.get<Page<WebhookRequest>>("/requests", { limit: 20 }), []);

  const [name, setName] = useState("");
  const [code, setCode] = useState(TEMPLATE);
  const [env, setEnv] = useState("");
  const [input, setInput] = useState(pretty(SAMPLE));
  const [result, setResult] = useState<TransformRun>();
  const [tab, setTab] = useState<"output" | "env">("output");

  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name);
      setCode(existing.data.code);
      setEnv(envToText(existing.data.env));
    }
  }, [existing.data]);

  // draggable dividers: code | right panel, and input | output inside the right panel
  const gridRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const colSplit = useSplit("easewebhook:tr:col", 0.5, 0.25, 0.75);
  const rowSplit = useSplit("easewebhook:tr:row", 0.42, 0.15, 0.8);

  const [running, setRunning] = useState(false);

  const runTest = async () => {
    const parsed = tryParseJSON(input);
    if (!parsed.ok) {
      setResult({ request: null, console: [], error: `Input JSON: ${parsed.error}` });
      return;
    }
    const started = performance.now();
    setRunning(true);
    let r: TransformRun | undefined;
    let failure: string | undefined;
    try {
      r = await api.post<TransformRun>("/transformations/run", { code, env: textToEnv(env), request: parsed.value });
    } catch (e) {
      failure = (e as Error).message || "request failed";
    }
    // keep the "running" state visible long enough to read, even when the backend answers instantly
    await new Promise((res) => setTimeout(res, Math.max(0, 450 - (performance.now() - started))));
    setRunning(false);
    // a failed API call must replace the old result, otherwise the previous output looks like this run's output
    setResult(r ?? { request: null, console: [], error: `Could not run the transformation: ${failure}` });
    setTab("output");
  };

  const sample = useMemo(() => {
    const p = tryParseJSON(input);
    return p.ok && p.value && typeof p.value === "object" ? (p.value as Record<string, unknown>) : undefined;
  }, [input]);

  // clicking a change scrolls the output pane to its line (the output editor is full-height, the panel scrolls)
  const outBoxRef = useRef<HTMLDivElement>(null);
  const outScrollRef = useRef<HTMLDivElement>(null);
  const jumpToLine = (line: number) => {
    const box = outBoxRef.current;
    const sc = outScrollRef.current;
    if (!box || !sc) return;
    const y = box.getBoundingClientRect().top + 10 + (line - 1) * 20;
    sc.scrollBy({ top: y - (sc.getBoundingClientRect().top + sc.clientHeight / 2), behavior: "smooth" });
  };
  const changes = useMemo(() => (result && !result.error ? diffRequests(sample, result.request) : []), [result, sample]);
  // the printed output, plus the lines the transformation added or changed (for in-place highlighting)
  const out = useMemo(() => prettyWithLines(result?.request ?? {}), [result]);
  const marks = useMemo(
    () => changes.filter((c) => c.kind !== "removed" && out.lineOf.has(c.path)).map((c) => ({ line: out.lineOf.get(c.path)!, kind: c.kind as "added" | "changed" })),
    [changes, out],
  );

  const [saveState, setSaveState] = useState<SaveState>("idle");

  const save = async () => {
    const body = { name, code, env: textToEnv(env) };
    setSaveState("saving");
    const r = await run(
      () => (isNew ? api.post<Transformation>("/transformations", body) : api.put<Transformation>(`/transformations/${id}`, body)),
      "Transformation saved",
    );
    if (r) {
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1800); // show the checkmark briefly
    } else {
      setSaveState("idle");
    }
    if (r && isNew) navigate(`/transformations/${r.id}`, { replace: true });
    else existing.reload();
  };

  const remove = async () => {
    if (!confirm(`Delete transformation "${name}"?`)) return;
    const r = await run(() => api.del(`/transformations/${id}`).then(() => true), "Transformation deleted");
    if (r) navigate("/transformations");
  };

  const loadRequest = (reqId: string) => {
    const r = recent.data?.models.find((x) => x.id === reqId);
    if (r) setInput(pretty({ method: r.method, path: r.path, query: r.query, headers: r.headers, body: r.body }));
  };

  if (existing.loading && !isNew && !existing.data) return <Loading />;

  return (
    <>
      <header className="page-header">
        <button className="btn icon ghost" onClick={() => navigate("/transformations")} aria-label="Back"><ArrowLeft /></button>
        <input
          className="input"
          style={{ width: 300 }}
          placeholder="transformation-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={isNew}
        />
        <span className="spacer" style={{ flex: 1 }} />
        {!isNew && <button className="btn danger" onClick={remove} disabled={busy}><Trash2 /> Delete</button>}
        <button className="btn primary" onClick={save} disabled={busy || !name.trim()}><SaveIcon state={saveState} /> {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}</button>
      </header>
      <ErrorBox error={existing.error} />
      <div className={`editor-grid ${colSplit.dragging || rowSplit.dragging ? "dragging" : ""}`} ref={gridRef} style={{ gridTemplateColumns: `${colSplit.frac}fr 6px ${1 - colSplit.frac}fr` }}>
        <div className="editor-col">
          <div className="head">
            <FileCode2 size={14} /> Code
            <button className="btn run sm" style={{ marginLeft: "auto" }} onClick={runTest} disabled={busy || running}>
              <RunIcon running={running} /> Run transformation <kbd className="kbd">⌘↵</kbd>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Suspense fallback={<span className="faint" style={{ padding: 16, display: "block" }}>Loading editor…</span>}>
              <CodeEditor value={code} onChange={setCode} onRun={runTest} onSave={() => name.trim() && save()} sample={sample} error={result?.error} />
            </Suspense>
          </div>
        </div>
        <Splitter axis="x" ctl={colSplit} containerRef={gridRef} label="Resize code and input panels" />
        <div className="editor-col" ref={rightRef}>
          <div className="head">
            Input
            <select className="select" style={{ marginLeft: "auto", height: 26, maxWidth: 260 }} value="" onChange={(e) => loadRequest(e.target.value)}>
              <option value="">Load a recent request…</option>
              {recent.data?.models.map((r) => (
                <option key={r.id} value={r.id}>{r.id} · {timeAgo(r.ingested_at)}</option>
              ))}
            </select>
          </div>
          <div ref={inputBoxRef} style={{ flex: `0 0 ${rowSplit.frac * 100}%`, minHeight: 0 }}>
            <Suspense fallback={<span className="faint" style={{ padding: 16, display: "block" }}>Loading editor…</span>}>
              <JsonEditor path="input.json" value={input} onChange={setInput} />
            </Suspense>
          </div>
          <Splitter axis="y" ctl={rowSplit} containerRef={rightRef} originRef={inputBoxRef} label="Resize input and output" />
          <div className="tabs" style={{ padding: "0 12px" }}>
            <button className={tab === "output" ? "on" : ""} onClick={() => setTab("output")}>Output</button>
            <button className={tab === "env" ? "on" : ""} onClick={() => setTab("env")}>Variables</button>
          </div>
          {tab === "output" ? (
            <div ref={outScrollRef} style={{ flex: "1 1 0", minHeight: 0, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10, opacity: running ? 0.45 : 1, transition: "opacity .15s" }}>
              {!result ? (
                <span className="faint">Run the transformation to see its output.</span>
              ) : result.error ? (
                <div className="error-box" style={{ margin: 0 }}>{result.error}</div>
              ) : (
                <>
                  <div>
                    <div className="section-title">Changes</div>
                    <ChangeList changes={changes} lineOf={out.lineOf} onJump={jumpToLine} />
                  </div>
                  <div>
                    <div className="section-title">Output</div>
                    <div className="jd-out" ref={outBoxRef} style={{ height: Math.min(out.text.split("\n").length * 20 + 20, 560) }}>
                      <Suspense fallback={<pre className="code">{out.text}</pre>}>
                        <JsonEditor readOnly path="output.json" value={out.text} marks={marks} />
                      </Suspense>
                    </div>
                  </div>
                </>
              )}
              {result && result.console.length > 0 && (
                <div>
                  <div className="section-title">Console</div>
                  <pre className="code">{result.console.join("\n")}</pre>
                </div>
              )}
            </div>
          ) : (
            <textarea
              className="textarea"
              style={{ flex: "1 1 0", minHeight: 0 }}
              spellCheck={false}
              placeholder={"API_KEY=abc123\nREGION=in"}
              value={env}
              onChange={(e) => setEnv(e.target.value)}
            />
          )}
        </div>
      </div>
    </>
  );
}
