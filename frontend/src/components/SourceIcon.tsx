import { Globe, KeyRound, Webhook } from "lucide-react";
import { useSourceTypes } from "../lib/sourceTypes";
import {
  siBitbucket,
  siCalendly,
  siClerk,
  siDiscord,
  siFacebook,
  siGithub,
  siGitlab,
  siInstagram,
  siIntercom,
  siLinear,
  siMailgun,
  siPaddle,
  siRazorpay,
  siResend,
  siSentry,
  siShopify,
  siStripe,
  siTwitch,
  siTypeform,
  siVercel,
  siWhatsapp,
  siWoocommerce,
  siZendesk,
  type SimpleIcon,
} from "simple-icons";

// Brand marks from simple-icons (CC0), keyed by the catalog's icon slug. Wordmark-only logos (e.g. Cal.com)
// are left out on purpose: they are unreadable at icon size, so they get the lettered tile.
const brands: Record<string, SimpleIcon> = {
  bitbucket: siBitbucket, calendly: siCalendly, clerk: siClerk, discord: siDiscord,
  facebook: siFacebook, github: siGithub, gitlab: siGitlab, instagram: siInstagram, intercom: siIntercom,
  linear: siLinear, mailgun: siMailgun, paddle: siPaddle, razorpay: siRazorpay, resend: siResend, sentry: siSentry,
  shopify: siShopify, stripe: siStripe, twitch: siTwitch, typeform: siTypeform, vercel: siVercel,
  whatsapp: siWhatsapp, woocommerce: siWoocommerce, zendesk: siZendesk,
};

// Very dark brand colours disappear on the dark UI; draw those in the text colour instead.
function visible(hex: string): string {
  const n = parseInt(hex, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.28 ? "var(--text)" : `#${hex}`;
}

export function SourceIcon({ icon, name, size = 16 }: { icon?: string; name?: string; size?: number }) {
  if (icon === "webhook") return <Webhook size={size} />;
  if (icon === "key") return <KeyRound size={size} />;
  if (icon === "globe") return <Globe size={size} />;

  const b = icon ? brands[icon] : undefined;
  if (b) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={b.title} style={{ flexShrink: 0 }}>
        <path d={b.path} fill={visible(b.hex)} />
      </svg>
    );
  }

  // no brand mark available: lettered tile
  return (
    <span className="src-letter" style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }} aria-hidden="true">
      {(name ?? icon ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Icon for a source by its type ID (resolved through the catalog). */
export function SourceTypeIcon({ type, size = 16 }: { type?: string; size?: number }) {
  const t = useSourceTypes().find((x) => x.id === type);
  return <SourceIcon icon={t?.icon ?? "webhook"} name={t?.name} size={size} />;
}
