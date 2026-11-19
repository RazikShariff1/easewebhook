import { Link } from "react-router-dom";
import { Ban, Clock, Filter, Plus, RotateCw, Shuffle, type LucideIcon } from "lucide-react";
import type { Connection, Rule, Source, WebhookEvent, WebhookRequest } from "../lib/api";
import { DestinationIcon } from "./DestinationIcon";
import { SourceTypeIcon } from "./SourceIcon";

const RULE_ICON: Record<Rule["type"], LucideIcon> = { filter: Filter, transform: Shuffle, delay: Clock, retry: RotateCw };

type Tone = "ok" | "bad" | "in";
// Same outcome colours as the landing page and the source/destination graphs: green delivered, orange failed, blue in flight.
const outcome = (status: WebhookEvent["status"]): Tone =>
  status === "SUCCESSFUL" ? "ok" : status === "FAILED" || status === "CANCELLED" ? "bad" : "in";

const W = 456;
const ROW = 60;
const MAX_ROWS = 5;
const COL = { heroW: 144, pillX: 172, pillW: 112, destX: 312, destW: 144 };

type Row =
  | { kind: "delivery"; key: string; to: string; conn?: Connection; connName: string; destName: string; destType?: string; tone: Tone; sub: string }
  | { kind: "filtered"; key: string; count: number }
  | { kind: "none"; key: string };

function deliveryRow(e: WebhookEvent, c: Connection | undefined, to: string): Row {
  const sub = [e.status === "SUCCESSFUL" ? "Delivered" : e.status.charAt(0) + e.status.slice(1).toLowerCase(), e.response_status ?? e.error_code, e.attempts > 1 ? `×${e.attempts}` : null]
    .filter((x) => x != null && x !== "")
    .join(" · ");
  return {
    kind: "delivery",
    key: e.id,
    to,
    conn: c,
    connName: c?.name || c?.full_name || e.connection_id,
    destName: c?.destination.name ?? e.destination_id ?? "Destination",
    destType: c?.destination.type,
    tone: outcome(e.status),
    sub,
  };
}

/**
 * The shared graph: a hero node (the source, with the request) on the left, one row per connection in the middle,
 * and the destination with its delivery outcome on the right. Styled and animated like ConnectionGraph.
 */
function Graph({ hero, rows, stop, extra }: { hero: HeroData; rows: Row[]; stop?: { title: string; sub: string }; extra: number }) {
  const n = Math.max(rows.length, 1);
  const H = n * ROW + 20;
  const cy = H / 2;
  const rowY = (i: number) => 10 + i * ROW + ROW / 2;
  const heroY = cy - 40;

  const heroPath = (y: number) => `M ${COL.heroW} ${cy} C ${COL.heroW + 14} ${cy}, ${COL.pillX - 14} ${y}, ${COL.pillX} ${y}`;
  const outPath = (y: number) => `M ${COL.pillX + COL.pillW} ${y} L ${COL.destX} ${y}`;

  return (
    <div className="gf rf-graph">
      <svg className="gf-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${hero.name}: ${hero.sub}`}>
        {rows.map((r, i) => {
          const y = rowY(i);
          const live = r.kind === "delivery";
          return (
            <g key={r.key}>
              <path d={heroPath(y)} className="gf-wire" />
              {live && <path d={outPath(y)} className="gf-wire" />}
              {live && (
                <>
                  <path d={heroPath(y)} className="gf-dflow tail in" pathLength={100} style={{ animationDelay: `${i * 0.5}s` }} />
                  <path d={heroPath(y)} className="gf-dflow head in" pathLength={100} style={{ animationDelay: `${i * 0.5}s` }} />
                  <path d={outPath(y)} className={`gf-dflow tail ${r.tone}`} pathLength={100} style={{ animationDelay: `${1 + i * 0.5}s` }} />
                  <path d={outPath(y)} className={`gf-dflow head ${r.tone}`} pathLength={100} style={{ animationDelay: `${1 + i * 0.5}s` }} />
                </>
              )}
            </g>
          );
        })}

        <foreignObject x={0} y={heroY} width={COL.heroW} height={80}>
          <div className="gf-node hero rf-hero">
            <span className="gf-ico">{hero.icon}</span>
            <span className="gf-txt">
              <small className="gf-eyebrow">SOURCE</small>
              <b className="truncate">{hero.name}</b>
              <small className="truncate mono">{hero.sub}</small>
            </span>
          </div>
        </foreignObject>

        {stop && (
          <foreignObject x={COL.pillX} y={cy - 26} width={W - COL.pillX} height={52}>
            <div className="gf-node rf-stop">
              <span className="gf-ico"><Ban size={16} /></span>
              <span className="gf-txt">
                <b className="truncate">{stop.title}</b>
                <small className="truncate mono">{stop.sub}</small>
              </span>
            </div>
          </foreignObject>
        )}

        {!stop && rows.length === 0 && (
          <foreignObject x={COL.pillX} y={cy - 26} width={W - COL.pillX} height={52}>
            <Link to="/connections/new" className="gf-empty"><Plus size={14} /> No connection routes this source</Link>
          </foreignObject>
        )}

        {rows.map((r, i) => {
          const y = rowY(i);
          if (r.kind === "filtered") {
            return (
              <foreignObject key={r.key} x={COL.pillX} y={y - 18} width={W - COL.pillX} height={36}>
                <div className="gf-pill off"><Filter size={13} /><span className="truncate">{r.count} filtered out by a connection's filter rule</span></div>
              </foreignObject>
            );
          }
          if (r.kind === "none") return null;
          return (
            <g key={r.key}>
              <foreignObject x={COL.pillX} y={y - 18} width={COL.pillW} height={36}>
                <Link to={r.to} className="gf-pill" title={r.conn?.full_name ?? r.connName}>
                  <span className="truncate">{r.connName}</span>
                  {(r.conn?.rules ?? []).map((rule, k) => {
                    const Icon = RULE_ICON[rule.type] ?? Filter;
                    return <Icon key={k} size={12} className="gf-rule" />;
                  })}
                </Link>
              </foreignObject>
              <foreignObject x={COL.destX} y={y - 26} width={COL.destW} height={52}>
                <Link to={r.to} className={`gf-node rf-dest-node ${r.tone}`}>
                  <span className="gf-ico"><DestinationIcon type={r.destType} size={16} /></span>
                  <span className="gf-txt">
                    <b className="truncate">{r.destName}</b>
                    <small className={`truncate rf-out ${r.tone}`}>{r.sub}</small>
                  </span>
                </Link>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      {extra > 0 && <div className="gf-more">+{extra} more connection{extra === 1 ? "" : "s"}</div>}
    </div>
  );
}

type HeroData = { name: string; sub: string; icon: React.ReactNode };

/** What happened to one inbound request: the source, each connection it was routed through, and every delivery's outcome. */
export function RequestFlow({
  request: r,
  source,
  events,
  connections,
}: {
  request: WebhookRequest;
  source?: Source;
  events: WebhookEvent[];
  connections: Connection[];
}) {
  const accepted = r.status === "ACCEPTED";
  const hero: HeroData = {
    name: source?.name ?? "Source deleted",
    sub: `${r.method} ${r.path || "/"}`,
    icon: <SourceTypeIcon type={source?.type} size={22} />,
  };
  const all: Row[] = accepted
    ? events.map((e) => deliveryRow(e, connections.find((x) => x.id === e.connection_id), `/events?request_id=${r.id}`))
    : [];
  const shown = all.slice(0, MAX_ROWS);
  if (accepted && r.ignored_count > 0 && shown.length < MAX_ROWS) shown.push({ kind: "filtered", key: "filtered", count: r.ignored_count });
  return (
    <Graph
      hero={hero}
      rows={shown}
      extra={all.length - all.slice(0, MAX_ROWS).length}
      stop={accepted ? undefined : { title: "Not routed", sub: r.rejection_cause ?? "Rejected" }}
    />
  );
}

/** One event's journey: Source → Connection (rules) → Destination, with the delivery outcome. */
export function EventFlow({ event: e, connection: c }: { event: WebhookEvent; connection?: Connection }) {
  const hero: HeroData = {
    name: c?.source.name ?? e.source_id,
    sub: `${e.method} ${e.path || "/"}`,
    icon: <SourceTypeIcon type={c?.source.type} size={22} />,
  };
  return <Graph hero={hero} rows={[deliveryRow(e, c, `/connections/${e.connection_id}/edit`)]} extra={0} />;
}
