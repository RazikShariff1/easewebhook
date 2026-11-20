import { useEffect, useState } from "react";
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
