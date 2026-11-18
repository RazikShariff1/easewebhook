import { FlaskConical, Globe, SquareTerminal } from "lucide-react";

export const DEST_TYPES = [
  { value: "HTTP", label: "HTTP", description: "Send events to any public HTTP endpoint" },
  { value: "MOCK_API", label: "Mock API", description: "Inspect deliveries without a server", tag: "Testing" },
  { value: "CLI", label: "CLI", description: "Forward events to your local machine", tag: "Coming soon", disabled: true },
] as const;

export function DestinationIcon({ type, size = 16 }: { type?: string; size?: number }) {
  if (type === "MOCK_API") return <FlaskConical size={size} />;
  if (type === "CLI") return <SquareTerminal size={size} />;
  return <Globe size={size} />;
}
