import type React from "react";
import { Shuffle } from "lucide-react";

import { BRANDS, CARD, DEST_W, DEST_Y, DESTS, LOGO, VIEW_H, GAP, IN, LOOP, OUT_AT, ARRIVE, PILL_W, ROUTE, destX, inPath, outPath, srcX } from "./flowGeometry";

// Each sender has its own payload and the line the transformation adds to it.
const PAYLOADS: { code: string[]; added: number }[] = [
  { added: 4, code: ["{", '  "type": "charge.succeeded",', '  "amount": 4900,', '  "currency": "usd",', '  "event_type": "purchases"', "}"] },
  { added: 4, code: ["{", '  "id": 8127,', '  "total_price": "129.00",', '  "customer": "ana@acme.io",', '  "priority": "vip"', "}"] },
  { added: 4, code: ["{", '  "ref": "refs/heads/main",', '  "pusher": "ana",', '  "commits": 3,', '  "channel": "#deploys"', "}"] },
  { added: 4, code: ["{", '  "issue": "TypeError in cart",', '  "level": "error",', '  "users": 142,', '  "severity": "high"', "}"] },
  { added: 4, code: ["{", '  "type": "user.created",', '  "email": "sam@acme.io",', '  "plan": "trial",', '  "lead_source": "webflow"', "}"] },
];
const SENDERS = BRANDS.map((b, i) => ({ ...b, ...PAYLOADS[i] }));

/**
 * Empty-state illustration for Transformations. One diagram: several senders feed a "Transform payload" step,
 * which rewrites each event and routes it to one of several destinations. Requests travel as blue comets and
 * the card shows the payload of the request currently inside it (with the line the transformation adds
 * highlighted), so the code always matches the sender.
 */
export function TransformFlow() {
  const lineY = (i: number) => CARD.y + 64 + i * 22;
  // negative delays start the loop mid-cycle, so the first frame already looks like steady state
  const showDelay = (i: number) => i * GAP + IN - LOOP;

  return (
    <svg className="tf" style={{ "--tf-loop": `${LOOP}s` } as React.CSSProperties} viewBox={`0 0 520 ${VIEW_H}`} role="img" aria-label="Stripe, Shopify, GitHub, Sentry and Clerk events pass through a transformation that rewrites the payload, then reach your API, CRM, chat and on-call destinations">
      {/* wires */}
      {SENDERS.map((_, i) => <path key={i} className="tf-wire" d={inPath(i)} />)}
      {DESTS.map((_, j) => <path key={j} className="tf-wire" d={outPath(j)} />)}

      {/* requests: sender i → card → destination ROUTE[i] */}
      {SENDERS.map((_, i) => (
        <g key={i}>
          <Comet d={inPath(i)} delay={i * GAP} />
          <Comet d={outPath(ROUTE[i])} delay={i * GAP + OUT_AT} />
        </g>
      ))}

      {SENDERS.map((s, i) => (
        <g key={s.name} className="tf-pill">
          <rect x={srcX(i)} y="22" width={PILL_W} height="44" rx="22" />
          <g transform={`translate(${srcX(i) + 14} 34) scale(${20 / 24})`}><path d={s.icon.path} fill={s.color} /></g>
          <text x={srcX(i) + 40} y="48.5" className="tf-brand">{s.name}</text>
        </g>
      ))}

      {/* our logo: every request enters here, and the card below is where it is processed */}
      <line className="tf-wire" x1={LOGO.cx} y1={LOGO.y + LOGO.size} x2={LOGO.cx} y2={CARD.y} />
      <g className="tf-logo">
        <rect x={LOGO.cx - LOGO.size / 2} y={LOGO.y} width={LOGO.size} height={LOGO.size} rx="12" />
        <image href="/logo-icon.png" x={LOGO.cx - LOGO.size / 2 + 3} y={LOGO.y + 3} width={LOGO.size - 6} height={LOGO.size - 6} />
      </g>

      <g className="tf-card">
        <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx="10" />
        <line x1={CARD.x} y1={CARD.y + 42} x2={CARD.x + CARD.w} y2={CARD.y + 42} />
        <foreignObject x={CARD.x} y={CARD.y} width={CARD.w} height="42">
          <div className="tf-card-head"><Shuffle size={16} /> TRANSFORM PAYLOAD</div>
        </foreignObject>

        {/* one block per sender, stacked; each is visible only while its own request is in the card */}
        {SENDERS.map((s, i) => {
          const indent = s.code[s.added].length - s.code[s.added].trimStart().length;
          const hlX = 126 + indent * 7.5 - 6; // monospace 12.5px ≈ 7.5px/char; start just left of the opening quote
          const hlW = 378 - hlX;
          const delay = { animationDelay: `${showDelay(i)}s` };
          const id = `tf-hl-clip-${i}`;
          return (
            <g key={s.name} className={i === 0 ? "tf-codeblock first" : "tf-codeblock"} style={delay}>
              <defs>
                <clipPath id={id}><rect className="tf-clip" x={hlX} y={lineY(s.added) - 16} width={hlW} height="22" style={delay} /></clipPath>
              </defs>
              <text className="tf-from" x={CARD.x + CARD.w - 14} y={CARD.y + 59} textAnchor="end">from {s.name.toLowerCase()}</text>
              {s.code.map((l, k) => (
                <text key={k} className="tf-code" x="126" y={lineY(k)} xmlSpace="preserve">{l}</text>
              ))}
              <g clipPath={`url(#${id})`}>
                <rect className="tf-hl" x={hlX} y={lineY(s.added) - 16} width={hlW} height="22" />
                <text className="tf-code hl" x="126" y={lineY(s.added)} xmlSpace="preserve">{s.code[s.added]}</text>
              </g>
              <text className="tf-plus" x="126" y={lineY(s.added) + 1}>+</text>
            </g>
          );
        })}
      </g>

      {DESTS.map((d, j) => {
        const Icon = d.icon;
        return (
          <g key={d.name} className="tf-pill">
            <rect x={destX(j)} y={DEST_Y} width={DEST_W} height="44" rx="22" />
            <foreignObject x={destX(j)} y={DEST_Y} width={DEST_W} height="44"><div className="tf-dest"><Icon size={15} /> {d.name}</div></foreignObject>
          </g>
        );
      })}

      {/* a destination lights up when one of its requests lands (once per sender routed to it) */}
      {SENDERS.map((_, i) => (
        <rect key={i} className="tf-flash" x={destX(ROUTE[i])} y={DEST_Y} width={DEST_W} height="44" rx="22" style={{ animationDelay: `${i * GAP + ARRIVE}s` }} />
      ))}
    </svg>
  );
}

function Comet({ d, delay }: { d: string; delay: number }) {
  const style = { animationDelay: `${delay}s` };
  return (
    <>
      <path d={d} className="tf-comet tail" pathLength={100} style={style} />
      <path d={d} className="tf-comet head" pathLength={100} style={style} />
    </>
  );
}
