import { FlaskConical, Globe, Terminal, type LucideIcon } from "lucide-react";
import { siGithub, siShopify, siStripe, type SimpleIcon } from "simple-icons";

const SOURCES: { name: string; icon: SimpleIcon; color: string }[] = [
  { name: "Stripe", icon: siStripe, color: "#8b85ff" },
  { name: "Shopify", icon: siShopify, color: "#95bf47" },
  { name: "GitHub", icon: siGithub, color: "#e8e8e8" },
];
const DESTS: { name: string; icon: LucideIcon }[] = [
  { name: "BILLING-API", icon: Globe },
  { name: "LOCAL", icon: Terminal },
  { name: "MOCK-INBOX", icon: FlaskConical },
];

const ROWS = [78, 158, 238];
const HUB = { x: 224, y: 122, size: 72 };
const CY = HUB.y + HUB.size / 2;
const inPath = (y: number) => `M 140 ${y} C 186 ${y}, 188 ${CY}, ${HUB.x} ${CY}`;
const outPath = (y: number) => `M ${HUB.x + HUB.size} ${CY} C 332 ${CY}, 334 ${y}, 380 ${y}`;
const LOOP = 6; // seconds: three requests, one every 2s, each going in then out to a different destination

/**
 * Empty-state illustration for Sources / Destinations: real-world senders on the left, the EaseWebhook
 * gateway (our logo) in the middle, endpoints on the right. `focus` picks which side is drawn solid, so a
 * Sources page leads with the senders and a Destinations page with the endpoints.
 */
export function EntityFlow({ focus }: { focus: "source" | "destination" }) {
  const srcOn = focus === "source";
  return (
    <svg className="ef" viewBox="0 0 520 300" role="img" aria-label="Stripe, Shopify and GitHub events pass through the EaseWebhook gateway to your endpoints">
      <text className="ef-label" x="70" y="30" textAnchor="middle">SOURCE</text>
      <text className="ef-label" x="450" y="30" textAnchor="middle">DESTINATION</text>

      {ROWS.map((y, i) => (
        <g key={i}>
          <path className="ef-wire" d={inPath(y)} />
          <path className="ef-wire" d={outPath(y)} />
        </g>
      ))}

      {/* three requests, staggered: sender i → hub → destination (i + 1) % 3 */}
      {SOURCES.map((_, i) => {
        const d = (i + 1) % 3;
        const t = i * (LOOP / 3);
        return (
          <g key={i}>
            <Comet d={inPath(ROWS[i])} delay={t} />
            <Comet d={outPath(ROWS[d])} delay={t + 0.95} />
          </g>
        );
      })}

      {SOURCES.map((s, i) => (
        <g key={s.name} className={srcOn ? "ef-pill" : "ef-pill dim"}>
          <rect x="0" y={ROWS[i] - 22} width="140" height="44" rx="22" />
          <g transform={`translate(22 ${ROWS[i] - 10}) scale(${20 / 24})`}><path d={s.icon.path} fill={s.color} /></g>
          <text className="ef-src" x="52" y={ROWS[i] + 5}>{s.name}</text>
        </g>
      ))}

      <g className="ef-hub">
        <rect x={HUB.x} y={HUB.y} width={HUB.size} height={HUB.size} rx="14" />
        <image href="/logo-icon.png" x={HUB.x + 4} y={HUB.y + 4} width={HUB.size - 8} height={HUB.size - 8} />
      </g>

      {DESTS.map((d, i) => {
        const Icon = d.icon;
        return (
          <g key={d.name} className={srcOn ? "ef-pill dim" : "ef-pill ef-arrive"} style={{ animationDelay: `${((i + 2) % 3) * (LOOP / 3) + 0.95 + 0.8}s` }}>
            <rect x="380" y={ROWS[i] - 22} width="140" height="44" rx="22" />
            <Icon x={398} y={ROWS[i] - 8} width={16} height={16} className="ef-ico" />
            <text className="ef-dest" x="422" y={ROWS[i] + 4}>{d.name}</text>
          </g>
        );
      })}
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
