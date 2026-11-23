import { useEffect, useState } from "react";
import { ArrowUp, Check, ChevronDown, ChevronRight, Plus, ShieldQuestion } from "lucide-react";
import { WindowDots } from "./WindowDots";

/**
 * An animated replay of a real AI-agent session using the EaseWebhook MCP server:
 * question → tool calls → answer → approval request. Used on the landing page and
 * on the AI agents page; each page themes it through its own CSS (.agent-chat).
 */

const QUESTION = "My Razorpay webhooks aren't reaching my orders service. What's wrong?";

const CALLS: { tool: string; label: string; args?: string; result: string }[] = [
  { tool: "get_overview", label: "Get account overview", result: "2 requests · 2 events FAILED" },
  { tool: "list_connections", label: "Find the Razorpay connection", result: "razorpay-prod → orders-service · active" },
  { tool: "list_events", label: "List failed events", args: 'status: "FAILED"', result: "2 events" },
  { tool: "get_event", label: "Inspect a failed event", args: '"evt_Rn5Y…"', result: "2 attempts · HTTP 401" },
];

const ANSWER =
  "Your webhooks reach EaseWebhook fine; delivery to orders-service is failing. Both events got 401 “missing session”: the webhook route sits behind your login. Exempt it, or add a bearer token to the destination.";

// Timeline (in ticks of 700 ms): question, each call, the answer, the approval, then a pause before looping.
const T_CALLS = 2;
const T_ANSWER = T_CALLS + CALLS.length + 1;
const T_ASK = T_ANSWER + 3;
const T_END = T_ASK + 7;

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function AgentChat({ compact = false, composer = false, onTool }: { compact?: boolean; composer?: boolean; onTool?: (tool: string | null, used: string[]) => void }) {
  const [tick, setTick] = useState(() => (reducedMotion() ? T_END : 0));

  useEffect(() => {
    if (reducedMotion()) return;
    const id = setInterval(() => setTick((t) => (t >= T_END ? 0 : t + 1)), 700);
    return () => clearInterval(id);
  }, []);

  const shownCalls = Math.max(0, Math.min(CALLS.length, tick - T_CALLS + 1));

  // Tell the host page which tool the agent is running now, and which it has already used (for highlighting).
  const current = tick >= T_ASK ? "retry_event" : tick >= T_CALLS + CALLS.length ? null : shownCalls > 0 ? CALLS[shownCalls - 1].tool : null;
  const doneCount = tick < T_CALLS ? 0 : tick >= T_CALLS + CALLS.length ? CALLS.length : shownCalls - 1;
  const usedKey = CALLS.slice(0, doneCount).map((c) => c.tool).join(",");
  useEffect(() => {
    onTool?.(current, usedKey ? usedKey.split(",") : []);
  }, [current, usedKey, onTool]);

  const working = tick >= T_CALLS && tick < T_CALLS + CALLS.length;
  const running = working ? CALLS[Math.max(0, shownCalls - 1)] : null;
  const elapsed = Math.max(1, Math.round((tick - T_CALLS + 1) * 0.7 * 3));

  return (
    <div className={`agent-chat dk ${compact ? "compact" : ""}`} aria-label="Example: an AI agent debugging failed webhooks with the EaseWebhook MCP server">
      <div className="dk-main">
        <div className="dk-top">
          <WindowDots />
          <span>Debug Razorpay webhooks</span>
          <ChevronDown size={13} />
          <em className="dk-mcp"><i />easewebhook MCP</em>
        </div>

        <div className="dk-body">
          <div className="dk-msg user">{QUESTION}</div>

          {tick >= T_CALLS && (
            <div className="dk-plan">
              <div className="dk-plan-h">Plan</div>
              {CALLS.map((c, i) => {
                const state = i < doneCount ? "done" : i === shownCalls - 1 && working ? "run" : "todo";
                return (
                  <div key={c.tool} className={`dk-task ${state}`}>
                    <span className="dk-tick">
                      {state === "done" ? <Check size={11} strokeWidth={3} /> : state === "run" ? <><i /><i /><i /></> : null}
                    </span>
                    <span className="dk-task-l">{c.label}</span>
                    {state === "done" && <em>{c.result}</em>}
                  </div>
                );
              })}
            </div>
          )}

          {running && (
            <div className="dk-working">
              <span className="dk-dots" aria-hidden="true"><i /><i /><i /><i /></span>
              <span>Calling <code>{running.tool}</code></span>
              <small>{elapsed}s</small>
              <ChevronRight size={13} />
            </div>
          )}

          {tick >= T_ANSWER && <div className="dk-msg agent">{ANSWER}</div>}

          {tick >= T_ASK && (
            <div className="dk-approve">
              <div className="dk-approve-q">
                <ShieldQuestion size={15} />
                <span>Allow <code>retry_event</code>? It re-sends the 2 failed webhooks to your server.</span>
              </div>
              <div className="dk-approve-a"><b className="deny">Deny</b><b>Allow</b></div>
            </div>
          )}
        </div>

        {composer && (
          <div className="dk-composer" aria-hidden="true">
            <Plus size={15} />
            <span>Ask about your webhooks…</span>
            <i><ArrowUp size={13} strokeWidth={2.5} /></i>
          </div>
        )}
      </div>
    </div>
  );
}
