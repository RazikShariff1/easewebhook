import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Bot, SquareTerminal, type LucideIcon } from "lucide-react";
import { CopyText } from "./ui";

const SRC = [
  { y: 50, name: "shopify", logo: "shopify" },
  { y: 140, name: "stripe", logo: "stripe" },
  { y: 230, name: "twilio", logo: "twilio" },
];
const DST: { y: number; name: string; icon: LucideIcon }[] = [
  { y: 50, name: "LOCAL", icon: SquareTerminal },
  { y: 140, name: "HTTP", icon: Globe },
  { y: 230, name: "AGENT", icon: Bot },
];

const LEG_MS = 1000; // time a request takes to cross one side of the hub, same as the landing page
const inPath = (y: number) => `M150 ${y} C 215 ${y}, 212 140, 262 140`;
const outPath = (y: number) => `M358 140 C 408 140, 405 ${y}, 470 ${y}`;

type Req = { id: number; s: number; d: number };

// Same idea as the landing page: random requests pick a sender and a destination, travel in, then out.
function useRequests() {
  const [reqs, setReqs] = useState<Req[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id = 0, alive = true, timer: number;
    const spawn = () => {
      if (!alive) return;
      if (!document.hidden) {
        const r = { id: ++id, s: Math.floor(Math.random() * SRC.length), d: Math.floor(Math.random() * DST.length) };
        setReqs((p) => [...p.slice(-5), r]);
        window.setTimeout(() => setReqs((p) => p.filter((x) => x.id !== r.id)), LEG_MS * 2 + 100);
      }
      timer = window.setTimeout(spawn, 350 + Math.random() * 800);
    };
    timer = window.setTimeout(spawn, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return reqs;
}

function Diagram() {
  const reqs = useRequests();
  return (
    <svg className="rq" viewBox="0 0 520 280" role="img" aria-label="Requests from Shopify, Stripe and Twilio arrive at EaseWebhook and are delivered to local, HTTP and agent destinations">
      {SRC.map((n) => <path key={`i${n.y}`} d={inPath(n.y)} className="rq-wire" />)}
      {DST.map((n) => <path key={`o${n.y}`} d={outPath(n.y)} className="rq-wire" />)}
      {reqs.map((r) => (
        <g key={r.id}>
          <path d={inPath(SRC[r.s].y)} pathLength={100} className="rq-pulse tail in" />
          <path d={inPath(SRC[r.s].y)} pathLength={100} className="rq-pulse head in" />
          <path d={outPath(DST[r.d].y)} pathLength={100} className="rq-pulse tail ok" style={{ animationDelay: `${LEG_MS}ms` }} />
          <path d={outPath(DST[r.d].y)} pathLength={100} className="rq-pulse head ok" style={{ animationDelay: `${LEG_MS}ms` }} />
        </g>
      ))}
      {SRC.map((n) => (
        <g key={n.name} className="rq-pill">
          <rect x="10" y={n.y - 19} width="140" height="38" rx="19" />
          <image href={`/brands/${n.logo}.svg`} x="28" y={n.y - 10} width="20" height="20" />
          <text x="58" y={n.y + 5} className="rq-brand">{n.name}</text>
        </g>
      ))}
      {DST.map((n) => (
        <g key={n.name} className="rq-pill">
          <rect x="370" y={n.y - 19} width="140" height="38" rx="19" />
          <n.icon x={388} y={n.y - 8} width={16} height={16} className="rq-ico" />
          <text x="414" y={n.y + 5} className="rq-dest">{n.name}</text>
        </g>
      ))}
      <rect x="262" y="94" width="96" height="92" rx="18" className="rq-hub" />
      <image href="/logo-icon.png" x="282" y="112" width="56" height="56" />
    </svg>
  );
}

/** Requests page with nothing to show yet: the landing page's hub animation, plus how to send the first request. */
export function RequestsEmpty({ sourceUrl }: { sourceUrl?: string }) {
  return (
    <div className="hero-empty">
      <div style={{ alignSelf: "center" }}>
        <h3>Waiting for your first request</h3>
        <p>
          Every HTTP request sent to a source URL is captured here, then routed through your connections to its destinations,
          with retries if a delivery fails.
        </p>
        {sourceUrl ? (
          <>
            <div className="rq-send mono"><span className="rq-method">POST</span><CopyText text={sourceUrl}><span className="truncate">{sourceUrl}</span></CopyText></div>
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Point your sender at this URL, or send a test request with curl.</p>
          </>
        ) : (
          <Link to="/sources" className="btn primary">Create a source</Link>
        )}
      </div>
      <Diagram />
    </div>
  );
}
