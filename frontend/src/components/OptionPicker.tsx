import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { useFloating } from "../lib/floating";

export interface PickerOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  tag?: string;
  disabled?: boolean;
}

/** Select-style picker with icons, descriptions and search (same look as the source type picker). */
export function OptionPicker({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchable,
  ariaLabel,
}: {
  options: PickerOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  searchable?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { anchor, floating, style } = useFloating<HTMLButtonElement>(open, { matchWidth: true });
  const cur = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => `${o.label} ${o.description ?? ""}`.toLowerCase().includes(s)) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="stp" ref={ref}>
      <button ref={anchor} type="button" className="stp-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
        {cur ? (
          <>
            {cur.icon}
            <span className="stp-name">{cur.label}</span>
          </>
        ) : (
          <span className="faint">{placeholder}</span>
        )}
        <ChevronsUpDown size={15} className="faint" style={{ marginLeft: "auto" }} />
      </button>
      {open && (
        <div className="stp-menu floating" ref={floating} style={style}>
          {searchable && (
            <div className="stp-search">
              <Search size={14} />
              <input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="stp-list" role="listbox">
            {shown.length === 0 && <div className="stp-empty">Nothing matches.</div>}
            {shown.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                disabled={o.disabled}
                className={`stp-item ${o.value === value ? "selected" : ""}`}
                onClick={() => (onChange(o.value), setOpen(false), setQ(""))}
              >
                {o.icon}
                <span className="stp-name">{o.label}</span>
                {o.description && <span className="stp-desc">({o.description})</span>}
                {o.tag && <span className="ob-tag" style={{ marginLeft: "auto" }}>{o.tag}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
