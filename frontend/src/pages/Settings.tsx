import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Mail, Trash2, UserPlus, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useQuery } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { useWorkspace } from "../lib/workspace";
import { PageHeader } from "../components/Layout";
import { Badge, ErrorBox, Field, Loading, useAction, useToast } from "../components/ui";

interface Member {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: "owner" | "member";
  joined_at: string;
}

interface Invite {
  email: string;
  role: "owner" | "member";
  created_at: string;
}

export function SettingsPage() {
  const { current, reload, switchTo } = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const toast = useToast();
  const isOwner = current.role === "owner";

  const members = useQuery(() => api.get<{ members: Member[]; invites: Invite[] }>(`/workspaces/${current.id}/members`), [current.id]);
  const [name, setName] = useState(current.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  useEffect(() => setName(current.name), [current.name]);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.put(`/workspaces/${current.id}`, { name }), "Workspace renamed")) reload();
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post<{ status: "added" | "invited" }>(`/workspaces/${current.id}/members`, { email, role }));
    if (r) {
      toast(r.status === "added" ? `${email} added to the workspace` : `Invite saved — ${email} joins when they sign up`);
      setEmail("");
      members.reload();
      reload();
    }
  };

  const goElsewhere = async () => {
    const list = await reload();
    const next = list.find((w) => w.id !== current.id) ?? list[0];
    if (next) switchTo(next.id);
    navigate("/connections");
  };

  const leave = async () => {
    const last = (members.data?.members.length ?? 0) <= 1;
    const msg = last
      ? `You're the only member, so leaving deletes "${current.name}" and everything in it. Continue?`
      : `Leave "${current.name}"? You'll lose access to its sources, connections and events.`;
    if (!confirm(msg)) return;
    const r = await run(() => api.del(`/workspaces/${current.id}/members/${user!.id}`).then(() => true), "You left the workspace");
    if (r) goElsewhere();
  };

  const remove = async () => {
    const typed = prompt(`This permanently deletes "${current.name}" with all its sources, destinations, connections, requests and events.\n\nType the workspace name to confirm:`);
    if (typed !== current.name) return;
    const r = await run(() => api.del(`/workspaces/${current.id}`).then(() => true), "Workspace deleted");
    if (r) goElsewhere();
  };

  return (
    <>
      <PageHeader title="Workspace settings" />
      <div className="content">
        <div className="settings">
          <section className="settings-card">
            <h2>General</h2>
            <form onSubmit={rename} className="settings-row">
              <Field label="Workspace name" hint={!isOwner ? "Only owners can rename the workspace." : undefined}>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} />
              </Field>
              {isOwner && (
                <button className="btn" type="submit" disabled={busy || !name.trim() || name === current.name}>Save</button>
              )}
            </form>
            <div className="faint" style={{ fontSize: 12 }}>
              ID <code>{current.id}</code> · your role: {current.role}
            </div>
          </section>

          <section className="settings-card">
            <h2>Members</h2>
            {isOwner && (
              <form onSubmit={invite} className="settings-row">
                <Field label="Invite by email" hint="Existing users are added right away; others join when they sign up with this email.">
                  <input className="input" type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <select className="select" value={role} onChange={(e) => setRole(e.target.value as "member" | "owner")} aria-label="Role">
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
                <button className="btn primary" type="submit" disabled={busy || !email}><UserPlus /> Invite</button>
              </form>
            )}
            <ErrorBox error={members.error} />
            {!members.data ? (
              <Loading />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {members.data.members.map((m) => (
                    <tr key={m.user_id}>
                      <td>
                        <div className="user-chip" style={{ padding: 0 }}>
                          <span className="avatar">
                            {m.avatar_url ? <img src={m.avatar_url} alt="" referrerPolicy="no-referrer" /> : (m.name || m.email)[0].toUpperCase()}
                          </span>
                          <span className="who">
                            <div>{m.name}{m.user_id === user?.id && <span className="faint"> (you)</span>}</div>
                            <div className="faint" style={{ fontSize: 12 }}>{m.email}</div>
                          </span>
                        </div>
                      </td>
                      <td>
                        {isOwner ? (
                          <select
                            className="select"
                            value={m.role}
                            onChange={(e) =>
                              run(() => api.put(`/workspaces/${current.id}/members/${m.user_id}`, { role: e.target.value }), "Role updated").then(() => {
                                members.reload();
                                reload();
                              })
                            }
                          >
                            <option value="member">Member</option>
                            <option value="owner">Owner</option>
                          </select>
                        ) : (
                          <Badge tone={m.role === "owner" ? "info" : "neutral"}>{m.role}</Badge>
                        )}
                      </td>
                      <td className="muted nowrap">{fmtDate(m.joined_at)}</td>
                      <td>
                        {isOwner && m.user_id !== user?.id && (
                          <button
                            className="btn icon ghost"
                            title="Remove from workspace"
                            aria-label={`Remove ${m.email}`}
                            onClick={() => {
                              if (confirm(`Remove ${m.email} from "${current.name}"?`))
                                run(() => api.del(`/workspaces/${current.id}/members/${m.user_id}`), "Member removed").then(members.reload);
                            }}
                          >
                            <X />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {members.data.invites.map((i) => (
                    <tr key={i.email}>
                      <td>
                        <div className="user-chip" style={{ padding: 0 }}>
                          <span className="avatar"><Mail size={12} /></span>
                          <span className="who">
                            <div>{i.email}</div>
                            <div className="faint" style={{ fontSize: 12 }}>Invited · joins on sign-up</div>
                          </span>
                        </div>
                      </td>
                      <td><Badge tone="warn">{i.role} · pending</Badge></td>
                      <td className="muted nowrap">{fmtDate(i.created_at)}</td>
                      <td>
                        {isOwner && (
                          <button
                            className="btn icon ghost"
                            title="Cancel invite"
                            aria-label={`Cancel invite for ${i.email}`}
                            onClick={() => run(() => api.del(`/workspaces/${current.id}/invites/${encodeURIComponent(i.email)}`), "Invite cancelled").then(members.reload)}
                          >
                            <X />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="settings-card danger-zone">
            <h2>Danger zone</h2>
            <div className="settings-row" style={{ alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <strong>Leave workspace</strong>
                <div className="muted" style={{ fontSize: 13 }}>You'll lose access unless someone invites you again.</div>
              </div>
              <button className="btn danger" onClick={leave} disabled={busy}><LogOut /> Leave</button>
            </div>
            {isOwner && (
              <div className="settings-row" style={{ alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <strong>Delete workspace</strong>
                  <div className="muted" style={{ fontSize: 13 }}>Permanently deletes all sources, destinations, connections, requests and events in it.</div>
                </div>
                <button className="btn danger" onClick={remove} disabled={busy}><Trash2 /> Delete</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
