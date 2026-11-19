import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpDown, GitFork, ListFilter, MoreHorizontal, Pencil, PlusCircle, Power, Search, Trash2 } from "lucide-react";
import { api, type Connection, type Destination, type Page, type Stats } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { PageHeader } from "../components/Layout";
import { EntityEmpty } from "../components/EntityEmpty";
import { Badge, Dropdown, ErrorBox, Loading, NoData, Select, useAction } from "../components/ui";
import { DestinationForm } from "../components/forms";
import { DestinationIcon } from "../components/DestinationIcon";
import { Pager, usePager } from "./Sources";

const authLabel: Record<string, string> = {
  NONE: "",
  BEARER_TOKEN: "Bearer",
  BASIC_AUTH: "Basic",
  API_KEY: "API key",
  EASE_SIGNATURE: "Signature",
};

export function DestinationsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "disabled">("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [editing, setEditing] = useState<Destination | "new" | null>(null);
  const [policyFocus, setPolicyFocus] = useState(false);
  const pager = usePager();

  const list = useQuery(() => api.get<Page<Destination>>("/destinations", { name: q, status, next: pager.cursor }), [q, status, pager.cursor]);
  const conns = useQuery(() => api.get<Page<Connection>>("/connections", { limit: 250 }), []);
  const stats = useQuery(() => api.get<Stats>("/stats"), [], 15_000);
  const rows = order === "oldest" ? [...(list.data?.models ?? [])].reverse() : list.data?.models ?? [];

  return (
    <>
      <PageHeader title="Destinations">
        <button className="btn primary" onClick={() => setEditing("new")}><PlusCircle /> New destination</button>
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
          <EntityEmpty focus="destination" title="Deliver events to your endpoint">
            <p>A destination is the HTTP endpoint events are delivered to. Connect it to one or more sources and EaseWebhook retries until it succeeds.</p>
            <button className="btn primary" onClick={() => setEditing("new")}><PlusCircle /> Add a destination</button>
          </EntityEmpty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Attempts (24h)</th>
                <th>Delivery policy</th>
                <th>Connections</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const n = stats.data?.attempts_24h[d.id] ?? 0;
                return (
                  <tr key={d.id}>
                    <td>
                      <span className="tag" style={{ cursor: "pointer" }} onClick={() => navigate(`/destinations/${d.id}`)}>
                        <DestinationIcon type={d.type} />
                        {d.name}
                      </span>
                    </td>
                    <td className="mono truncate" title={d.url}>
                      {d.http_method && <span className="faint">{d.http_method} </span>}
                      {d.url}
                    </td>
                    <td>{d.disabled_at ? <Badge tone="neutral">Disabled</Badge> : <Badge tone="success">Active</Badge>}</td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 24, alignItems: "center" }}>
                        <span style={{ minWidth: 30 }}>{n}</span>
                        {n ? null : <NoData />}
                      </span>
                    </td>
                    <td>
                      {d.rate_limit || d.auth_type !== "NONE" ? (
                        <span className="muted" style={{ display: "flex", gap: 6 }}>
                          {d.rate_limit && <span className="rule-pill">{d.rate_limit}/{d.rate_limit_period}</span>}
                          {authLabel[d.auth_type] && <span className="rule-pill">{authLabel[d.auth_type]}</span>}
                        </span>
                      ) : (
                        <button className="btn ghost sm muted" onClick={() => (setPolicyFocus(true), setEditing(d))}>+ Add</button>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const n = conns.data?.models.filter((c) => c.destination_id === d.id).length ?? 0;
                        return n > 0 ? (
                          n
                        ) : (
                          <Link className="add-link" to={`/connections/new?destination_id=${d.id}`}>Add <PlusCircle size={15} /></Link>
                        );
                      })()}
                    </td>
                    <td><DestActions d={d} onEdit={() => setEditing(d)} reload={list.reload} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Pager label="destinations" count={rows.length} page={pager.page} next={list.data?.next} onNext={() => pager.next(list.data?.next)} onPrev={pager.prev} />
      {editing && (
        <DestinationForm
          destination={editing === "new" ? undefined : editing}
          focus={policyFocus ? "policy" : undefined}
          onClose={() => (setEditing(null), setPolicyFocus(false))}
          onSaved={() => (setEditing(null), setPolicyFocus(false), list.reload())}
        />
      )}
    </>
  );
}

function DestActions({ d, onEdit, reload }: { d: Destination; onEdit: () => void; reload: () => void }) {
  const { run } = useAction();
  const navigate = useNavigate();
  return (
    <Dropdown align="right" trigger={(_, t) => <button className="btn icon ghost" onClick={t} aria-label="Destination actions"><MoreHorizontal /></button>}>
      {(close) => (
        <>
          <button className="menu-item" onClick={() => (close(), onEdit())}><Pencil size={14} /> Edit</button>
          <button className="menu-item" onClick={() => (close(), navigate(`/events?destination_id=${d.id}`))}><GitFork size={14} /> View events</button>
          <button className="menu-item" onClick={() => (close(), run(() => api.put(`/destinations/${d.id}/${d.disabled_at ? "enable" : "disable"}`), d.disabled_at ? "Destination enabled" : "Destination disabled — new events are held").then(reload))}>
            <Power size={14} /> {d.disabled_at ? "Enable" : "Disable"}
          </button>
          <div className="menu-sep" />
          <button className="menu-item" style={{ color: "var(--danger)" }} onClick={() => {
            close();
            if (confirm(`Delete destination "${d.name}"? Its connections and events are deleted too.`))
              run(() => api.del(`/destinations/${d.id}`), "Destination deleted").then(reload);
          }}>
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </Dropdown>
  );
}
