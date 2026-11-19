import { Link } from "react-router-dom";
import { Clock, Filter, PauseCircle, Plus, RotateCw, Shuffle, type LucideIcon } from "lucide-react";
import type { Connection, Destination, Rule, Source } from "../lib/api";
import { useSourceTypes } from "../lib/sourceTypes";
import { DEST_TYPES, DestinationIcon } from "./DestinationIcon";
import { SourceTypeIcon } from "./SourceIcon";

const RULE_ICON: Record<Rule["type"], LucideIcon> = { filter: Filter, transform: Shuffle, delay: Clock, retry: RotateCw };

const W = 760;
const ROW = 68;
const MAX_ROWS = 5;
const COL = { left: 0, nodeW: 200, pillX: 275, pillW: 210, right: 560 };

/**
 * Source → connection → destination graph, in the style of the landing page's diagrams.
 * `focus` picks the hero: on a source page the source is the big, highlighted node and fans out to its
 * destinations; on a destination page the destination is the hero and its sources fan in.
 */
export function ConnectionGraph({ focus, entity, connections }: { focus: "source" | "destination"; entity: Source | Destination; connections: Connection[] }) {
  const sourceTypes = useSourceTypes();
  const shown = connections.slice(0, MAX_ROWS);
  const extra = connections.length - shown.length;
  const rows = Math.max(shown.length, 1);
  const H = rows * ROW + 24;
  const cy = H / 2;
  const rowY = (i: number) => 12 + i * ROW + ROW / 2;

  const sourceNode = (s: Source, hero: boolean) => ({
    key: s.id,
    to: `/sources/${s.id}`,
    name: s.name,
    sub: sourceTypes.find((t) => t.id === s.type)?.name ?? s.type,
    icon: <SourceTypeIcon type={s.type} size={hero ? 22 : 16} />,
    off: !!s.disabled_at,
    hero,
    eyebrow: "SOURCE",
  });
  const destNode = (d: Destination, hero: boolean) => ({
    key: d.id,
    to: `/destinations/${d.id}`,
    name: d.name,
    sub: DEST_TYPES.find((t) => t.value === d.type)?.label ?? d.type,
    icon: <DestinationIcon type={d.type} size={hero ? 22 : 16} />,
    off: !!d.disabled_at,
    hero,
    eyebrow: "DESTINATION",
  });

  const hero = focus === "source" ? sourceNode(entity as Source, true) : destNode(entity as Destination, true);
  const side = (c: Connection) => (focus === "source" ? destNode(c.destination, false) : sourceNode(c.source, false));

  // geometry: hero on one side (centred), one row per connection on the other, connection pills in the middle
  const heroX = focus === "source" ? COL.left : COL.right;
  const sideX = focus === "source" ? COL.right : COL.left;

  const edges = shown.map((_, i) => {
    const y = rowY(i);
    return focus === "source"
      ? { hero: `M ${COL.left + COL.nodeW} ${cy} C 240 ${cy}, 235 ${y}, ${COL.pillX} ${y}`, side: `M ${COL.pillX + COL.pillW} ${y} L ${COL.right} ${y}` }
      : { hero: `M ${COL.pillX + COL.pillW} ${y} C 525 ${y}, 520 ${cy}, ${COL.right} ${cy}`, side: `M ${COL.left + COL.nodeW} ${y} L ${COL.pillX} ${y}` };
  });
  // inbound first, then the outcome side, like the landing page's loop
  const heroFirst = focus === "source";

  return (
    <div className="gf">
      <svg className="gf-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${hero.name}: ${connections.length} connection${connections.length === 1 ? "" : "s"}`}>
        {edges.map((e, i) => (
          <g key={i}>
            <path d={e.hero} className="gf-wire" />
            <path d={e.side} className="gf-wire" />
            <path d={heroFirst ? e.hero : e.side} className="gf-dflow tail in" pathLength={100} style={{ animationDelay: `${i * 0.5}s` }} />
            <path d={heroFirst ? e.hero : e.side} className="gf-dflow head in" pathLength={100} style={{ animationDelay: `${i * 0.5}s` }} />
            <path d={heroFirst ? e.side : e.hero} className="gf-dflow tail ok" pathLength={100} style={{ animationDelay: `${1 + i * 0.5}s` }} />
            <path d={heroFirst ? e.side : e.hero} className="gf-dflow head ok" pathLength={100} style={{ animationDelay: `${1 + i * 0.5}s` }} />
          </g>
        ))}

        <Node n={hero} x={heroX} y={cy - 44} h={88} />

        {shown.length === 0 && (
          <foreignObject x={sideX} y={cy - 26} width={COL.nodeW} height={52}>
            <Link to="/connections/new" className="gf-empty"><Plus size={14} /> Create a connection</Link>
          </foreignObject>
        )}

        {shown.map((c, i) => {
          const y = rowY(i);
          const paused = !!c.paused_at || !!c.disabled_at;
          return (
            <g key={c.id}>
              <Node n={side(c)} x={sideX} y={y - 26} h={52} />
              <foreignObject x={COL.pillX} y={y - 18} width={COL.pillW} height={36}>
                <Link to={`/connections/${c.id}/edit`} className={`gf-pill ${paused ? "off" : ""}`} title={c.full_name}>
                  <span className="truncate">{c.name || c.full_name}</span>
                  {paused && <PauseCircle size={13} />}
                  {c.rules.map((r, k) => {
                    const Icon = RULE_ICON[r.type] ?? Filter;
                    return <Icon key={k} size={12} className="gf-rule" />;
                  })}
                </Link>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      {extra > 0 && <div className="gf-more">+{extra} more connection{extra === 1 ? "" : "s"} — see the Connections tab</div>}
    </div>
  );
}

type NodeData = { key: string; to: string; name: string; sub: string; icon: React.ReactNode; off: boolean; hero: boolean; eyebrow: string };

function Node({ n, x, y, h }: { n: NodeData; x: number; y: number; h: number }) {
  return (
    <foreignObject x={x} y={y} width={COL.nodeW} height={h}>
      <Link to={n.to} className={`gf-node ${n.hero ? "hero" : ""} ${n.off ? "off" : ""}`}>
        <span className="gf-ico">{n.icon}</span>
        <span className="gf-txt">
          {n.hero && <small className="gf-eyebrow">{n.eyebrow}</small>}
          <b className="truncate">{n.name}</b>
          <small className="truncate">{n.off ? "Disabled" : n.sub}</small>
        </span>
      </Link>
    </foreignObject>
  );
}
