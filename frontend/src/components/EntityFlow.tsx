import { Bell, Globe, Terminal, UserPlus, type LucideIcon } from "lucide-react";
import { siClerk, siGithub, siSentry, siShopify, siStripe, type SimpleIcon } from "simple-icons";

const SOURCES: { name: string; icon: SimpleIcon; color: string }[] = [
  { name: "Stripe", icon: siStripe, color: "#8b85ff" },
  { name: "Shopify", icon: siShopify, color: "#95bf47" },
  { name: "GitHub", icon: siGithub, color: "#e8e8e8" },
  { name: "Clerk", icon: siClerk, color: "#a58bff" },
  { name: "Sentry", icon: siSentry, color: "#b8a4ff" },
];
const DESTS: { name: string; icon: LucideIcon; color: string }[] = [
  { name: "BILLING-API", icon: Globe, color: "#6fb1ff" },
  { name: "LOCAL", icon: Terminal, color: "#4fd68a" },
  { name: "CRM", icon: UserPlus, color: "#c58bff" },
  { name: "ON-CALL", icon: Bell, color: "#ff7a7a" },
];

// The diagram is a layer behind the card's copy (1080 x 440 logical units, the card's aspect ratio): senders in a
// column, the hub, then endpoints in a column, all on the right of the copy. Endpoint rows fall between sender rows.
const PILL = 132, PH = 36; // pill width / height
const SP = [108, 170, 232, 294, 356].map((y) => ({ x: 510, y }));
const DP = [124, 196, 268, 340].map((y) => ({ x: 898, y }));
const N = SP.length;
const HUB = { x: 750, y: 202, size: 60 };
const CY = HUB.y + HUB.size / 2;
const inPath = (p: { x: number; y: number }) => {
  const x0 = p.x + PILL, k = Math.max(60, (HUB.x - x0) * 0.45);
  return `M ${x0} ${p.y} C ${x0 + k} ${p.y}, ${HUB.x - k} ${CY}, ${HUB.x} ${CY}`;
};
const outPath = (p: { x: number; y: number }) => {
  const x0 = HUB.x + HUB.size, k = Math.max(60, (p.x - x0) * 0.45);
  return `M ${x0} ${CY} C ${x0 + k} ${CY}, ${p.x - k} ${p.y}, ${p.x} ${p.y}`;
};
const LOOP = 6; // seconds: five requests, one every 1.2s, each going in then out to a different destination

/**
 * Empty-state illustration for Sources / Destinations: real-world senders on the left, the EaseWebhook
 * gateway (our logo) in the middle, endpoints on the right. `focus` picks which side is drawn solid, so a
 * Sources page leads with the senders and a Destinations page with the endpoints.
 */
export function EntityFlow({ focus }: { focus: "source" | "destination" }) {
  const srcOn = focus === "source";
  return (
    <svg className="ef" viewBox="0 0 1080 440" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Events from Stripe, Shopify, GitHub and other senders pass through the EaseWebhook gateway to your endpoints">
      <text className="ef-label" x={SP[0].x + PILL / 2} y="52" textAnchor="middle">SOURCE</text>
      <text className="ef-label" x={DP[0].x + PILL / 2} y="52" textAnchor="middle">DESTINATION</text>
      {/* dashed pointers from the labels down to the first sender / endpoint */}
      <line className="ef-lead" x1={SP[0].x + PILL / 2} y1="62" x2={SP[0].x + PILL / 2} y2={SP[0].y - PH / 2 - 6} />
      <line className="ef-lead" x1={DP[0].x + PILL / 2} y1="62" x2={DP[0].x + PILL / 2} y2={DP[0].y - PH / 2 - 6} />
      <g>
        {SP.map((p, i) => <path key={i} className="ef-wire" d={inPath(p)} />)}
        {DP.map((p, i) => <path key={i} className="ef-wire" d={outPath(p)} />)}

        {/* five requests, staggered: sender i → hub → destination i % 4 */}
        {SP.map((p, i) => {
          const t = i * (LOOP / N);
          return (
            <g key={i}>
              <Comet d={inPath(p)} delay={t} />
              <Comet d={outPath(DP[i % DP.length])} delay={t + 0.95} />
            </g>
          );
        })}

        {SOURCES.map((s, i) => (
          <g key={s.name} className={srcOn ? "ef-pill" : "ef-pill dim"}>
            <rect x={SP[i].x} y={SP[i].y - PH / 2} width={PILL} height={PH} rx={PH / 2} />
            <g transform={`translate(${SP[i].x + 16} ${SP[i].y - 8}) scale(${16 / 24})`}><path d={s.icon.path} fill={s.color} /></g>
            <text className="ef-src" x={SP[i].x + 42} y={SP[i].y + 4}>{s.name}</text>
          </g>
        ))}

        <g className="ef-hub">
          <rect x={HUB.x} y={HUB.y} width={HUB.size} height={HUB.size} rx="12" />
          <image href="/logo-icon.png" x={HUB.x + 3} y={HUB.y + 3} width={HUB.size - 6} height={HUB.size - 6} />
        </g>

        {DESTS.map((d, i) => {
          const Icon = d.icon;
          const p = DP[i];
          return (
            <g key={d.name} className={srcOn ? "ef-pill dim" : "ef-pill ef-arrive"} style={{ animationDelay: `${i * (LOOP / N) + 0.95 + 0.8}s` }}>
              <rect x={p.x} y={p.y - PH / 2} width={PILL} height={PH} rx={PH / 2} />
              <Icon x={p.x + 14} y={p.y - 7.5} width={15} height={15} color={d.color} strokeWidth={1.8} />
              <text className="ef-dest" x={p.x + 36} y={p.y + 3.5}>{d.name}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function Comet({ d, delay }: { d: string; delay: number }) {
  const style = { animationDelay: `${delay}s` };
  return (
    <>
      <path d={d} className="ef-comet tail" pathLength={100} style={style} />
      <path d={d} className="ef-comet head" pathLength={100} style={style} />
    </>
  );
}
