import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, X } from "lucide-react";
import type { EventStatus } from "../lib/api";

// ---------- Dropdown ----------

export function Dropdown({
  trigger,
  children,
  align = "left",
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className={`menu ${align === "right" ? "right" : ""}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  icon,
  prefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  icon?: ReactNode;
  prefix?: string;
}) {
  const cur = options.find((o) => o.value === value);
  return (
    <Dropdown
      align="right"
      trigger={(_, toggle) => (
        <button className="btn" onClick={toggle}>
          {icon}
          {prefix && <span className="muted">{prefix}</span>}
          {cur?.label}
          <ChevronDown />
        </button>
      )}
    >
      {(close) =>
        options.map((o) => (
          <button
            key={o.value}
            className="menu-item"
            onClick={() => {
              onChange(o.value);
              close();
            }}
          >
            <span className="check">{o.value === value && <Check size={14} />}</span>
            {o.label}
          </button>
        ))
      }
    </Dropdown>
  );
}

// ---------- Badges ----------

const statusTone: Record<EventStatus, string> = {
  SUCCESSFUL: "success",
  FAILED: "danger",
  QUEUED: "info",
  SCHEDULED: "info",
  HOLD: "warn",
  CANCELLED: "neutral",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const label = status === "SUCCESSFUL" ? "Successful" : status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`badge ${statusTone[status] ?? "neutral"}`}>{label}</span>;
}

export function HttpBadge({ code, error }: { code: number | null; error?: string | null }) {
  if (code == null) return error ? <span className="badge danger">{error}</span> : <span className="faint">—</span>;
  const tone = code < 300 ? "success" : code < 500 ? "warn" : "danger";
  return <span className={`badge ${tone} mono`}>{code}</span>;
}

export function Badge({ tone, children }: { tone: "success" | "danger" | "warn" | "info" | "neutral"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

// ---------- Copy ----------

export function CopyText({ text, children }: { text: string; children?: ReactNode }) {
  const toast = useToast();
  return (
    <span
      className="copy"
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard"));
      }}
    >
      {children ?? text}
      <Copy />
    </span>
  );
}

// ---------- States ----------

export function ErrorBox({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return <div className="error-box">{error.message}</div>;
}

export function Loading() {
  return <div className="spinner">Loading…</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// ---------- Drawer (forms) ----------

export function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="panel-head">
          <strong style={{ fontWeight: 500 }}>{title}</strong>
          <span style={{ flex: 1 }} />
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">{footer}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

// ---------- Toasts ----------

type ToastFn = (msg: string, kind?: "info" | "error") => void;
const ToastCtx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback<ToastFn>((msg, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// Runs an async action, toasting the error if it fails.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (e) {
        toast((e as Error).message, "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

export function NoData() {
  return <span className="nodata">NO DATA</span>;
}

/** On/off switch (a styled checkbox, so it stays keyboard and screen-reader friendly). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      {label}
    </label>
  );
}
