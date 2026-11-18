import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, ShieldCheck } from "lucide-react";
import { useFloating } from "../lib/floating";
import type { SourceType } from "../lib/sourceTypes";
import { SourceIcon } from "./SourceIcon";

/** Searchable source-type list: generic types first, then providers (like Hookdeck's picker). */
export function SourceTypePicker({
  types,
  value,
  onChange,
  disabled,
}: {
  types: SourceType[];
  value: string;
  onChange: (t: SourceType) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { anchor, floating, style } = useFloating<HTMLButtonElement>(open, { matchWidth: true });
  const cur = types.find((t) => t.id === value);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? types.filter((t) => `${t.name} ${t.description ?? ""} ${t.id}`.toLowerCase().includes(s)) : types;
  }, [types, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => setActive(0), [q, open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (t: SourceType) => {
    onChange(t);
    setOpen(false);
    setQ("");
  };

  const firstProvider = filtered.findIndex((t) => t.category === "provider");

  return (
    <div className="stp" ref={ref}>
      <button ref={anchor} type="button" className="stp-trigger" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        {cur ? (
          <>
            <SourceIcon icon={cur.icon} name={cur.name} size={18} />
            <span className="stp-name">{cur.name}</span>
            {cur.description && <span className="stp-desc">({cur.description})</span>}
          </>
        ) : (
          <span className="faint">Select a source type…</span>
        )}
        {!disabled && <ChevronDown size={15} className="faint" style={{ marginLeft: "auto" }} />}
      </button>

      {open && (
        <div className="stp-menu floating" ref={floating} style={style}>
          <div className="stp-search">
            <Search size={14} />
            <input
              autoFocus
              placeholder="Search source types…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, filtered.length - 1)));
                if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
                if (e.key === "Enter" && filtered[active]) (e.preventDefault(), pick(filtered[active]));
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="stp-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && <div className="stp-empty">No source types match "{q}". Use Webhook for any other sender.</div>}
            {filtered.map((t, i) => (
              <div key={t.id}>
                {i === firstProvider && firstProvider > 0 && <div className="stp-sep">Providers · signature verified</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={t.id === value}
                  data-i={i}
                  className={`stp-item ${i === active ? "active" : ""} ${t.id === value ? "selected" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(t)}
                >
                  <SourceIcon icon={t.icon} name={t.name} size={18} />
                  <span className="stp-name">{t.name}</span>
                  {t.description && <span className="stp-desc">({t.description})</span>}
                  {t.verifies_signatures && t.category === "provider" && (
                    <ShieldCheck size={14} className="faint" style={{ marginLeft: "auto" }} aria-label="Signature verified" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
