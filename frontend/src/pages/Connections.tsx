import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpDown,
  ListFilter,
  Network,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  PlusCircle,
  Power,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { api, type Connection, type Page, type Stats } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Badge, Dropdown, Empty, ErrorBox, Loading, NoData, Select, useAction, useToast } from "../components/ui";
import { FlowDiagram } from "../components/FlowDiagram";
import { SourceTypeIcon } from "../components/SourceIcon";
import { DestinationIcon } from "../components/DestinationIcon";

type View = "structured" | "table";
type GroupBy = "source" | "destination";
type Order = "newest" | "oldest" | "name";

export function ConnectionsPage() {
  const [view, setView] = useState<View>("structured");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("source");
  const [order, setOrder] = useState<Order>("newest");
  const navigate = useNavigate();
  const toast = useToast();
  const edit = (c: Connection) => navigate(`/connections/${c.id}/edit`);

  // Dropping a destination on a source (or vice versa) opens a prefilled "new connection" form.
  const connect = (sourceId: string, destinationId: string) => {
    const existing = conns.data?.models.find((c) => c.source_id === sourceId && c.destination_id === destinationId);
    if (existing) {
      toast(`Already connected as "${existing.full_name}"`);
      return;
    }
    navigate(`/connections/new?source_id=${sourceId}&destination_id=${destinationId}`);
  };

  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { name: q, status, limit: 250 }), [q, status]);
  const stats = useQuery(() => api.get<Stats>("/stats"), [], 15_000);
  // With no connections yet, "New connection" opens the guided first-connection flow.
  const isFirst = !!conns.data && conns.data.models.length === 0 && !q && !status;
  const createNew = () => navigate(isFirst ? "/connections/first" : "/connections/new");

  const sorted = useMemo(() => {
    const list = [...(conns.data?.models ?? [])];
    if (order === "oldest") list.reverse();
    if (order === "name") list.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return list;
  }, [conns.data, order]);

  return (
    <>
      <PageHeader
        title="Connections"
        titleExtra={
          <div className="segmented" style={{ marginLeft: 6 }}>
            <button className={view === "structured" ? "on" : ""} onClick={() => setView("structured")}>Structured</button>
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
          </div>
        }
      >
        <button className="btn primary" onClick={createNew}>
          <PlusCircle /> New connection
        </button>
      </PageHeader>

      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Filter by ID or name..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select
          icon={<ListFilter />}
          value={status as "" | "active" | "paused" | "disabled"}
          onChange={setStatus}
          options={[
            { value: "", label: "Status" },
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <span className="spacer" />
        {view === "structured" && (
          <Select
            icon={<ArrowUpDown />}
            prefix="Group by"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "source", label: "Source" },
              { value: "destination", label: "Destination" },
            ]}
          />
        )}
        <Select
          icon={<ArrowUpDown />}
          prefix="Order by"
          value={order}
          onChange={setOrder}
          options={[
            { value: "newest", label: "Newest → Oldest" },
            { value: "oldest", label: "Oldest → Newest" },
            { value: "name", label: "Name" },
          ]}
        />
      </div>

      <div className="content">
        <ErrorBox error={conns.error} />
        {conns.loading && !conns.data ? (
          <Loading />
        ) : sorted.length === 0 && (q || status) ? (
          <Empty title="No matching connections" />
        ) : sorted.length === 0 ? (
          <div className="hero-empty">
            <div style={{ alignSelf: "center" }}>
              <h3>Route events to your desired destinations</h3>
              <p>
                Connections let you route events from a source to one or many destinations. You can apply rules to
                connections and pause them, dictating the behavior of events in transit.
              </p>
              <button className="btn primary" onClick={createNew}>
                <Network /> Create first connection
              </button>
            </div>
            <FlowDiagram
              source={{ label: "stripe" }}
              destinations={[{ label: "my-api", kind: "web" }, { label: "local", kind: "local" }]}
            />
          </div>
        ) : view === "structured" ? (
          <Structured conns={sorted} groupBy={groupBy} stats={stats.data} onEdit={edit} onConnect={connect} reload={conns.reload} />
        ) : (
          <ConnTable conns={sorted} stats={stats.data} onEdit={edit} reload={conns.reload} />
        )}
      </div>
    </>
  );
}

function rulePills(c: Connection) {
  return c.rules.map((r) => (
    <span key={r.type} className="rule-pill">
      {r.type === "retry" ? `retry ×${r.count}` : r.type}
    </span>
  ));
}

function ConnStatus({ c }: { c: Connection }) {
  if (c.disabled_at) return <Badge tone="neutral">Disabled</Badge>;
  if (c.paused_at) return <Badge tone="warn">Paused</Badge>;
  return null;
}

function Structured({
  conns,
  groupBy,
  stats,
  onEdit,
  onConnect,
  reload,
}: {
  conns: Connection[];
  groupBy: GroupBy;
  stats?: Stats;
  onEdit: (c: Connection) => void;
  onConnect: (sourceId: string, destinationId: string) => void;
  reload: () => void;
}) {
  // id of the inner node (destination when grouped by source, source otherwise) being dragged
  const [dragId, setDragId] = useState<string>();
  const [overGroup, setOverGroup] = useState<string>();
  const navigate = useNavigate();
  const isSrc = groupBy === "source";
  const groups = useMemo(() => {
    const m = new Map<string, Connection[]>();
    for (const c of conns) {
      const k = groupBy === "source" ? c.source_id : c.destination_id;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.values()];
  }, [conns, groupBy]);

  return (
    <>
    <div className="dnd-hint" style={{ paddingTop: 16 }}>
      Drag a {isSrc ? "destination" : "source"} onto a {isSrc ? "source" : "destination"} to connect them.
    </div>
    <div className="conn-graph">
      {groups.map((g) => {
        const head = g[0];
        const headId = isSrc ? head.source_id : head.destination_id;
        const canDrop = !!dragId && !g.some((c) => (isSrc ? c.destination_id : c.source_id) === dragId);
        return (
          <div className="conn-group" key={headId}>
            <div className="conn-source">
              <button
                className={`conn-node ${canDrop && overGroup === headId ? "drop-target" : ""}`}
                title={isSrc ? head.source.url : head.destination.url}
                onDragOver={(e) => {
                  if (!canDrop) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "link";
                  setOverGroup(headId);
                }}
                onDragLeave={() => setOverGroup((o) => (o === headId ? undefined : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setDragId(undefined);
                  setOverGroup(undefined);
                  if (id) (isSrc ? onConnect(headId, id) : onConnect(id, headId));
                }}
              >
                {isSrc ? <SourceTypeIcon type={head.source.type} /> : <DestinationIcon type={head.destination.type} />}
                {isSrc ? head.source.name : head.destination.name}
                <span className="meta">
                  {(isSrc ? head.source.disabled_at : head.destination.disabled_at) && <Badge tone="neutral">Disabled</Badge>}
                </span>
              </button>
            </div>
            <div className="conn-dests">
              {g.length > 1 && <div className="conn-trunk" style={{ top: 23, height: (g.length - 1) * 66 }} />}
              <button
                className="conn-add"
                title={isSrc ? `Add a destination to ${head.source.name}` : `Add a source for ${head.destination.name}`}
                aria-label={isSrc ? `Add a destination to ${head.source.name}` : `Add a source for ${head.destination.name}`}
                onClick={() => navigate(isSrc ? `/connections/new?source_id=${headId}` : `/connections/new?destination_id=${headId}`)}
              >
                <Plus size={15} />
              </button>
              {g.map((c) => {
                const count = stats?.attempts_24h[c.destination_id];
                return (
                  <div className="conn-row" key={c.id}>
                    <div className="conn-line">
                      <div className="rules">{rulePills(c)}</div>
                    </div>
                    <button
                      className="conn-node"
                      onClick={() => onEdit(c)}
                      title={`${c.full_name} — drag onto another ${isSrc ? "source" : "destination"} to connect`}
                      draggable
                      onDragStart={(e) => {
                        const id = isSrc ? c.destination_id : c.source_id;
                        e.dataTransfer.effectAllowed = "link";
                        e.dataTransfer.setData("text/plain", id);
                        setDragId(id);
                      }}
                      onDragEnd={() => (setDragId(undefined), setOverGroup(undefined))}
                    >
                      {isSrc ? <DestinationIcon type={c.destination.type} /> : <SourceTypeIcon type={c.source.type} />}
                      {isSrc ? c.destination.name : c.source.name}
                      <span className="meta">
                        <ConnStatus c={c} />
                      </span>
                    </button>
                    <div>{count ? <span className="mono">{count} {count === 1 ? "attempt" : "attempts"}</span> : <NoData />}</div>
                    <ConnActions c={c} onEdit={onEdit} reload={reload} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

function ConnActions({ c, onEdit, reload }: { c: Connection; onEdit: (c: Connection) => void; reload: () => void }) {
  const { run } = useAction();
  const navigate = useNavigate();
  const act = (fn: () => Promise<unknown>, msg: string) => run(fn, msg).then(reload);
  return (
    <Dropdown
      align="right"
      trigger={(_, toggle) => (
        <button className="btn icon ghost" onClick={toggle} aria-label="Connection actions">
          <MoreHorizontal />
        </button>
      )}
    >
      {(close) => (
        <>
          <button className="menu-item" onClick={() => (close(), onEdit(c))}>
            <Pencil size={14} /> Edit rules
          </button>
          <button className="menu-item" onClick={() => (close(), navigate(`/connections/${c.id}/test`))}>
            <Send size={14} /> Test connection
          </button>
          <button className="menu-item" onClick={() => (close(), navigate(`/events?connection_id=${c.id}`))}>
            <ArrowDownToLine size={14} /> View events
          </button>
          {c.paused_at ? (
            <button className="menu-item" onClick={() => (close(), act(() => api.put(`/connections/${c.id}/unpause`), "Connection resumed"))}>
              <Play size={14} /> Resume
            </button>
          ) : (
            <button className="menu-item" onClick={() => (close(), act(() => api.put(`/connections/${c.id}/pause`), "Connection paused"))}>
              <Pause size={14} /> Pause
            </button>
          )}
          <button
            className="menu-item"
            onClick={() => (close(), act(() => api.put(`/connections/${c.id}/${c.disabled_at ? "enable" : "disable"}`), c.disabled_at ? "Enabled" : "Disabled"))}
          >
            <Power size={14} /> {c.disabled_at ? "Enable" : "Disable"}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            style={{ color: "var(--danger)" }}
            onClick={() => {
              close();
              if (confirm(`Delete connection "${c.full_name}"? Its events are deleted too.`))
                act(() => api.del(`/connections/${c.id}`), "Connection deleted");
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </Dropdown>
  );
}

function ConnTable({ conns, stats, onEdit, reload }: { conns: Connection[]; stats?: Stats; onEdit: (c: Connection) => void; reload: () => void }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Connection</th>
          <th>Source</th>
          <th>Destination</th>
          <th>Rules</th>
          <th>Status</th>
          <th>Attempts (24h)</th>
          <th>Created</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {conns.map((c) => (
          <tr key={c.id} className="clickable" onClick={() => onEdit(c)}>
            <td className="mono">{c.name}</td>
            <td><span className="tag"><SourceTypeIcon type={c.source.type} />{c.source.name}</span></td>
            <td><span className="tag"><DestinationIcon type={c.destination.type} />{c.destination.name}</span></td>
            <td><div style={{ display: "flex", gap: 4 }}>{rulePills(c)}</div></td>
            <td>{c.disabled_at || c.paused_at ? <ConnStatus c={c} /> : <Badge tone="success">Active</Badge>}</td>
            <td>{stats?.attempts_24h[c.destination_id] ?? 0}</td>
            <td className="muted nowrap">{fmtDate(c.created_at)}</td>
            <td onClick={(e) => e.stopPropagation()}>
              <ConnActions c={c} onEdit={onEdit} reload={reload} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
