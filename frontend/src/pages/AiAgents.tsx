import { useMemo, useState } from "react";
import { ArrowRight, Copy, Eye, EyeOff, KeyRound, Laptop, Search, Server, ShieldAlert, Terminal } from "lucide-react";
import { siClaude, siCursor, siGithub, type SimpleIcon } from "simple-icons";
import { getToken } from "../lib/auth";
import { useWorkspace } from "../lib/workspace";
import { fmtDate } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { AgentChat } from "../components/AgentChat";
import { Badge, useToast } from "../components/ui";

const REPO = "https://github.com/RazikShariff1/easewebhook";
const PROD_API = "https://easewebhook.onrender.com";

type Kind = "read" | "write" | "destructive";
type Tool = { name: string; kind: Kind; does: string };

const TOOLS: { area: string; tools: Tool[] }[] = [
  {
    area: "Workspace",
    tools: [
      { name: "get_overview", kind: "read", does: "24h counts of requests, events and failures" },
      { name: "list_workspaces", kind: "read", does: "Your workspaces, and which one is in use" },
      { name: "use_workspace", kind: "write", does: "Switch workspace for the session" },
    ],
  },
  {
    area: "Sources",
    tools: [
      { name: "list_sources", kind: "read", does: "Webhook URLs and their settings" },
      { name: "get_source", kind: "read", does: "One source, with its public URL" },
      { name: "list_source_types", kind: "read", does: "Stripe, GitHub, Razorpay and 30 more" },
      { name: "create_source", kind: "write", does: "New public URL for a sender" },
      { name: "update_source", kind: "write", does: "Rename, config, verification" },
      { name: "set_source_enabled", kind: "write", does: "Turn a source on or off" },
      { name: "delete_source", kind: "destructive", does: "Remove a source and its URL" },
    ],
  },
  {
    area: "Destinations",
    tools: [
      { name: "list_destinations", kind: "read", does: "Where events are delivered" },
      { name: "get_destination", kind: "read", does: "URL, auth type, rate limit" },
      { name: "create_destination", kind: "write", does: "New endpoint to deliver to" },
      { name: "update_destination", kind: "write", does: "Change URL, auth or rate limit" },
      { name: "set_destination_enabled", kind: "write", does: "Hold or release deliveries" },
      { name: "delete_destination", kind: "destructive", does: "Remove a destination" },
    ],
  },
  {
    area: "Connections",
    tools: [
      { name: "list_connections", kind: "read", does: "Source → destination routes and rules" },
      { name: "get_connection", kind: "read", does: "One route with its rules" },
      { name: "create_connection", kind: "write", does: "Route a source to a destination" },
      { name: "update_connection", kind: "write", does: "Rename or replace rules" },
      { name: "set_connection_state", kind: "write", does: "Pause, unpause, enable, disable" },
      { name: "delete_connection", kind: "destructive", does: "Remove a route" },
    ],
  },
  {
    area: "Transformations",
    tools: [
      { name: "list_transformations", kind: "read", does: "JavaScript payload rewriters" },
      { name: "get_transformation", kind: "read", does: "One transformation's code" },
      { name: "test_transformation", kind: "read", does: "Dry-run code on a real event" },
      { name: "create_transformation", kind: "write", does: "Save new transformation code" },
      { name: "update_transformation", kind: "write", does: "Change code or env" },
      { name: "delete_transformation", kind: "destructive", does: "Remove a transformation" },
    ],
  },
  {
    area: "Requests",
    tools: [
      { name: "list_requests", kind: "read", does: "Every call received, accepted or rejected" },
      { name: "get_request", kind: "read", does: "Headers, body and resulting events" },
      { name: "retry_request", kind: "write", does: "Re-route a rejected request" },
    ],
  },
  {
    area: "Events",
    tools: [
      { name: "list_events", kind: "read", does: "Deliveries by status, destination, time" },
      { name: "get_event", kind: "read", does: "Payload plus every delivery attempt" },
      { name: "get_attempt", kind: "read", does: "Full request sent and response received" },
      { name: "retry_event", kind: "write", does: "Re-send one event now" },
      { name: "bulk_retry_events", kind: "write", does: "Re-send all events matching a filter" },
      { name: "cancel_event", kind: "destructive", does: "Stop a pending delivery" },
      { name: "bulk_cancel_events", kind: "destructive", does: "Stop all matching pending deliveries" },
    ],
  },
];

const ALL_TOOLS = TOOLS.flatMap((g) => g.tools);
const KIND_TONE: Record<Kind, "neutral" | "warn" | "danger"> = { read: "neutral", write: "warn", destructive: "danger" };
const KIND_LABEL: Record<Kind, string> = { read: "read-only", write: "write", destructive: "destructive" };

const PROMPTS = [
  "Why are my Stripe webhooks failing today?",
  "Show rejected requests from the last hour and why they were rejected.",
  "How many events failed for orders-service since 9am? Retry them after I confirm.",
  "Connect a new GitHub source to https://api.example.com/hooks with 5 exponential retries.",
  "Write a transformation that removes card details from Razorpay payloads, and test it on the last event.",
];

type ClientId = "claude-code" | "claude-desktop" | "cursor";
const CLIENTS: { id: ClientId; name: string; icon: SimpleIcon | "terminal"; where: React.ReactNode }[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    icon: "terminal",
    where: <>Run this inside the <code>easewebhook/mcp</code> folder. The server is then available in every Claude Code session.</>,
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    icon: siClaude,
    where: <>Settings → Developer → Edit config opens <code>claude_desktop_config.json</code>. Paste this, replace the path, and restart Claude Desktop.</>,
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: siCursor,
    where: <>Settings → MCP → Add new server opens <code>~/.cursor/mcp.json</code>. Paste this and replace the path.</>,
  },
];

/** Reads the expiry from the token's payload (it's a JWT); null if it can't be read. */
function tokenExpiry(token: string): Date | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

export function AiAgentsPage() {
  const { current } = useWorkspace();
  const toast = useToast();
  const [client, setClient] = useState<ClientId>("claude-code");
  const [reveal, setReveal] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");

  const token = getToken() ?? "";
  const expires = useMemo(() => tokenExpiry(token), [token]);
  const daysLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000)) : null;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const apiUrl = local ? "http://localhost:8000" : PROD_API;
  const masked = token ? `${token.slice(0, 8)}••••••••••••${token.slice(-4)}` : "<your token>";

  const config = (t: string, forClient: ClientId = client) => {
    const vars: [string, string][] = [
      ["EASEWEBHOOK_TOKEN", t],
      ["EASEWEBHOOK_WORKSPACE_ID", current.id],
      ...(apiUrl !== PROD_API ? ([["EASEWEBHOOK_API_URL", apiUrl]] as [string, string][]) : []),
    ];
    if (forClient === "claude-code") {
      return ["claude mcp add easewebhook \\", ...vars.map(([k, v]) => `  -e ${k}=${v} \\`), '  -- "$PWD/bin/easewebhook-mcp"'].join("\n");
    }
    return JSON.stringify(
      { mcpServers: { easewebhook: { command: "/path/to/easewebhook/mcp/bin/easewebhook-mcp", env: Object.fromEntries(vars) } } },
      null,
      2,
    );
  };

  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));

  const counts = useMemo(() => {
    const c = { read: 0, write: 0, destructive: 0 };
    ALL_TOOLS.forEach((t) => c[t.kind]++);
    return c;
  }, []);

  const needle = q.trim().toLowerCase();
  const groups = TOOLS.map((g) => ({
    ...g,
    tools: g.tools.filter(
      (t) => (kind === "all" || t.kind === kind) && (!needle || t.name.includes(needle) || t.does.toLowerCase().includes(needle) || g.area.toLowerCase().includes(needle)),
    ),
  })).filter((g) => g.tools.length > 0);

  const activeClient = CLIENTS.find((c) => c.id === client)!;

  return (
    <>
      <PageHeader title="AI agents" titleExtra={<Badge tone="neutral">MCP</Badge>}>
        <a className="btn" href={`${REPO}/tree/main/mcp`} target="_blank" rel="noreferrer"><ClientIcon icon={siGithub} /> Source and docs</a>
      </PageHeader>
      <div className="content">
        <div className="aa">
          {/* Hero */}
          <section className="aa-hero">
            <div className="aa-hero-copy">
              <div className="aa-eyebrow">MODEL CONTEXT PROTOCOL</div>
              <h2>Ask AI about your webhooks</h2>
              <p>
                Connect Claude, Cursor or any MCP-compatible agent to <strong>{current.name}</strong>. It can find failed
                deliveries and explain why they failed, set up sources and connections, write transformations, and retry
                events after you approve.
              </p>
              <div className="aa-stats">
                <div><strong>{ALL_TOOLS.length}</strong><span>tools</span></div>
                <div><strong>{counts.read}</strong><span>read-only</span></div>
                <div><strong>{counts.write}</strong><span>write</span></div>
                <div><strong>{counts.destructive}</strong><span>destructive</span></div>
              </div>
              <div className="aa-cta">
                <button className="btn primary" onClick={() => document.getElementById("aa-setup")?.scrollIntoView({ behavior: "smooth" })}>
                  Set it up in 2 minutes <ArrowRight />
                </button>
                <button className="btn" onClick={() => copy(config(token, "claude-code"), "Claude Code command with your token")}>
                  <Copy /> Copy Claude Code command
                </button>
              </div>
              <div className="aa-works">
                <span className="faint">Works with</span>
                {CLIENTS.map((c) => (
                  <span key={c.id} className="aa-chip"><ClientIcon icon={c.icon} />{c.name}</span>
                ))}
                <span className="aa-chip faint">any MCP client</span>
              </div>
            </div>
            <AgentChat />
          </section>

          {/* How it connects */}
          <section className="aa-flow" aria-label="Your AI app starts the EaseWebhook MCP server on your computer, which calls the EaseWebhook API">
            <FlowNode icon={<Laptop />} title="Your AI app" sub="Claude, Cursor…" />
            <FlowLink label="stdio" />
            <FlowNode icon={<Terminal />} title="easewebhook-mcp" sub="runs on your computer" accent />
            <FlowLink label="HTTPS + your token" />
            <FlowNode icon={<Server />} title="EaseWebhook API" sub={current.name} />
          </section>

          {/* Setup */}
          <section className="aa-card" id="aa-setup">
            <div className="aa-card-head">
              <h3>Set it up</h3>
              <span className="faint">About 2 minutes · needs Go 1.27+</span>
            </div>
            <ol className="aa-steps">
              <li>
                <div className="aa-step-title">Build the server</div>
                <p className="muted">Your AI app starts it when a session begins and stops it when the session ends. Nothing runs in the background.</p>
                <Snippet text={`git clone ${REPO}\ncd easewebhook/mcp\ngo build -o bin/easewebhook-mcp .`} onCopy={(t) => copy(t, "Commands")} />
              </li>

              <li>
                <div className="aa-step-title">Connect your AI app</div>
                <div className="aa-clients" role="tablist">
                  {CLIENTS.map((c) => (
                    <button key={c.id} role="tab" aria-selected={client === c.id} className={client === c.id ? "on" : ""} onClick={() => setClient(c.id)}>
                      <ClientIcon icon={c.icon} />
                      {c.name}
                    </button>
                  ))}
                </div>
                <p className="muted">{activeClient.where}</p>
                <Snippet
                  text={config(reveal ? token : masked)}
                  onCopy={() => copy(config(token), "Config with your token")}
                  copyLabel="Copy with token"
                />
                <div className="aa-token">
                  <KeyRound />
                  <code>{reveal ? token : masked}</code>
                  <button className="btn sm ghost" onClick={() => setReveal((r) => !r)}>
                    {reveal ? <EyeOff /> : <Eye />} {reveal ? "Hide" : "Show"}
                  </button>
                  <button className="btn sm ghost" onClick={() => copy(token, "Token")}><Copy /> Token</button>
                  {daysLeft !== null && (
                    <Badge tone={daysLeft <= 1 ? "danger" : daysLeft <= 2 ? "warn" : "neutral"}>
                      {daysLeft === 0 ? "expired" : `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                    </Badge>
                  )}
                </div>
                <div className="aa-warning">
                  <ShieldAlert />
                  <span>
                    This is your personal login token: anyone who has it can act as you. Don't commit or share it.
                    {expires && <> It stops working on {fmtDate(expires.toISOString())}; come back here for a fresh config.</>}
                  </span>
                </div>
              </li>

              <li>
                <div className="aa-step-title">Ask away</div>
                <p className="muted">Start a new chat. The agent chooses the tools itself. Click a prompt to copy it.</p>
                <div className="aa-prompts">
                  {PROMPTS.map((p) => (
                    <button key={p} className="aa-prompt" onClick={() => copy(p, "Prompt")}>
                      <span>{p}</span>
                      <ArrowRight />
                    </button>
                  ))}
                </div>
              </li>
            </ol>
          </section>

          {/* Tools */}
          <section className="aa-card">
            <div className="aa-card-head">
              <h3>Tools</h3>
              <span className="faint">Each tool is marked by risk, so your AI app can ask you before anything that changes or deletes data.</span>
            </div>
            <div className="aa-tool-bar">
              <label className="aa-search">
                <Search />
                <input placeholder="Search tools…" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <div className="btn-group">
                {(["all", "read", "write", "destructive"] as const).map((k) => (
                  <button key={k} className={`btn sm ${kind === k ? "aa-on" : ""}`} onClick={() => setKind(k)}>
                    {k === "all" ? `All ${ALL_TOOLS.length}` : `${KIND_LABEL[k]} ${counts[k]}`}
                  </button>
                ))}
              </div>
            </div>
            {groups.length === 0 ? (
              <div className="muted aa-none">No tools match “{q}”.</div>
            ) : (
              <div className="aa-tools">
                {groups.map((g) => (
                  <div key={g.area} className="aa-tool-group">
                    <div className="section-title">{g.area}</div>
                    {g.tools.map((t) => (
                      <div key={t.name} className="aa-tool">
                        <div>
                          <code>{t.name}</code>
                          <div className="faint">{t.does}</div>
                        </div>
                        <Badge tone={KIND_TONE[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="faint aa-foot">
              Safety built in: bulk retry and cancel refuse to run without a filter, results are capped at 60 KB, and
              workspace members and source key rotation aren't exposed to agents.
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ClientIcon({ icon }: { icon: SimpleIcon | "terminal" }) {
  if (icon === "terminal") return <Terminal className="aa-ci" />;
  return (
    <svg className="aa-ci" viewBox="0 0 24 24" aria-hidden="true">
      {/* near-black brand colours (GitHub, Cursor) would vanish on the dark theme: use the text colour */}
      <path d={icon.path} fill={parseInt(icon.hex, 16) < 0x404040 ? "currentColor" : `#${icon.hex}`} />
    </svg>
  );
}

function FlowNode({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean }) {
  return (
    <div className={`aa-node ${accent ? "accent" : ""}`}>
      <span className="aa-node-icon">{icon}</span>
      <div>
        <div className="aa-node-title">{title}</div>
        <div className="faint aa-node-sub">{sub}</div>
      </div>
    </div>
  );
}

function FlowLink({ label }: { label: string }) {
  return (
    <div className="aa-link">
      <span>{label}</span>
      <i />
    </div>
  );
}

function Snippet({ text, onCopy, copyLabel = "Copy" }: { text: string; onCopy: (text: string) => void; copyLabel?: string }) {
  return (
    <div className="aa-snippet">
      <pre className="code">{text}</pre>
      <button className="btn sm" onClick={() => onCopy(text)}><Copy /> {copyLabel}</button>
    </div>
  );
}
