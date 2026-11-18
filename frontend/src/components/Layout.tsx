import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  ArrowDownToLine,
  BarChart3,
  Crosshair,
  FileCode2,
  GitFork,
  LogOut,
  Settings,
  Network,
  Waypoints,
} from "lucide-react";
import { api, type Stats } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useWorkspace } from "../lib/workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { LogoMark } from "./Logo";

const INCLUDED = 10_000;

export function Layout() {
  const { current } = useWorkspace();
  const stats = useQuery(() => api.get<Stats>("/stats"), [current.id], 15_000);
  const total = Object.values(stats.data?.events_by_status ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const failed = stats.data?.events_by_status.FAILED ?? 0;
  const held = stats.data?.events_by_status.HOLD ?? 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand" title="EaseWebhook home">
          <LogoMark size={22} />
          EaseWebhook
        </Link>
        <WorkspaceSwitcher />

        <div className="nav-section">Configure</div>
        <NavItem to="/connections" icon={<Network />} label="Connections" />
        <NavItem to="/sources" icon={<ArrowDownToLine />} label="Sources" />
        <NavItem to="/destinations" icon={<Crosshair />} label="Destinations" />
        <NavItem to="/transformations" icon={<FileCode2 />} label="Transformations" />

        <div className="nav-section">Monitor</div>
        <NavItem to="/metrics" icon={<BarChart3 />} label="Metrics" />

        <div className="nav-section">Inspect</div>
        <NavItem to="/requests" icon={<Waypoints />} label="Requests" end />
        <div className="nav-sub">
          <NavItem to="/requests/accepted" label="Accepted" />
          <NavItem to="/requests/rejected" label="Rejected" />
        </div>
        <NavItem to="/events" icon={<GitFork />} label="Events" end />
        <div className="nav-sub">
          <NavItem to="/events/failed" label="Failed" count={failed} />
          <NavItem to="/events/paused" label="Paused" count={held} />
        </div>

        <div className="sidebar-footer">
          <div className="usage-card">
            <div>Events (24h)</div>
            <div className="usage-bar">
              <div style={{ width: `${Math.min(100, (total / INCLUDED) * 100)}%` }} />
            </div>
            <strong>{total.toLocaleString()}</strong>/{INCLUDED.toLocaleString()} used
          </div>
          <NavItem to="/metrics" icon={<Activity />} label="Project Throughput" />
          <NavItem to="/settings" icon={<Settings />} label="Settings" />
          <UserChip />
        </div>
      </aside>
      <main className="main">
        <Outlet key={current.id} />
      </main>
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  count,
  end,
}: {
  to: string;
  icon?: React.ReactNode;
  label: string;
  count?: number;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
      {icon}
      {label}
      {!!count && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

export function PageHeader({
  title,
  count,
  titleExtra,
  children,
}: {
  title: string;
  count?: number;
  titleExtra?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {count !== undefined && <span className="count-pill">{count}</span>}
      {titleExtra}
      <span className="spacer" />
      {children}
    </header>
  );
}

function UserChip() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = (user.name || user.email).slice(0, 1).toUpperCase();
  return (
    <div className="user-chip">
      <span className="avatar">
        {user.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials}
      </span>
      <span className="who">
        <div>{user.name}</div>
        <div className="faint" style={{ fontSize: 12 }}>{user.email}</div>
      </span>
      <button className="btn icon ghost" onClick={logout} title="Log out" aria-label="Log out">
        <LogOut />
      </button>
    </div>
  );
}
