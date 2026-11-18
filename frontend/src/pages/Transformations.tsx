import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpDown, FileCode2, Play, PlusCircle, Save, Search, Trash2 } from "lucide-react";
import { api, type Page, type Transformation, type TransformRun, type WebhookRequest } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate, pretty, timeAgo, tryParseJSON } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Empty, ErrorBox, Loading, Select, useAction } from "../components/ui";

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
            <div className="hero-code">
              {`{\n  "event_details": [\n    {\n      "date": "05_15_2025"\n`}
              <span className="hl">{`      "event_type": "purchases"`}</span>
              {`\n    }\n  ]\n}`}
            </div>
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

  const runTest = async () => {
    const parsed = tryParseJSON(input);
    if (!parsed.ok) {
      setResult({ request: null, console: [], error: `Input JSON: ${parsed.error}` });
      return;
    }
    const r = await run(() => api.post<TransformRun>("/transformations/run", { code, env: textToEnv(env), request: parsed.value }));
    if (r) {
      setResult(r);
      setTab("output");
    }
  };

  const save = async () => {
    const body = { name, code, env: textToEnv(env) };
    const r = await run(
      () => (isNew ? api.post<Transformation>("/transformations", body) : api.put<Transformation>(`/transformations/${id}`, body)),
      "Transformation saved",
    );
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
        <button className="btn" onClick={runTest} disabled={busy}><Play /> Run</button>
        <button className="btn primary" onClick={save} disabled={busy || !name.trim()}><Save /> Save</button>
      </header>
      <ErrorBox error={existing.error} />
      <div className="editor-grid">
        <div className="editor-col">
          <div className="head">
            <FileCode2 size={14} /> Code
            <span style={{ marginLeft: "auto" }} className="faint">⌘/Ctrl+Enter to run</span>
          </div>
          <textarea
            className="textarea"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runTest();
              if (e.key === "Tab") {
                e.preventDefault();
                const t = e.currentTarget;
                const s = t.selectionStart;
                setCode(code.slice(0, s) + "  " + code.slice(t.selectionEnd));
                requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
              }
            }}
          />
        </div>
        <div className="editor-col">
          <div className="head">
            Input
            <select className="select" style={{ marginLeft: "auto", height: 26, maxWidth: 260 }} value="" onChange={(e) => loadRequest(e.target.value)}>
              <option value="">Load a recent request…</option>
              {recent.data?.models.map((r) => (
                <option key={r.id} value={r.id}>{r.id} · {timeAgo(r.ingested_at)}</option>
              ))}
            </select>
          </div>
          <textarea className="textarea" spellCheck={false} style={{ flex: "1 1 40%" }} value={input} onChange={(e) => setInput(e.target.value)} />
          <div className="tabs" style={{ padding: "0 12px" }}>
            <button className={tab === "output" ? "on" : ""} onClick={() => setTab("output")}>Output</button>
            <button className={tab === "env" ? "on" : ""} onClick={() => setTab("env")}>Variables</button>
          </div>
          {tab === "output" ? (
            <div style={{ flex: "1 1 40%", overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {!result ? (
                <span className="faint">Run the transformation to see its output.</span>
              ) : result.error ? (
                <div className="error-box" style={{ margin: 0 }}>{result.error}</div>
              ) : (
                <pre className="code" style={{ maxHeight: "none" }}>{pretty(result.request)}</pre>
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
              style={{ flex: "1 1 40%" }}
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
