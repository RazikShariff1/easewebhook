import type React from "react";
import { Bell, Globe, MessageSquare, Shuffle, UserPlus, type LucideIcon } from "lucide-react";
import { siClerk, siGithub, siSentry, siShopify, siStripe, type SimpleIcon } from "simple-icons";

// Each sender has its own payload and the line the transformation adds to it. Routing matches the purpose:
// Stripe and Shopify orders → your API, GitHub pushes → chat, Sentry alerts → on-call, Clerk sign-ups → CRM.
const SENDERS: { name: string; icon: SimpleIcon; color: string; code: string[]; added: number }[] = [
  { name: "Stripe", icon: siStripe, color: "#8b85ff", added: 4, code: ["{", '  "type": "charge.succeeded",', '  "amount": 4900,', '  "currency": "usd",', '  "event_type": "purchases"', "}"] },
  { name: "Shopify", icon: siShopify, color: "#95bf47", added: 4, code: ["{", '  "id": 8127,', '  "total_price": "129.00",', '  "customer": "ana@acme.io",', '  "priority": "vip"', "}"] },
  { name: "GitHub", icon: siGithub, color: "#e8e8e8", added: 4, code: ["{", '  "ref": "refs/heads/main",', '  "pusher": "ana",', '  "commits": 3,', '  "channel": "#deploys"', "}"] },
  { name: "Sentry", icon: siSentry, color: "#b8a4ff", added: 4, code: ["{", '  "issue": "TypeError in cart",', '  "level": "error",', '  "users": 142,', '  "severity": "high"', "}"] },
  { name: "Clerk", icon: siClerk, color: "#a58bff", added: 4, code: ["{", '  "type": "user.created",', '  "email": "sam@acme.io",', '  "plan": "trial",', '  "lead_source": "webflow"', "}"] },
];
const DESTS: { name: string; icon: LucideIcon }[] = [
  { name: "YOUR-API", icon: Globe },
  { name: "CRM", icon: UserPlus },
  { name: "CHAT", icon: MessageSquare },
  { name: "ON-CALL", icon: Bell },
];
// sender i → destination ROUTE[i]: one destination gets two senders, the rest one each
const ROUTE = [0, 0, 2, 3, 1];

const PILL_W = 96, PILL_GAP = 10;
const srcX = (i: number) => i * (PILL_W + PILL_GAP);
const srcC = (i: number) => srcX(i) + PILL_W / 2; // 48, 154, 260, 366, 472
const DEST_W = 118, DEST_GAP = 14;
const destX = (j: number) => 3 + j * (DEST_W + DEST_GAP);
const destC = (j: number) => destX(j) + DEST_W / 2;
const CARD = { x: 110, y: 150, w: 300, h: 234 };
const outStart = (j: number) => 140 + j * 80; // spread along the card's bottom edge
const inPath = (i: number) => (srcC(i) === 260 ? `M 260 66 V 150` : `M ${srcC(i)} 66 C ${srcC(i)} 120, 260 96, 260 150`);
const outPath = (j: number) => `M ${outStart(j)} 384 C ${outStart(j)} 410, ${destC(j)} 398, ${destC(j)} 424`;

// One CSS timeline drives everything, so the code can never drift from the request it belongs to:
// request i enters the card at i*GAP + IN, its code is shown from then until the next request arrives,
// and the request leaves for its destination at i*GAP + OUT_AT.
const GAP = 2; // seconds between requests
const LOOP = SENDERS.length * GAP; // 10s
const IN = 0.78; // inbound comet reaches the card
const OUT_AT = 1.05;
const ARRIVE = OUT_AT + 0.8;

/**
 * Empty-state illustration for Transformations. One diagram: several senders feed a "Transform payload" step,
 * which rewrites each event and routes it to one of several destinations. Requests travel as blue comets and
 * the card shows the payload of the request currently inside it (with the line the transformation adds
 * highlighted), so the code always matches the sender.
 */
export function TransformFlow() {
  const lineY = (i: number) => 224 + i * 22;
  // negative delays start the loop mid-cycle, so the first frame already looks like steady state
  const showDelay = (i: number) => i * GAP + IN - LOOP;

  return (
    <svg className="tf" style={{ "--tf-loop": `${LOOP}s` } as React.CSSProperties} viewBox="0 0 520 480" role="img" aria-label="Stripe, Shopify, GitHub, Sentry and Clerk events pass through a transformation that rewrites the payload, then reach your API, CRM, chat and on-call destinations">
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

      <g className="tf-card">
        <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx="10" />
        <line x1={CARD.x} y1="192" x2={CARD.x + CARD.w} y2="192" />
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
              <text className="tf-from" x={CARD.x + CARD.w - 14} y="209" textAnchor="end">from {s.name.toLowerCase()}</text>
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
            <rect x={destX(j)} y="424" width={DEST_W} height="44" rx="22" />
            <foreignObject x={destX(j)} y="424" width={DEST_W} height="44"><div className="tf-dest"><Icon size={15} /> {d.name}</div></foreignObject>
          </g>
        );
      })}

      {/* a destination lights up when one of its requests lands (once per sender routed to it) */}
      {SENDERS.map((_, i) => (
        <rect key={i} className="tf-flash" x={destX(ROUTE[i])} y="424" width={DEST_W} height="44" rx="22" style={{ animationDelay: `${i * GAP + ARRIVE}s` }} />
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
