import { Fragment, useState, type FormEvent } from "react";
import { BookOpen, Check, ChevronRight, CircleAlert, Copy, KeyRound, Loader2, Plug, Plus, Trash2 } from "lucide-react";
import { api, mcpCall } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { useWorkspace } from "../lib/workspace";
import { fmtDate } from "../lib/format";
import { ALL_TOOLS, TOOLS, type Kind } from "../lib/mcpTools";
import { PageHeader } from "../components/Layout";
import { WindowDots } from "../components/WindowDots";
import { AgentClientPicker } from "../components/AgentClientPicker";
import { AGENT_CLIENTS, clientById } from "../lib/agentClients";
import { Badge, CopyText, ErrorBox, Field, Loading, useAction, useToast } from "../components/ui";

const PROD_MCP = "https://easewebhook.onrender.com/mcp";
const DOCS = "https://github.com/RazikShariff1/easewebhook/tree/main/backend/internal/mcpserver";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  key?: string;
}

const KIND: Record<Kind, { label: string; tone: "neutral" | "warn" | "danger" }> = {
  read: { label: "read-only", tone: "neutral" },
  write: { label: "write", tone: "warn" },
  destructive: { label: "destructive", tone: "danger" },
};

export function AiAgentsPage() {
  const { current } = useWorkspace();
  const toast = useToast();
  const { run, busy } = useAction();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<ApiKey | null>(null);
  const [client, setClient] = useState(AGENT_CLIENTS[0].id);
  const [open, setOpen] = useState<string | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "fail"; text?: string }>({ state: "idle" });

  const keys = useQuery(() => api.get<ApiKey[]>("/api-keys"), [current.id]);
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const url = local ? "http://localhost:8000/mcp" : PROD_MCP;
  const agent = clientById(client);
  const snippetText = agent.snippet(url, fresh?.key ?? "<your API key>");

  const copy = (text: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast("Copied to clipboard"))
      .catch(() => toast("Your browser blocked copying; select the text instead", "error"));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const k = await run(() => api.post<ApiKey>("/api-keys", { name: name.trim() || "API key" }), "API key created");
    if (k) {
      setFresh(k);
      setName("");
      keys.reload();
    }
  };

  // Calls tools/list on the MCP endpoint exactly like an AI app would, with the new key if there is one.
  const testConnection = async () => {
    setTest({ state: "busy" });
    const t0 = performance.now();
    try {
      const r = await mcpCall<{ tools: unknown[] }>("tools/list", {}, fresh?.key);
      const ms = Math.round(performance.now() - t0);
      setTest({ state: "ok", text: `Connected${fresh ? " with your new key" : ""} · ${r.tools.length} tools available · ${ms} ms` });
      if (fresh) keys.reload(); // the test just used the key: refresh "Last used"
    } catch (e) {
      setTest({ state: "fail", text: (e as Error).message });
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke "${k.name}"? AI apps using it stop working right away.`)) return;
    if (await run(() => api.del(`/api-keys/${k.id}`).then(() => true), "API key revoked")) {
      if (fresh?.id === k.id) setFresh(null);
      keys.reload();
    }
  };

  return (
    <>
      <PageHeader title="AI agents">
        <a className="btn" href={DOCS} target="_blank" rel="noreferrer"><BookOpen /> Docs</a>
      </PageHeader>
      <div className="content">
        <div className="settings ai-page">
          <section className="ai-intro">
            <div>
              <h2>Let AI agents work in {current.name}</h2>
              <p className="muted">
                Connect Claude, Cursor, VS Code or any MCP client. Agents can look up requests and events, explain failed
                deliveries, and manage sources, connections and retries. Your AI app asks you before anything that changes data.
              </p>
            </div>
            <div className="ai-intro-stats">
              <div><strong>{ALL_TOOLS.length}</strong><span>tools</span></div>
              <div><strong>{AGENT_CLIENTS.length - 1}+</strong><span>AI apps</span></div>
            </div>
          </section>
          <section className="settings-card">
            <h2><span className="step-num">1</span>Create an API key</h2>
            <p className="muted settings-text">Each AI app gets its own key, so you can revoke one without breaking the others.</p>
            <form onSubmit={create} className="settings-row">
              <Field label="New key">
                <input className="input" placeholder="e.g. Claude Code on my laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </Field>
              <button className="btn primary" type="submit" disabled={busy}><Plus /> Create key</button>
            </form>
            <span className="hint key-hint">Works only in {current.name}. It can't manage members or other keys.</span>

            {fresh?.key && (
              <div className="new-key">
                <div><Check /> Copy this key now. It won't be shown again.</div>
                <div className="new-key-row">
                  <code>{fresh.key}</code>
                  <button className="btn sm" onClick={() => copy(fresh.key!)}><Copy /> Copy</button>
                </div>
              </div>
            )}

            <ErrorBox error={keys.error} />
            {!keys.data ? (
              <Loading />
            ) : keys.data.length === 0 ? (
              <div className="faint" style={{ fontSize: 13 }}>No keys yet.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hide-sm">Key</th>
                    <th className="hide-sm">Created</th>
                    <th>Last used</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {keys.data.map((k) => (
                    <tr key={k.id}>
                      <td><KeyRound size={13} className="faint" style={{ verticalAlign: -2, marginRight: 8 }} />{k.name}</td>
                      <td className="mono faint hide-sm">{k.prefix}…</td>
                      <td className="muted nowrap hide-sm">{fmtDate(k.created_at)}</td>
                      <td className="muted nowrap">{k.last_used_at ? fmtDate(k.last_used_at) : "Never"}</td>
                      <td>
                        <button className="btn icon ghost" title="Revoke" aria-label={`Revoke ${k.name}`} onClick={() => revoke(k)} disabled={busy}>
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="settings-card">
            <h2><span className="step-num">2</span>Connect your AI app</h2>
            <p className="muted settings-text">
              {agent.hint}{" "}
              {fresh?.key ? <span className="key-filled"><Check /> Your new key is filled in.</span> : "Create a key above and it's filled in here."}
            </p>
            <div className="agent-box">
              <div className="agent-box-bar">
                <WindowDots />
                <AgentClientPicker value={client} onChange={setClient} />
                <span className="agent-box-file mono">{agent.file}</span>
                <button className="btn sm" onClick={() => copy(snippetText)}><Copy /> Copy</button>
              </div>
              <pre className="agent-box-code">{snippetText}</pre>
            </div>
          </section>
          <section className="settings-card">
            <h2><span className="step-num">3</span>Check the connection</h2>
            <p className="muted settings-text">
              Calls the server the same way your AI app will{fresh ? ", using your new key" : ""}.
            </p>
            <div className="settings-row">
              <Field label="Server URL">
                <div className="input mono-input"><CopyText text={url} /></div>
              </Field>
              <button className="btn" onClick={testConnection} disabled={test.state === "busy"}>
                {test.state === "busy" ? <Loader2 className="spin" /> : <Plug />} Test connection
              </button>
            </div>
            {(test.state === "ok" || test.state === "fail") && (
              <div className={`mcp-test ${test.state}`}>
                {test.state === "ok" ? <Check /> : <CircleAlert />}
                {test.text}
              </div>
            )}
          </section>



          <section className="settings-card">
            <h2>Tools <span className="count-pill">{ALL_TOOLS.length}</span></h2>
            <table className="table tool-table">
              <tbody>
                {TOOLS.map((g) => {
                  const expanded = open === g.area;
                  const n = (k: Kind) => g.tools.filter((t) => t.kind === k).length;
                  return (
                    <Fragment key={g.area}>
                      <tr className="clickable tool-area" onClick={() => setOpen(expanded ? null : g.area)} aria-expanded={expanded}>
                        <td>
                          <span className="tool-area-name">
                            <ChevronRight className={`chev ${expanded ? "open" : ""}`} />
                            {g.area}
                            <span className="faint">· {g.tools.length}</span>
                          </span>
                        </td>
                        <td className="tool-kinds">
                          {(["read", "write", "destructive"] as const).map((k) =>
                            n(k) ? <Badge key={k} tone={KIND[k].tone}>{n(k)} {KIND[k].label}</Badge> : null,
                          )}
                        </td>
                      </tr>
                      {expanded &&
                        g.tools.map((t) => (
                          <tr key={t.name} className="tool-row">
                            <td>
                              <div className="mono">{t.name}</div>
                              <div className="faint">{t.does}</div>
                            </td>
                            <td className="tool-kinds"><Badge tone={KIND[t.kind].tone}>{KIND[t.kind].label}</Badge></td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="faint" style={{ fontSize: 12 }}>
              Every call runs with your permissions in this workspace. Bulk retry and cancel need a filter.{" "}
              <a href={DOCS} target="_blank" rel="noreferrer">Docs</a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
