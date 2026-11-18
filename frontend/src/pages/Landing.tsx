import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Gauge, ScanSearch, SlidersHorizontal, RotateCcw, Check, Code2, Telescope, Bot, ShieldCheck } from "lucide-react";
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

      <ProductionSection />

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
  { y: 50, name: "shopify", logo: "shopify", color: "#1a1a1a" },
  { y: 140, name: "stripe", logo: "stripe", color: "#635bff" },
  { y: 230, name: "twilio", logo: "twilio", color: "#e0334c" },
];
const DST = [
  { y: 50, name: "LOCAL", d: "M6 8l4 4-4 4M13 16h5" },
  { y: 140, name: "HTTP", d: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" },
  { y: 230, name: "AGENT", d: "M8 9h8a3 3 0 013 3v4a3 3 0 01-3 3H8a3 3 0 01-3-3v-4a3 3 0 013-3zM12 9V5M9.5 13.5v1M14.5 13.5v1" },
];

const LEG_MS = 1000; // time a request takes to cross one side of the hub

type Req = { id: number; s: number; d: number };

// Random requests: each picks a sender and a destination, travels in, then out. Several overlap at once.
function useRequests() {
  const [reqs, setReqs] = useState<Req[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id = 0, alive = true, timer: number;
    const spawn = () => {
      if (!alive) return;
      if (!document.hidden) {
        const r = { id: ++id, s: Math.floor(Math.random() * SRC.length), d: Math.floor(Math.random() * DST.length) };
        setReqs((p) => [...p.slice(-7), r]);
        window.setTimeout(() => setReqs((p) => p.filter((x) => x.id !== r.id)), LEG_MS * 2 + 100);
      }
      timer = window.setTimeout(spawn, 250 + Math.random() * 650);
    };
    timer = window.setTimeout(spawn, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return reqs;
}

function GatewayDiagram() {
  // Every line meets the hub at one point on its edge.
  const inPath = (y: number) => `M170 ${y} C 255 ${y}, 250 140, 328 140`;
  const outPath = (y: number) => `M432 140 C 510 140, 505 ${y}, 590 ${y}`;
  const reqs = useRequests();
  return (
    <svg className="lp-diagram" viewBox="0 0 760 280" role="img" aria-label="Shopify, Stripe and Twilio events flow through EaseWebhook to local, HTTP and agent destinations">
      {SRC.map((n) => <path key={`i${n.y}`} d={inPath(n.y)} className="flow" />)}
      {DST.map((n) => <path key={`o${n.y}`} d={outPath(n.y)} className="flow" />)}
      {reqs.map((r) => (
        <g key={r.id}>
          <path d={inPath(SRC[r.s].y)} pathLength={100} className="pulse tail" />
          <path d={inPath(SRC[r.s].y)} pathLength={100} className="pulse head" />
          <path d={outPath(DST[r.d].y)} pathLength={100} className="pulse tail" style={{ animationDelay: `${LEG_MS}ms` }} />
          <path d={outPath(DST[r.d].y)} pathLength={100} className="pulse head" style={{ animationDelay: `${LEG_MS}ms` }} />
        </g>
      ))}
      {SRC.map((n) => (
        <g key={n.name}>
          <rect x="22" y={n.y - 21} width="148" height="42" rx="21" className="pill" />
          <image href={`/brands/${n.logo}.svg`} x="42" y={n.y - 11} width="22" height="22" />
          <text x="76" y={n.y + 6} className="pt brand" fill={n.color}>{n.name}</text>
        </g>
      ))}
      {DST.map((n) => (
        <g key={n.name}>
          <rect x="590" y={n.y - 21} width="148" height="42" rx="21" className="pill" />
          <g transform={`translate(610 ${n.y - 9}) scale(.75)`} className="ico"><path d={n.d} /></g>
          <text x="640" y={n.y + 5} className="pt mono">{n.name}</text>
        </g>
      ))}
      <rect x="334" y="94" width="92" height="92" rx="18" className="hub" />
      <image href="/logo-icon.png" x="352" y="112" width="56" height="56" />
    </svg>
  );
}

/* ---------- Built for production ---------- */

// ---------- Live production stats (GET /api/public/stats: platform-wide aggregates, cached 60s server-side) ----------

interface PublicBucket { time: string; requests: number; avg_ms: number | null; p99_ms: number | null }
interface PublicStats {
  window_hours: number;
  bucket_minutes: number;
  series: PublicBucket[];
  avg_latency_ms: number | null;
  p99_latency_ms: number | null;
  requests_24h: number;
  requests_last_15m: number;
  requests_total: number;
  distinct_sources: number;
  events_delivered: number;
  delivery_success_rate: number | null;
  source_types_in_use: string[];
  generated_at: string;
}

function usePublicStats() {
  const [data, setData] = useState<PublicStats>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/public/stats")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) => alive && (setData(j.data), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return { data, failed };
}

const compact = (n: number) =>
  n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(1)}K` : n < 1e9 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1e9).toFixed(1)}B`;
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const CW = 960; // chart viewBox width
const CH = 190; // chart viewBox height
const TOP = 34; // room for the legend

/** End-to-end delivery latency over the last 24 h: avg and p99 per 30-min bucket, with hover readout. */
function LatencyChart({ stats }: { stats?: PublicStats }) {
  const [hover, setHover] = useState<number>();
  const series = stats?.series ?? [];
  const n = series.length;
  const peak = Math.max(1, ...series.map((b) => b.p99_ms ?? 0));
  const x = (i: number) => (n > 1 ? 6 + (i / (n - 1)) * (CW - 12) : 0);
  const y = (v: number) => CH - 8 - (v / peak) * (CH - TOP - 16);
  const line = (key: "avg_ms" | "p99_ms") => {
    let d = "";
    let pen = false;
    series.forEach((b, i) => {
      const v = b[key];
      if (v == null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const p99 = line("p99_ms");
  // shade only under spans that have data
  const area = p99
    .split("M")
    .filter(Boolean)
    .map((seg) => {
      const pts = seg.trim().split("L").map((p) => p.trim().split(" "));
      const [x0] = pts[0];
      const [x1] = pts[pts.length - 1];
      return pts.length > 1 ? `M${seg.trim()} L${x1} ${CH - 8} L${x0} ${CH - 8} Z` : "";
    })
    .join(" ");
  const avg = line("avg_ms");
  const hasData = series.some((b) => b.p99_ms != null);
  const lone = series.map((b, i) => ({ b, i })).filter(({ b, i }) => b.p99_ms != null && series[i - 1]?.p99_ms == null && series[i + 1]?.p99_ms == null);
  const hb = hover !== undefined ? series[hover] : undefined;

  return (
    <div className="lp-chart">
      <div className="lp-legend mono"><span className="d a" /> AVG <span className="d p" /> P99</div>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={hasData ? `Delivery latency over the last 24 hours: average ${ms(stats?.avg_latency_ms)}, p99 ${ms(stats?.p99_latency_ms)}` : "No deliveries in the last 24 hours"}
        onMouseMove={(e) => {
          if (!n) return;
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        <line x1="0" x2={CW} y1={CH - 8} y2={CH - 8} className="base" />
        {area && <path d={area} className="area" />}
        <path d={p99} className="p99" />
        <path d={avg} className="avg" />
        {lone.map(({ b, i }) => <circle key={b.time} cx={x(i)} cy={y(b.p99_ms!)} r="3" className="dot" />)}
        {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={TOP - 6} y2={CH - 8} className="cross" />}
      </svg>
      {!hasData && stats && <div className="lp-chart-empty mono">NO DELIVERIES IN THE LAST 24 H · THIS CHART IS LIVE</div>}
      {hb && hover !== undefined && (
        <div className="lp-chart-tip mono" style={{ left: `clamp(8px, calc(${(hover / Math.max(1, n - 1)) * 100}% - 80px), calc(100% - 168px))` }}>
          <div className="t">{clock(hb.time)}</div>
          <div><span>Requests</span><b>{hb.requests}</b></div>
          <div><span>Avg</span><b>{ms(hb.avg_ms)}</b></div>
          <div><span>P99</span><b>{ms(hb.p99_ms)}</b></div>
        </div>
      )}
      <div className="lp-chart-axis mono"><span>24H AGO</span><span>NOW</span></div>
    </div>
  );
}

// Providers pinned to the globe (longitude, latitude in degrees). Ones with live production traffic glow.
const GLOBE_NODES: { n: string; id: string; lon: number; lat: number }[] = [
  { n: "Shopify", id: "SHOPIFY", lon: 0, lat: 38 },
  { n: "Stripe", id: "STRIPE", lon: 32, lat: 58 },
  { n: "GitHub", id: "GITHUB", lon: 62, lat: 30 },
  { n: "Razorpay", id: "RAZORPAY", lon: 95, lat: 50 },
  { n: "Slack", id: "SLACK", lon: 125, lat: 24 },
  { n: "Paddle", id: "PADDLE", lon: 152, lat: 62 },
  { n: "Linear", id: "LINEAR", lon: 182, lat: 36 },
  { n: "Vercel", id: "VERCEL", lon: 212, lat: 54 },
  { n: "Twilio", id: "TWILIO", lon: 240, lat: 26 },
  { n: "Clerk", id: "CLERK", lon: 268, lat: 60 },
  { n: "Typeform", id: "TYPEFORM", lon: 298, lat: 34 },
  { n: "Zendesk", id: "ZENDESK", lon: 328, lat: 52 },
];

const GW = 440; // globe viewBox
const GH = 250;
const G = { cx: 220, cy: 236, r: 196, tilt: (24 * Math.PI) / 180 };

/** Orthographic projection of (lon, lat) on a sphere rotated by `rot` degrees and tilted toward the viewer. */
function project(lon: number, lat: number, rot: number) {
  const l = ((lon + rot) * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const x0 = Math.cos(p) * Math.sin(l);
  const y0 = Math.sin(p);
  const z0 = Math.cos(p) * Math.cos(l);
  const y = y0 * Math.cos(G.tilt) - z0 * Math.sin(G.tilt);
  const z = y0 * Math.sin(G.tilt) + z0 * Math.cos(G.tilt);
  return { x: G.cx + G.r * x0, y: G.cy - G.r * y, z };
}

/** Polyline through projected points, broken wherever the curve passes behind the sphere. */
function arc(points: [number, number][], rot: number) {
  let d = "";
  let pen = false;
  for (const [lon, lat] of points) {
    const q = project(lon, lat, rot);
    if (q.z <= 0) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

const range = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

function useRotation(degPerSec: number) {
  const [rot, setRot] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      // ~30fps is plenty for a slow spin
      if (t - last > 33) {
        setRot((r) => (r - ((t - last) / 1000) * degPerSec + 360) % 360);
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [degPerSec]);
  return rot;
}

function Globe({ live }: { live: string[] }) {
  const rot = useRotation(6);
  const meridians = range(0, 330, 30).map((lon) => arc(range(-90, 90, 5).map((lat) => [lon, lat]), rot));
  const parallels = range(-60, 75, 15).map((lat) => arc(range(0, 360, 5).map((lon) => [lon, lat]), rot));
  const rim = `M${G.cx - G.r} ${G.cy} A${G.r} ${G.r} 0 0 1 ${G.cx + G.r} ${G.cy}`;
  const nodes = GLOBE_NODES.map((n) => ({ ...n, ...project(n.lon, n.lat, rot), live: live.includes(n.id) }))
    .filter((n) => n.z > 0.05)
    .sort((a, b) => a.z - b.z); // nearer nodes paint on top

  return (
    <div className="lp-globe" aria-label={`Supported providers${live.length ? `; live traffic from ${live.join(", ").toLowerCase()}` : ""}`}>
      <svg viewBox={`0 0 ${GW} ${GH}`} aria-hidden="true">
        <defs>
          <radialGradient id="lp-gfill" cx="50%" cy="20%" r="80%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f3f3f1" />
          </radialGradient>
          <linearGradient id="lp-gfade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="65%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="lp-gmask"><rect width={GW} height={GH} fill="url(#lp-gfade)" /></mask>
        </defs>
        <g mask="url(#lp-gmask)">
          <circle cx={G.cx} cy={G.cy} r={G.r} fill="url(#lp-gfill)" />
          <g className="gl">
            {parallels.map((d, i) => <path key={`p${i}`} d={d} />)}
            {meridians.map((d, i) => <path key={`m${i}`} d={d} />)}
          </g>
          <path d={rim} className="rim" />
          {nodes.map((n) => (
            <g key={n.id} className={`gn ${n.live ? "live" : ""}`} transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`} opacity={Math.min(1, n.z * 2.2).toFixed(2)}>
              {n.live && <circle r="9" className="halo" />}
              <circle r={n.live ? 4 : 3} className="dot" />
              {n.z > 0.35 && <g transform="translate(0 -14)">
                <rect x={-(n.n.length * 3.6 + 9)} y="-9" width={n.n.length * 7.2 + 18} height="17" rx="3" className="pill" />
                <text textAnchor="middle" y="3" className="lbl">{n.n.toUpperCase()}</text>
              </g>}
            </g>
          ))}
        </g>
      </svg>
      <div className="lp-globe-key mono">
        <span><i className="live" /> LIVE TRAFFIC (30 DAYS)</span>
        <span><i /> SUPPORTED</span>
      </div>
    </div>
  );
}

const SECURITY = ["HMAC", "ED25519", "API KEY", "BASIC AUTH", "REPLAY GUARD", "BEARER", "WORKSPACE ROLES", "GOOGLE SIGN-IN"];

function ProductionSection() {
  const { data: st, failed } = usePublicStats();
  const v = (f: (s: PublicStats) => string) => (st ? f(st) : failed ? "—" : "…");
  return (
    <section className="lp-wrap lp-prod">
      <h2>Built for production</h2>
      <p className="lp-live mono">
        <i className={st ? "on" : ""} /> {st ? `LIVE PRODUCTION DATA · UPDATED ${clock(st.generated_at)}` : failed ? "LIVE DATA UNAVAILABLE RIGHT NOW" : "LOADING LIVE DATA…"}
      </p>
      <div className="lp-pgrid">
        <div className="lp-pc scale">
          <h3>Dependable at any scale</h3>
          <p>
            Requests are stored the moment they arrive. A Postgres-backed queue, per-destination rate limits and
            retries with backoff keep slow or failing destinations from costing you events.
          </p>
          <LatencyChart stats={st} />
          <div className="lp-stats">
            <div className="on" title="Average time from a webhook arriving to its first delivery finishing, last 24 h">
              <strong className="mono">{v((s) => ms(s.avg_latency_ms))}</strong>
              <span className="mono"><i /> DELIVERY LATENCY</span>
              <small className="mono">{v((s) => (s.p99_latency_ms == null ? "no deliveries in 24h" : `p99 ${ms(s.p99_latency_ms)} · last 24h`))}</small>
            </div>
            <div title="Webhooks received in the last 24 hours">
              <strong className="mono">{v((s) => compact(s.requests_24h))}</strong>
              <span className="mono"><i /> LIVE TRAFFIC</span>
              <small className="mono">{v((s) => `${compact(s.requests_last_15m)} in the last 15 min`)}</small>
            </div>
            <div title="Events delivered successfully out of all finished events (excludes ones still retrying)">
              <strong className="mono">{v((s) => (s.delivery_success_rate == null ? "—" : `${s.delivery_success_rate.toFixed(1)}%`))}</strong>
              <span className="mono"><i /> DELIVERY SUCCESS</span>
              <small className="mono">{v((s) => `${compact(s.events_delivered)} events delivered`)}</small>
            </div>
          </div>
        </div>

        <div className="lp-pc dev">
          <h3>Developer-first experience</h3>
          <ul className="lp-ticks">
            <li><span><Code2 /></span>Any HTTP sender, any destination</li>
            <li><span><Telescope /></span>Observable by default</li>
            <li><span><Bot /></span>Built for apps and agents</li>
          </ul>
          <div className="lp-term">
            <div className="lp-term-bar mono"><i /><i /><i />terminal</div>
            <div className="lp-term-body mono">
              <small>~/dev</small>
              <div><span className="typed">add event_type to the shopify transform</span><em /></div>
            </div>
          </div>
          <div className="lp-term lp-tx">
            <div className="lp-term-bar mono">TRANSFORMATION · SHOPIFY → LOCAL</div>
            <pre className="lp-term-body mono">{`function handler(req) {
  req.body.event_details = [{
    date: req.body.created_at,
`}<mark>{`    event_type: "purchases"`}</mark>{`
  }];
  return req;
}`}</pre>
            <span className="lp-agent mono">AGENT</span>
          </div>
        </div>

        <div className="lp-pc sec">
          <h3>Secure by default</h3>
          <p>Verify every sender before an event ever reaches your app.</p>
          <div className="lp-badges">
            {SECURITY.map((b) => (
              <div key={b} className="lp-badge"><ShieldCheck size={14} /><span className="mono">{b}</span></div>
            ))}
          </div>
          <div className="lp-stats two">
            <div>
              <strong className="mono">30</strong>
              <span className="mono">PROVIDER SIGNATURE CHECKS</span>
            </div>
            <div>
              <strong className="mono">5 MIN</strong>
              <span className="mono">REPLAY WINDOW</span>
            </div>
          </div>
        </div>

        <div className="lp-pc works">
          <h3>Works everywhere you do</h3>
          <p>Native signature verification for 30 providers, plus generic HMAC, API key and basic auth for the rest.</p>
          <Globe live={st?.source_types_in_use ?? []} />
          <div className="lp-stats two">
            <div>
              <strong className="mono">{v((s) => compact(s.requests_total))}</strong>
              <span className="mono">WEBHOOKS PROCESSED</span>
            </div>
            <div>
              <strong className="mono">{v((s) => compact(s.distinct_sources))}</strong>
              <span className="mono">DISTINCT WEBHOOK SOURCES</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
