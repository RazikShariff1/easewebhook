import { Globe, Link2, SquareTerminal } from "lucide-react";

export interface FlowNode {
  label: string;
  kind?: "web" | "local";
  placeholder?: boolean; // not chosen yet: drawn faint
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const isLocal = (url?: string) => !!url && /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url);
export const nodeKind = (url?: string): FlowNode["kind"] => (isLocal(url) ? "local" : "web");

/**
 * Source → hub → destination(s) illustration, used by the Connections empty state and as the live preview
 * on the create-connection page. Up to two destinations are drawn; colours come from CSS variables.
 */
export function FlowDiagram({
  source,
  destinations,
  rules = [],
  annotate = true,
}: {
  source: FlowNode;
  destinations: FlowNode[];
  rules?: string[];
  annotate?: boolean;
}) {
  const dests = destinations.slice(0, 2);
  const two = dests.length > 1;

  return (
    <svg className="flow" viewBox="0 0 560 330" role="img" aria-label={`${source.label} to ${dests.map((d) => d.label).join(" and ")}`}>
      {annotate && (
        <g className="flow-annot">
          <text x="110" y="40" textAnchor="middle">SOURCE</text>
          <line x1="110" y1="52" x2="110" y2="150" />
          <text x="455" y="40" textAnchor="middle">DESTINATION</text>
          <line x1="455" y1="52" x2="455" y2="150" />
          <line x1="215" y1="178" x2="215" y2="250" />
          <text x="215" y="272" textAnchor="middle">INBOUND HTTP REQUEST</text>
          {two ? (
            <>
              <line x1="372" y1="262" x2="372" y2="292" />
              <text x="372" y="314" textAnchor="middle">OUTBOUND EVENT</text>
            </>
          ) : (
            <>
              <line x1="340" y1="178" x2="340" y2="292" />
              <text x="340" y="314" textAnchor="middle">OUTBOUND EVENT</text>
            </>
          )}
        </g>
      )}

      {/* wires */}
      <line className="flow-wire" x1="180" y1="172" x2="244" y2="172" />
      <line className="flow-pulse" x1="196" y1="172" x2="226" y2="172" />
      <line className="flow-wire" x1="300" y1="172" x2="380" y2="172" />
      <line className="flow-pulse" x1="338" y1="172" x2="376" y2="172" />
      {two && <path className="flow-wire" d="M 318 172 Q 334 172 334 190 L 334 236 Q 334 252 352 252 L 380 252" />}

      {/* rules over the hub */}
      {rules.length > 0 && (
        <text className="flow-rules" x="272" y="128" textAnchor="middle">{clip(rules.join(" · "), 34)}</text>
      )}

      {/* source */}
      <g className={source.placeholder ? "flow-node placeholder" : "flow-node"}>
        <rect x="40" y="150" width="140" height="44" rx="22" />
        <text
          className="flow-source"
          x="110"
          y="178"
          textAnchor="middle"
          style={source.label.length > 8 ? { fontSize: source.label.length > 11 ? 13 : 16 } : undefined}
        >
          {clip(source.label, 15)}
        </text>
      </g>

      {/* hub */}
      <g className="flow-hub">
        <rect x="244" y="144" width="56" height="56" rx="9" />
        <Link2 x={258} y={158} width={28} height={28} strokeWidth={2.4} />
      </g>

      {/* destinations */}
      {dests.map((d, i) => {
        const y = i === 0 ? 150 : 230;
        const Icon = d.kind === "local" ? SquareTerminal : Globe;
        return (
          <g key={i} className={d.placeholder ? "flow-node placeholder" : "flow-node"}>
            <rect x="380" y={y} width="150" height="44" rx="22" />
            <Icon x={398} y={y + 14} width={16} height={16} className="flow-icon" />
            <text className="flow-dest" x="422" y={y + 27}>{clip(d.label.toUpperCase(), 11)}</text>
          </g>
        );
      })}
    </svg>
  );
}
