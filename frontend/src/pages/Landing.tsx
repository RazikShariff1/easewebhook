import { Link } from "react-router-dom";
import { ArrowRight, Gauge, ScanSearch, SlidersHorizontal, RotateCcw, Check } from "lucide-react";
import { Logo } from "../components/Logo";
import { useAuth } from "../lib/auth";
import "./landing.css";

const SENDERS = ["Shopify", "Stripe", "Twilio", "GitHub", "Slack", "Razorpay", "Zendesk"];

export function LandingPage() {
  const { user } = useAuth();
  const primaryTo = user ? "/connections" : "/signup";
  const primaryLabel = user ? "Open dashboard" : "Start for free";

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link to="/" aria-label="EaseWebhook home"><Logo /></Link>
          <nav className="lp-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#delivery">Reliability</a>
          </nav>
          <div className="lp-nav-cta">
            {!user && <Link to="/login" className="lp-btn">Sign in</Link>}
            <Link to={primaryTo} className="lp-btn primary">{user ? "Dashboard" : "Get started"}</Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap">
          <h1>Never miss a <em>webhook</em></h1>
          <p className="lp-sub">
            Reliable webhook infrastructure for your apps and agents. Receive, filter, transform and deliver every
            event, with retries and full visibility, without running it yourself.
          </p>
          <div className="lp-actions">
            <Link to={primaryTo} className="lp-btn primary lg">{primaryLabel}</Link>
            <a href="#how" className="lp-btn lg">See how it works</a>
          </div>

          <div className="lp-strip">
            <div className="lp-eyebrow">{"{ WORKS WITH ANY WEBHOOK SENDER }"}</div>
            <ul>
              {SENDERS.map((s) => (
                <li key={s}><img src={`/brands/${s.toLowerCase()}.svg`} alt="" width="22" height="22" />{s}</li>
              ))}
              <li className="any">+ any HTTP sender</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="how" className="lp-wrap">
        <div className="lp-frame">
          <div className="lp-frame-top">
            <div className="lp-frame-copy">
              <h2>Event Gateway</h2>
              <div className="lp-eyebrow blue">RECEIVE WEBHOOKS</div>
              <p>Handle inbound webhooks before they hit your app or agent, with full observability and control.</p>
              <div className="lp-actions left">
                <Link to={primaryTo} className="lp-btn primary">{primaryLabel}</Link>
                <a href="#features" className="lp-btn">Learn more</a>
              </div>
            </div>
            <GatewayDiagram />
          </div>

          <div id="features" className="lp-cells">
            <Cell icon={<SlidersHorizontal />} title="Filter, transform, and route">
              <div className="lp-card">
                <div className="lp-card-head mono">FILTERING SHOPIFY → LOCAL…</div>
                <pre className="mono">{`{
  "product": {
    `}<mark>{`"inventory": 0`}</mark>{`
  }
}`}</pre>
              </div>
            </Cell>
            <Cell icon={<Gauge />} title="Queue with rate control">
              <div className="lp-card">
                <div className="lp-card-head mono">DELIVERY RATE</div>
                <div className="lp-queue">
                  {[8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => (
                    <span key={n} style={{ opacity: 0.25 + i * 0.1 }}>{n}</span>
                  ))}
                </div>
                <div className="lp-meter"><i /></div>
                <div className="lp-note mono">10 events / sec → destination</div>
              </div>
            </Cell>
            <Cell icon={<ScanSearch />} title="Auto-detect issues and replay">
              <div className="lp-card">
                <div className="lp-card-head err">HTTP 400 on “shopify → local”</div>
                <pre className="mono small">{`{ "type": `}<mark className="err">"validation_error"</mark>{`,
  "detail": "Invalid payload" }`}</pre>
                <div className="lp-fake-btn"><RotateCcw size={14} /> Bulk retry events</div>
              </div>
            </Cell>
          </div>
        </div>
      </section>

      <section id="delivery" className="lp-wrap lp-reliab">
        <h2>Built so nothing gets dropped</h2>
        <p className="lp-sub small">Every request is stored the moment it arrives, so a slow or broken destination never means lost data.</p>
        <div className="lp-grid">
          {[
            ["Verified ingestion", "HMAC, API key or basic auth verification on every source URL."],
            ["Automatic retries", "Linear or exponential backoff, with manual and bulk retry when you need it."],
            ["Full audit trail", "Every request, event and delivery attempt, searchable by status or payload."],
            ["JavaScript transforms", "Reshape payloads in flight with a small handler, tested before you ship."],
          ].map(([t, d]) => (
            <div className="lp-tile" key={t}>
              <Check size={16} />
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-wrap">
        <div className="lp-cta">
          <h2>Ready to stop losing events?</h2>
          <p>Create a source, point your sender at it, and watch events flow in minutes.</p>
          <Link to={primaryTo} className="lp-btn primary lg">{primaryLabel} <ArrowRight size={16} /></Link>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <Logo size={20} />
          <span>© {new Date().getFullYear()} EaseWebhook</span>
        </div>
      </footer>
    </div>
  );
}

function Cell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="lp-cell">
      <h3>{icon}{title}</h3>
      {children}
    </div>
  );
}

const SRC = [
  { y: 55, name: "Shopify", logo: "shopify" },
  { y: 150, name: "Stripe", logo: "stripe" },
  { y: 245, name: "Twilio", logo: "twilio" },
];
const DST = [
  { y: 55, name: "LOCAL", d: "M6 8l4 4-4 4M13 16h5" },
  { y: 150, name: "HTTP", d: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" },
  { y: 245, name: "AGENT", d: "M8 9h8a3 3 0 013 3v4a3 3 0 01-3 3H8a3 3 0 01-3-3v-4a3 3 0 013-3zM12 9V5M9.5 13.5v1M14.5 13.5v1" },
];

function GatewayDiagram() {
  const inPath = (y: number) => `M150 ${y} C 205 ${y}, 200 150, 230 150`;
  const outPath = (y: number) => `M290 150 C 320 150, 325 ${y}, 370 ${y}`;
  const packets = [
    ...SRC.map((_, i) => ({ id: `lp-in${i}`, begin: i * 0.7 })),
    ...DST.map((_, i) => ({ id: `lp-out${i}`, begin: 0.4 + i * 0.6 })),
  ];
  return (
    <svg className="lp-diagram" viewBox="0 0 520 300" role="img" aria-label="Shopify, Stripe and Twilio events flow through EaseWebhook to local, HTTP and agent destinations">
      {SRC.map((n, i) => <path key={`i${i}`} id={`lp-in${i}`} d={inPath(n.y)} className="flow" />)}
      {DST.map((n, i) => <path key={`o${i}`} id={`lp-out${i}`} d={outPath(n.y)} className="flow out" />)}
      {packets.map((p) => (
        <circle key={p.id} r="4" className="packet">
          <animateMotion dur="2.4s" begin={`${p.begin}s`} repeatCount="indefinite">
            <mpath href={`#${p.id}`} />
          </animateMotion>
        </circle>
      ))}
      {SRC.map((n) => (
        <g key={n.name}>
          <rect x="22" y={n.y - 21} width="128" height="42" rx="21" className="pill" />
          <image href={`/brands/${n.logo}.svg`} x="38" y={n.y - 10} width="20" height="20" />
          <text x="68" y={n.y + 5} className="pt">{n.name}</text>
        </g>
      ))}
      {DST.map((n) => (
        <g key={n.name}>
          <rect x="370" y={n.y - 21} width="128" height="42" rx="21" className="pill" />
          <g transform={`translate(386 ${n.y - 8}) scale(.67)`} className="ico"><path d={n.d} /></g>
          <text x="414" y={n.y + 4} className="pt mono">{n.name}</text>
        </g>
      ))}
      <rect x="230" y="112" width="60" height="76" rx="14" className="hub" />
      <rect x="226" y="108" width="68" height="84" rx="17" className="hub-ring" />
      <image href="/logo-icon.png" x="236" y="130" width="48" height="48" />
      <text x="260" y="124" textAnchor="middle" className="hub-tag mono">EASE</text>
    </svg>
  );
}
