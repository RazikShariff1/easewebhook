import { AlertTriangle, CheckCircle2, FileInput, Loader2, Send, Shuffle } from "lucide-react";
import type { TransformRun } from "../lib/api";

type Req = { method?: string; path?: string; query?: string; headers?: Record<string, string>; body?: unknown };
export type Change = { kind: "added" | "changed" | "removed"; path: string; from?: unknown; to?: unknown };

// Flatten a request to "headers.x-a" / "body.order.id" / "body.items[0]" leaves so two requests can be compared.
function leaves(r: Req | null | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v) && v.length) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object" && Object.keys(v).length) Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k));
    else out.set(path, v);
  };
  if (!r) return out;
  for (const k of ["method", "path", "query"] as const) if (r[k] !== undefined && r[k] !== "") out.set(k, r[k]);
  walk(r.headers ?? {}, "headers");
  if (r.body !== undefined) walk(r.body, "body");
  return out;
}

/** What the transformation changed: leaves added, changed or removed between the input and the output request. */
export function diffRequests(input: Req | undefined, output: Req | null | undefined): Change[] {
  const a = leaves(input);
  const b = leaves(output);
  const changes: Change[] = [];
  for (const [path, to] of b) {
    if (!a.has(path)) changes.push({ kind: "added", path, to });
    else if (JSON.stringify(a.get(path)) !== JSON.stringify(to)) changes.push({ kind: "changed", path, from: a.get(path), to });
  }
  for (const [path, from] of a) if (!b.has(path)) changes.push({ kind: "removed", path, from });
  return changes;
}

const short = (v: unknown) => {
  const s = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
  return s && s.length > 40 ? s.slice(0, 39) + "…" : s;
};

const SIGN = { added: "+", changed: "~", removed: "−" } as const;

/** One line per change: sign, path, value. Clicking a field that exists in the output jumps to its line. */
export function ChangeList({ changes, lineOf, onJump }: { changes: Change[]; lineOf?: Map<string, number>; onJump?: (line: number) => void }) {
  if (changes.length === 0) {
    return (
      <div className="trf-nochange">
        No changes — the output is identical to the input. If you expected some, the Input may not match what your code
        expects (it may return early for this payload). Paste a matching request into Input, or use “Load a recent request…”.
      </div>
    );
  }
  return (
    <ul className="trf-changes">
      {changes.map((c) => {
        const line = c.kind === "removed" ? undefined : lineOf?.get(c.path);
        const jump = line && onJump ? () => onJump(line) : undefined;
        return (
          <li key={c.kind + c.path} className={`${c.kind} ${jump ? "jump" : ""}`} onClick={jump}>
            <span className="sign">{SIGN[c.kind]}</span>
            <span className="path">{c.path}</span>
            <span className="val">
              {c.kind === "added" && short(c.to)}
              {c.kind === "removed" && short(c.from)}
              {c.kind === "changed" && <>{short(c.from)} → {short(c.to)}</>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

type Phase = "idle" | "running" | "ok" | "error";

/**
 * The run as a pipeline: Input request → transformation → Output request. The wires animate while the run is
 * in flight, then the nodes settle into their outcome with timing and a summary of what changed.
 */
export function TransformRunFlow({
  input,
  name,
  running,
  result,
  ms,
  changes,
}: {
  input?: Req;
  name: string;
  running: boolean;
  result?: TransformRun;
  ms?: number;
  changes: Change[];
}) {
  const phase: Phase = running ? "running" : !result ? "idle" : result.error ? "error" : "ok";
  const bodyKeys = input?.body && typeof input.body === "object" ? Object.keys(input.body).length : 0;
  const counts = {
    added: changes.filter((c) => c.kind === "added").length,
    changed: changes.filter((c) => c.kind === "changed").length,
    removed: changes.filter((c) => c.kind === "removed").length,
  };

  return (
    <div className={`trf trf-${phase}`}>
      <div className="trf-node">
        <span className="trf-ico"><FileInput size={16} /></span>
        <div className="trf-txt">
          <b>Input request</b>
          <small className="truncate">{input ? `${input.method ?? "POST"} · ${Object.keys(input.headers ?? {}).length} headers · ${bodyKeys} body fields` : "Invalid JSON"}</small>
        </div>
      </div>

      <span className="trf-wire" aria-hidden><i /></span>

      <div className="trf-node mid">
        <span className="trf-ico">
          {phase === "running" ? <Loader2 size={16} className="spin" /> : phase === "ok" ? <CheckCircle2 size={16} /> : phase === "error" ? <AlertTriangle size={16} /> : <Shuffle size={16} />}
        </span>
        <div className="trf-txt">
          <b className="truncate">{name.trim() || "Transformation"}</b>
          <small>
            {phase === "idle" && "Ready — ⌘↵ to run"}
            {phase === "running" && "Running…"}
            {phase === "ok" && `Done${ms != null ? ` in ${ms} ms` : ""}`}
            {phase === "error" && "Failed"}
          </small>
        </div>
      </div>

      <span className="trf-wire" aria-hidden><i style={{ animationDelay: ".35s" }} /></span>

      <div className="trf-node">
        <span className="trf-ico"><Send size={16} /></span>
        <div className="trf-txt">
          <b>Output request</b>
          <small>
            {phase === "ok" ? (
              changes.length === 0 ? "No changes" : (
                <>
                  {counts.added > 0 && <span className="a">+{counts.added}</span>}
                  {counts.changed > 0 && <span className="c">~{counts.changed}</span>}
                  {counts.removed > 0 && <span className="r">−{counts.removed}</span>}
                </>
              )
            ) : phase === "error" ? "Not produced" : "Waiting for a run"}
          </small>
        </div>
      </div>
    </div>
  );
}

/**
 * Pretty-print a request (2-space JSON) and report which line each leaf path lives on, using the same path
 * convention as `diffRequests`, so changed leaves can be highlighted in the printed output.
 */
export function prettyWithLines(value: unknown): { text: string; lineOf: Map<string, number> } {
  const out: string[] = [];
  const lineOf = new Map<string, number>();
  const write = (v: unknown, path: string, depth: number, prefix: string, comma: string) => {
    const pad = "  ".repeat(depth);
    if (Array.isArray(v) && v.length) {
      out.push(`${pad}${prefix}[`);
      v.forEach((x, i) => write(x, `${path}[${i}]`, depth + 1, "", i < v.length - 1 ? "," : ""));
      out.push(`${pad}]${comma}`);
    } else if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) {
      const keys = Object.keys(v);
      out.push(`${pad}${prefix}{`);
      keys.forEach((k, i) => write((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k, depth + 1, `${JSON.stringify(k)}: `, i < keys.length - 1 ? "," : ""));
      out.push(`${pad}}${comma}`);
    } else {
      lineOf.set(path, out.length + 1);
      out.push(`${pad}${prefix}${JSON.stringify(v)}${comma}`);
    }
  };
  write(value, "", 0, "", "");
  return { text: out.join("\n"), lineOf };
}
