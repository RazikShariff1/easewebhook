import { useMemo, useState } from "react";
import { Bot, Copy, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { getToken } from "../lib/auth";
import { useWorkspace } from "../lib/workspace";
import { fmtDate } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Badge, useToast } from "../components/ui";

const REPO = "https://github.com/RazikShariff1/easewebhook";
const PROD_API = "https://easewebhook.onrender.com";

type Kind = "read" | "write" | "destructive";

const TOOLS: { area: string; tools: [string, Kind][] }[] = [
  { area: "Workspace", tools: [["get_overview", "read"], ["list_workspaces", "read"], ["use_workspace", "write"]] },
  {
    area: "Sources",
    tools: [["list_sources", "read"], ["get_source", "read"], ["list_source_types", "read"], ["create_source", "write"], ["update_source", "write"], ["set_source_enabled", "write"], ["delete_source", "destructive"]],
  },
  {
    area: "Destinations",
    tools: [["list_destinations", "read"], ["get_destination", "read"], ["create_destination", "write"], ["update_destination", "write"], ["set_destination_enabled", "write"], ["delete_destination", "destructive"]],
  },
  {
    area: "Connections",
    tools: [["list_connections", "read"], ["get_connection", "read"], ["create_connection", "write"], ["update_connection", "write"], ["set_connection_state", "write"], ["delete_connection", "destructive"]],
  },
  {
    area: "Transformations",
    tools: [["list_transformations", "read"], ["get_transformation", "read"], ["test_transformation", "read"], ["create_transformation", "write"], ["update_transformation", "write"], ["delete_transformation", "destructive"]],
  },
  { area: "Requests", tools: [["list_requests", "read"], ["get_request", "read"], ["retry_request", "write"]] },
  {
    area: "Events",
    tools: [["list_events", "read"], ["get_event", "read"], ["get_attempt", "read"], ["retry_event", "write"], ["bulk_retry_events", "write"], ["cancel_event", "destructive"], ["bulk_cancel_events", "destructive"]],
  },
];

const KIND_TONE: Record<Kind, "neutral" | "warn" | "danger"> = { read: "neutral", write: "warn", destructive: "danger" };

const PROMPTS = [
  "Why are my Stripe webhooks failing today?",
  "Show me every rejected request from the last hour and why it was rejected.",
  "Retry all failed events for orders-service since 9am. Tell me how many first.",
  "Connect a new GitHub source to https://api.example.com/hooks with 5 exponential retries.",
  "Write a transformation that drops the card details from Razorpay payloads, and test it on the last event.",
];

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor"] as const;
type Client = (typeof CLIENTS)[number];

/** Reads the expiry from the token's payload (it's a JWT); null if it can't be read. */
function tokenExpiry(token: string | null): Date | null {
  try {
    const payload = JSON.parse(atob(token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

export function AiAgentsPage() {
  const { current } = useWorkspace();
  const toast = useToast();
  const [client, setClient] = useState<Client>("Claude Code");
  const [reveal, setReveal] = useState(false);

  const token = getToken() ?? "";
  const expires = useMemo(() => tokenExpiry(token), [token]);
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const apiUrl = local ? "http://localhost:8000" : PROD_API;

  const env: [string, string][] = [
    ["EASEWEBHOOK_TOKEN", token],
    ["EASEWEBHOOK_WORKSPACE_ID", current.id],
    ...(apiUrl !== PROD_API ? ([["EASEWEBHOOK_API_URL", apiUrl]] as [string, string][]) : []),
  ];

  const config = (t: string) => {
    const vars = env.map(([k, v]) => [k, k === "EASEWEBHOOK_TOKEN" ? t : v]);
    if (client === "Claude Code") {
      return ["claude mcp add easewebhook \\", ...vars.map(([k, v]) => `  -e ${k}=${v} \\`), '  -- "$PWD/bin/easewebhook-mcp"'].join("\n");
    }
    return JSON.stringify(
      { mcpServers: { easewebhook: { command: "/path/to/easewebhook/mcp/bin/easewebhook-mcp", env: Object.fromEntries(vars) } } },
      null,
      2,
    );
  };

  const masked = token ? `${token.slice(0, 6)}••••••••${token.slice(-4)}` : "<your token>";
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));

  return (
    <>
      <PageHeader title="AI agents" titleExtra={<Badge tone="neutral">MCP</Badge>} />
      <div className="content">
        <div className="settings ai-agents">
          <section className="settings-card ai-hero">
            <div className="ai-hero-icon"><Bot /></div>
            <div>
              <h2>Manage EaseWebhook by chatting with an AI agent</h2>
              <p className="muted">
                The EaseWebhook MCP server lets Claude, Cursor or any MCP-compatible agent see and manage this workspace.
                It can find failed deliveries and explain why they failed, retry them, and set up sources, connections and transformations.
                It acts as you, in <strong>{current.name}</strong>.
              </p>
              <div className="ai-prompts">
                {PROMPTS.map((p) => (
                  <span key={p} className="ai-prompt">“{p}”</span>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-card">
            <h2><span className="ai-step">1</span>Build the server</h2>
            <p className="muted">It runs on your computer. Your AI app starts it when a session begins and stops it when the session ends. It needs Go 1.27 or newer.</p>
            <Snippet text={`git clone ${REPO}\ncd easewebhook/mcp\ngo build -o bin/easewebhook-mcp .`} onCopy={(t) => copy(t, "Commands")} />
          </section>

          <section className="settings-card">
            <h2><span className="ai-step">2</span>Connect your AI app</h2>
            <div className="tabs">
              {CLIENTS.map((c) => (
                <button key={c} className={client === c ? "on" : ""} onClick={() => setClient(c)}>{c}</button>
              ))}
            </div>
            <p className="muted">
              {client === "Claude Code" && <>Run this inside the <code>easewebhook/mcp</code> folder. The server is then available in every Claude Code session.</>}
              {client === "Claude Desktop" && <>Add this to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (Settings → Developer → Edit config), fix the path, then restart Claude Desktop.</>}
              {client === "Cursor" && <>Add this to <code>~/.cursor/mcp.json</code> (Settings → MCP → Add new server) and fix the path.</>}
            </p>
            <Snippet
              text={config(reveal ? token : masked)}
              onCopy={() => copy(config(token), "Config with your token")}
              extra={
                <button className="btn sm ghost" onClick={() => setReveal((r) => !r)} title={reveal ? "Hide token" : "Show token"}>
                  {reveal ? <EyeOff /> : <Eye />} {reveal ? "Hide token" : "Show token"}
                </button>
              }
            />
            <div className="ai-warning">
              <ShieldAlert />
              <div>
                This includes your personal login token. Anyone who has it can act as you, so don't commit it or share it.
                {expires && <> It expires on <strong>{fmtDate(expires.toISOString())}</strong>. After that, come back here and copy a new one.</>}
              </div>
            </div>
          </section>

          <section className="settings-card">
            <h2><span className="ai-step">3</span>Ask away</h2>
            <p className="muted">
              Open a new chat and ask about your webhooks. The agent picks the right tools itself. Each tool is marked by risk,
              so your AI app can ask you before anything that changes or deletes data.
            </p>
            <div className="ai-legend">
              <Badge tone="neutral">read-only</Badge> looks only
              <Badge tone="warn">write</Badge> creates, changes or re-sends
              <Badge tone="danger">destructive</Badge> deletes or cancels
            </div>
            <div className="ai-tools">
              {TOOLS.map((g) => (
                <div key={g.area} className="ai-tool-group">
                  <div className="section-title">{g.area}</div>
                  {g.tools.map(([name, kind]) => (
                    <div key={name} className="ai-tool">
                      <code>{name}</code>
                      <Badge tone={KIND_TONE[kind]}>{kind === "read" ? "read-only" : kind}</Badge>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              Bulk retry and cancel refuse to run without a filter, so an agent can't re-send every webhook by accident.{" "}
              <a href={`${REPO}/tree/main/mcp`} target="_blank" rel="noreferrer">Source and docs on GitHub</a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Snippet({ text, onCopy, extra }: { text: string; onCopy: (text: string) => void; extra?: React.ReactNode }) {
  return (
    <div className="ai-snippet">
      <pre className="code">{text}</pre>
      <div className="ai-snippet-actions">
        {extra}
        <button className="btn sm" onClick={() => onCopy(text)}><Copy /> Copy</button>
      </div>
    </div>
  );
}
