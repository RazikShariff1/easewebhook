import { Bell, Globe, MessageSquare, UserPlus, type LucideIcon } from "lucide-react";
import { siClerk, siGithub, siSentry, siShopify, siStripe, type SimpleIcon } from "simple-icons";

// Shared by the Transformations diagram and the Sources / Requests / Destinations empty states:
// senders across the top, a card in the middle, destinations along the bottom (viewBox 520 x 480).
export const BRANDS: { name: string; icon: SimpleIcon; color: string }[] = [
  { name: "Stripe", icon: siStripe, color: "#8b85ff" },
  { name: "Shopify", icon: siShopify, color: "#95bf47" },
  { name: "GitHub", icon: siGithub, color: "#e8e8e8" },
  { name: "Sentry", icon: siSentry, color: "#b8a4ff" },
  { name: "Clerk", icon: siClerk, color: "#a58bff" },
];
export const DESTS: { name: string; icon: LucideIcon }[] = [
  { name: "YOUR-API", icon: Globe },
  { name: "CRM", icon: UserPlus },
  { name: "CHAT", icon: MessageSquare },
  { name: "ON-CALL", icon: Bell },
];
// sender i → destination ROUTE[i]: Stripe and Shopify orders → your API, GitHub pushes → chat,
// Sentry alerts → on-call, Clerk sign-ups → CRM
export const ROUTE = [0, 0, 2, 3, 1];

export const PILL_W = 96;
export const PILL_GAP = 10;
export const srcX = (i: number) => i * (PILL_W + PILL_GAP);
export const srcC = (i: number) => srcX(i) + PILL_W / 2; // 48, 154, 260, 366, 472
export const DEST_W = 118;
export const DEST_GAP = 14;
export const destX = (j: number) => 3 + j * (DEST_W + DEST_GAP);
export const destC = (j: number) => destX(j) + DEST_W / 2;
// Vertical layout (viewBox 520 x VIEW_H): senders 22–66 → wires converge on the logo node → the card hangs
// beneath the logo → wires fan out to the destination pills.
export const VIEW_H = 500;
export const LOGO = { cx: 260, y: 112, size: 48 }; // our logo: where every request enters and gets processed
export const CARD = { x: 110, y: 172, w: 300, h: 232 };
export const DEST_Y = 444;
export const outStart = (j: number) => 140 + j * 80; // spread along the card's bottom edge
export const inPath = (i: number) =>
  srcC(i) === LOGO.cx ? `M ${LOGO.cx} 66 V ${LOGO.y}` : `M ${srcC(i)} 66 C ${srcC(i)} 92, ${LOGO.cx} 86, ${LOGO.cx} ${LOGO.y}`;
export const outPath = (j: number) =>
  `M ${outStart(j)} ${CARD.y + CARD.h} C ${outStart(j)} ${DEST_Y - 14}, ${destC(j)} ${DEST_Y - 26}, ${destC(j)} ${DEST_Y}`;

// One CSS timeline drives everything, so card content can never drift from the request it belongs to:
// request i enters the card at i*GAP + IN, its content is shown from then until the next request arrives,
// and the request leaves for its destination at i*GAP + OUT_AT.
export const GAP = 2; // seconds between requests
export const LOOP = BRANDS.length * GAP; // 10s
export const IN = 0.78; // inbound comet reaches the card
export const OUT_AT = 1.05;
export const ARRIVE = OUT_AT + 0.8;
