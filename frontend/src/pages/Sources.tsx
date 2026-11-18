import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, ChevronLeft, ChevronRight, ListFilter, MoreHorizontal, Pencil, PlusCircle, Power, Search, Trash2, Waypoints } from "lucide-react";
import { api, type Connection, type Page, type Source, type Stats } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { PageHeader } from "../components/Layout";
import { Badge, CopyText, Dropdown, Empty, ErrorBox, Loading, NoData, Select, useAction } from "../components/ui";
import { SourceForm } from "../components/forms";
import { SourceTypeIcon } from "../components/SourceIcon";

export function usePager() {
  const [stack, setStack] = useState<string[]>([""]);
  return {
    cursor: stack[stack.length - 1],
    page: stack.length,
    next: (c?: string) => c && setStack((s) => [...s, c]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([""]),
  };
}

export function Pager({ label, count, page, next, onNext, onPrev }: { label: string; count: number; page: number; next?: string; onNext: () => void; onPrev: () => void }) {
  return (
    <div className="footer-bar">
      <span>
        Page {page} · Viewing <strong>{count}</strong> {label}
      </span>
      <div className="btn-group">
        <button className="btn icon" disabled={page <= 1} onClick={onPrev} aria-label="Previous page"><ChevronLeft /></button>
        <button className="btn icon" disabled={!next} onClick={onNext} aria-label="Next page"><ChevronRight /></button>
      </div>
    </div>
  );
}

export function SourcesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "disabled">("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [editing, setEditing] = useState<Source | "new" | null>(null);
  const pager = usePager();

  const list = useQuery(() => api.get<Page<Source>>("/sources", { name: q, status, next: pager.cursor }), [q, status, pager.cursor]);
  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { limit: 250 }), []);
  const stats = useQuery(() => api.get<Stats>("/stats"), [], 15_000);

  const connCount = (id: string) => conns.data?.models.filter((c) => c.source_id === id).length ?? 0;
  const rows = order === "oldest" ? [...(list.data?.models ?? [])].reverse() : list.data?.models ?? [];

  return (
    <>
      <PageHeader title="Sources">
        <button className="btn primary" onClick={() => setEditing("new")}>
          <PlusCircle /> New source
        </button>
      </PageHeader>
      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Filter by ID or name..." value={q} onChange={(e) => (setQ(e.target.value), pager.reset())} />
        </div>
        <Select icon={<ListFilter />} value={status} onChange={(v) => (setStatus(v), pager.reset())}
          options={[{ value: "", label: "Status" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
        <span className="spacer" />
        <Select icon={<ArrowUpDown />} prefix="Order by" value={order} onChange={setOrder}
          options={[{ value: "newest", label: "Newest → Oldest" }, { value: "oldest", label: "Oldest → Newest" }]} />
      </div>
      <div className="content">
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No sources">
            <p>A source is a unique URL you give to a webhook provider. Every request it receives is logged and routed to its connections.</p>
            <button className="btn primary" onClick={() => setEditing("new")}><PlusCircle /> New source</button>
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Source URL</th>
                <th>Status</th>
                <th>Requests (24h)</th>
                <th>Connections</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const n = stats.data?.requests_24h[s.id] ?? 0;
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="tag" style={{ cursor: "pointer" }} onClick={() => navigate(`/sources/${s.id}`)}>
                        <SourceTypeIcon type={s.type} />
                        {s.name}
                      </span>
                      {s.verification && <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>{s.verification.type}</span>}
                    </td>
                    <td className="mono"><CopyText text={s.url} /></td>
                    <td>{s.disabled_at ? <Badge tone="neutral">Disabled</Badge> : <Badge tone="success">Active</Badge>}</td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 24, alignItems: "center" }}>
                        <span style={{ minWidth: 30 }}>{n}</span>
                        {n ? null : <NoData />}
                      </span>
                    </td>
                    <td>{connCount(s.id)}</td>
                    <td>
                      <SourceActions s={s} onEdit={() => setEditing(s)} reload={list.reload} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Pager label="sources" count={rows.length} page={pager.page} next={list.data?.next} onNext={() => pager.next(list.data?.next)} onPrev={pager.prev} />
      {editing && (
        <SourceForm
          source={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), list.reload())}
        />
      )}
    </>
  );
}

function SourceActions({ s, onEdit, reload }: { s: Source; onEdit: () => void; reload: () => void }) {
  const { run } = useAction();
  const navigate = useNavigate();
  return (
    <Dropdown align="right" trigger={(_, t) => <button className="btn icon ghost" onClick={t} aria-label="Source actions"><MoreHorizontal /></button>}>
      {(close) => (
        <>
          <button className="menu-item" onClick={() => (close(), onEdit())}><Pencil size={14} /> Edit</button>
          <button className="menu-item" onClick={() => (close(), navigate(`/requests?source_id=${s.id}`))}><Waypoints size={14} /> View requests</button>
          <button className="menu-item" onClick={() => (close(), run(() => api.put(`/sources/${s.id}/${s.disabled_at ? "enable" : "disable"}`), s.disabled_at ? "Source enabled" : "Source disabled").then(reload))}>
            <Power size={14} /> {s.disabled_at ? "Enable" : "Disable"}
          </button>
          <div className="menu-sep" />
          <button className="menu-item" style={{ color: "var(--danger)" }} onClick={() => {
            close();
            if (confirm(`Delete source "${s.name}"? Its connections, requests and events are deleted too.`))
              run(() => api.del(`/sources/${s.id}`), "Source deleted").then(reload);
          }}>
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </Dropdown>
  );
}
