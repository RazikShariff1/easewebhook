import { Save } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved";

/** Save button icon with feedback: a floppy disk at rest, a spinning ring while saving, a drawn checkmark once saved. */
export function SaveIcon({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="save-ico spin" aria-hidden><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" /></svg></span>;
  if (state === "saved") return <span className="save-ico" aria-hidden><svg viewBox="0 0 20 20"><path className="tick" d="M4.5 10.5l3.5 3.5 7.5-8" /></svg></span>;
  return <Save aria-hidden />;
}
