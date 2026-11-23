import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import type { SimpleIcon } from "simple-icons";
import { AGENT_CLIENTS, clientById } from "../lib/agentClients";

export function ClientIcon({ icon }: { icon: SimpleIcon | LucideIcon }) {
  if ("path" in icon) {
    // near-black brand colours would vanish on dark backgrounds, so those use the text colour
    const n = parseInt(icon.hex, 16);
    const dark = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 60;
    return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d={icon.path} fill={dark ? "currentColor" : `#${icon.hex}`} /></svg>;
  }
  const I = icon;
  return <I size={14} />;
}

/** Dropdown for choosing which AI client's setup snippet to show. */
export function AgentClientPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = clientById(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="ag-pick" ref={ref}>
      <button type="button" className="ag-pick-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ClientIcon icon={current.icon} />
        {current.name}
        <ChevronDown size={13} className={open ? "up" : ""} />
      </button>
      {open && (
        <div className="ag-pick-menu" role="listbox" aria-label="AI clients">
          {AGENT_CLIENTS.map((c) => (
            <button type="button" key={c.id} role="option" aria-selected={c.id === value} className={c.id === value ? "on" : ""} onClick={() => { onChange(c.id); setOpen(false); }}>
              <ClientIcon icon={c.icon} />
              <span>{c.name}</span>
              {c.id === value && <Check size={13} strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
