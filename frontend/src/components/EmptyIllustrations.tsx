import { useEffect, useState } from "react";
import { FlaskConical, Globe, Link2, RotateCw, ShieldCheck, Terminal, type LucideIcon } from "lucide-react";
import {
  siCalendly, siClerk, siDiscord, siGithub, siGitlab, siHubspot, siIntercom, siLinear, siMailgun, siPaddle, siPaypal,
  siRazorpay, siSentry, siShopify, siStripe, siVercel, siWhatsapp, siZendesk, type SimpleIcon,
} from "simple-icons";

type Brand = { name: string; icon: SimpleIcon; color: string };
// Sample providers for the empty states. Colours are lightened where the brand colour disappears on the dark UI.
const B = (name: string, icon: SimpleIcon, color: string): Brand => ({ name, icon, color });
const STRIPE = B("Stripe", siStripe, "#8b85ff");
const SHOPIFY = B("Shopify", siShopify, "#95bf47");
const GITHUB = B("GitHub", siGithub, "#e8e8e8");
const CLERK = B("Clerk", siClerk, "#a58bff");
const SENTRY = B("Sentry", siSentry, "#b8a4ff");
const RAZORPAY = B("Razorpay", siRazorpay, "#5aa9ff");
const WHATSAPP = B("WhatsApp", siWhatsapp, "#25d366");
const VERCEL = B("Vercel", siVercel, "#ffffff");
const LINEAR = B("Linear", siLinear, "#8f9bff");
const DISCORD = B("Discord", siDiscord, "#7b8bff");
const ZENDESK = B("Zendesk", siZendesk, "#78d6c6");
const INTERCOM = B("Intercom", siIntercom, "#6afdef");
const MAILGUN = B("Mailgun", siMailgun, "#f06b66");
const CALENDLY = B("Calendly", siCalendly, "#4d9bff");
const GITLAB = B("GitLab", siGitlab, "#fc6d26");
const HUBSPOT = B("HubSpot", siHubspot, "#ff7a59");
const PAYPAL = B("PayPal", siPaypal, "#3b82f6");
const PADDLE = B("Paddle", siPaddle, "#fddd35");

function Mark({ icon, x, y, size, color }: { icon: SimpleIcon; x: number; y: number; size: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 24})`}>
      <path d={icon.path} fill={color} />
    </g>
  );
}

function Comet({ d, delay }: { d: string; delay: number }) {
  const style = { animationDelay: `${delay}s` };
  return (
    <>
      <path d={d} className="ill-comet tail" pathLength={100} style={style} />
      <path d={d} className="ill-comet head" pathLength={100} style={style} />
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------
 * SOURCES: many senders → one source URL. The card is the hero: the URL you give to a provider, with signature
 * verification and a listening indicator. 6s loop, a request every 1.5s.
 * ---------------------------------------------------------------------------------------------------------- */
// Four senders at a time; the set rotates through these every loop (6s), so the picture isn't about any one provider.
const SF_POOL = [STRIPE, SHOPIFY, GITHUB, CLERK, RAZORPAY, WHATSAPP, VERCEL, LINEAR, DISCORD, ZENDESK, INTERCOM, MAILGUN, CALENDLY, GITLAB, HUBSPOT, SENTRY];
const SF_ROWS = [38, 108, 178, 248];
const sfIn = (y: number) => `M 118 ${y} C 172 ${y}, 190 150, 244 150`;

export function SourcesIllustration() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setN((x) => x + 1), 6000);
    return () => clearInterval(t);
  }, []);
  const senders = [0, 1, 2, 3].map((k) => SF_POOL[(n * 4 + k) % SF_POOL.length]);
  return (
    <svg className="ill sf" viewBox="0 0 520 300" role="img" aria-label={`${senders.map((b) => b.name).join(", ")} and other providers send requests to your source URL`}>
      <text className="ill-label" x="59" y="14" textAnchor="middle">SENDERS</text>
      {SF_ROWS.map((y) => <path key={y} className="ill-wire" d={sfIn(y)} />)}
      {senders.map((_, i) => <Comet key={i} d={sfIn(SF_ROWS[i])} delay={i * 1.5} />)}
      {senders.map((s, i) => (
        <g key={s.name} className="ill-pill ill-fade">
          <rect x="0" y={SF_ROWS[i] - 22} width="118" height="44" rx="22" />
          <Mark icon={s.icon} x={20} y={SF_ROWS[i] - 10} size={20} color={s.color} />
          <text className="ill-src" x="48" y={SF_ROWS[i] + 5}>{s.name}</text>
        </g>
      ))}
      <rect className="sf-box" x="244" y="68" width="276" height="164" rx="12" />
      <foreignObject x="244" y="68" width="276" height="164">
        <div className="sf-card">
          <div className="sf-top"><Link2 size={14} /> YOUR SOURCE URL</div>
          <div className="sf-url"><span className="dim">https://hook.easewebhook.com</span>/e/src_8f3a2c</div>
          <div className="sf-chips">
            <span className="post">POST</span>
            <span className="ok"><ShieldCheck size={12} /> Signature verified</span>
          </div>
          <div className="sf-live"><i /> Listening for requests</div>
        </div>
      </foreignObject>
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------------------
 * DESTINATIONS: the gateway fans out to endpoints, each with its delivery status. One endpoint fails with a 503,
 * then the retry lands. 9s loop.
 * ---------------------------------------------------------------------------------------------------------- */
const DF_CARDS: { name: string; url: string; icon: LucideIcon; y: number }[] = [
  { name: "billing-api", url: "POST api.acme.com/webhooks", icon: Globe, y: 24 },
  { name: "orders-service", url: "POST orders.acme.com/hook", icon: FlaskConical, y: 114 },
  { name: "local-dev", url: "POST localhost:3000/hook", icon: Terminal, y: 204 },
];
const dfOut = (cy: number) => `M 80 150 C 134 150, 140 ${cy}, 190 ${cy}`;

export function DestinationsIllustration() {
  return (
    <svg className="ill df" viewBox="0 0 520 300" role="img" aria-label="EaseWebhook delivers events to your endpoints and retries a failed delivery until it succeeds">
      {DF_CARDS.map((c) => <path key={c.name} className="ill-wire" d={dfOut(c.y + 36)} />)}
      {/* deliveries: billing, orders (fails), local, then the retry to orders */}
      <Comet d={dfOut(60)} delay={0} />
      <Comet d={dfOut(150)} delay={1.5} />
      <Comet d={dfOut(240)} delay={3} />
      <Comet d={dfOut(150)} delay={4.5} />

      <g className="df-hub">
        <rect x="8" y="114" width="72" height="72" rx="14" />
        <image href="/logo-icon.png" x="12" y="118" width="64" height="64" />
      </g>

      {DF_CARDS.map((c, i) => {
        const Icon = c.icon;
        return (
          <g key={c.name}>
            <rect className="df-box" x="190" y={c.y} width="330" height="72" rx="12" />
            <foreignObject x="190" y={c.y} width="330" height="72">
              <div className="df-card">
                <span className="ico"><Icon size={16} /></span>
                <span className="txt"><b>{c.name}</b><small>{c.url}</small></span>
                <span className="df-st">
                  <span className="wait">queued</span>
                  {i === 1 && <span className="fail"><RotateCw size={11} /> 503 · retry</span>}
                  <span className={`ok ok${i}`}>200 OK</span>
                </span>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------------------
 * REQUESTS: a live request log. New rows slide in at the top, like the real Requests table fills up.
 * ---------------------------------------------------------------------------------------------------------- */
type Row = { id: number; src: Brand; method: string; path: string; ok: boolean };
// Consecutive rows are always different providers.
const POOL: Omit<Row, "id">[] = [
  { src: STRIPE, method: "POST", path: "/stripe", ok: true },
  { src: SHOPIFY, method: "POST", path: "/orders/create", ok: true },
  { src: GITHUB, method: "POST", path: "/push", ok: true },
  { src: RAZORPAY, method: "POST", path: "/payment.captured", ok: true },
  { src: WHATSAPP, method: "POST", path: "/message.received", ok: true },
  { src: VERCEL, method: "POST", path: "/deployment.ready", ok: true },
  { src: LINEAR, method: "POST", path: "/issue.created", ok: true },
  { src: DISCORD, method: "POST", path: "/interaction", ok: false },
  { src: ZENDESK, method: "POST", path: "/ticket.created", ok: true },
  { src: INTERCOM, method: "POST", path: "/conversation", ok: true },
  { src: MAILGUN, method: "POST", path: "/delivered", ok: true },
  { src: CALENDLY, method: "POST", path: "/invitee.created", ok: true },
  { src: GITLAB, method: "POST", path: "/pipeline", ok: true },
  { src: HUBSPOT, method: "POST", path: "/contact.created", ok: true },
  { src: SENTRY, method: "POST", path: "/alerts", ok: true },
  { src: CLERK, method: "POST", path: "/user.created", ok: true },
  { src: PAYPAL, method: "POST", path: "/checkout.completed", ok: true },
  { src: PADDLE, method: "POST", path: "/subscription.created", ok: true },
];
const VISIBLE = 5;

export function RequestsIllustration() {
  const [rows, setRows] = useState<Row[]>(() => POOL.slice(0, VISIBLE).map((p, i) => ({ ...p, id: VISIBLE - 1 - i })).reverse());
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let n = VISIBLE;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      setRows((r) => [{ ...POOL[n % POOL.length], id: n++ }, ...r].slice(0, VISIBLE));
    }, 1700);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rqf" role="img" aria-label="A log of incoming requests from many providers">
      <div className="rqf-head"><span>Requests</span></div>
      <div className="rqf-cols"><span>Request</span><span>Source</span><span>Status</span></div>
      <div className="rqf-list" key={rows[0].id}>
        {rows.map((r, i) => (
          <div key={r.id} className={`rqf-row ${i === 0 ? "fresh" : ""}`}>
            <span className="req"><b>{r.method}</b> {r.path}</span>
            <span className="src">
              <svg viewBox="0 0 24 24" width="14" height="14"><path d={r.src.icon.path} fill={r.src.color} /></svg>
              {r.src.name}
            </span>
            <span className={`st ${r.ok ? "ok" : "bad"}`}>{r.ok ? "Accepted" : "Rejected"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
