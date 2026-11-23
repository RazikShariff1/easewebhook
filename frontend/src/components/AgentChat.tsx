import { useEffect, useState } from "react";
import { Check, ShieldQuestion, Sparkles } from "lucide-react";

/**
 * An animated replay of a real AI-agent session using the EaseWebhook MCP server:
 * question → tool calls → answer → approval request. Used on the landing page and
 * on the AI agents page; each page themes it through its own CSS (.agent-chat).
 */

const QUESTION = "My Razorpay webhooks aren't reaching my orders service. What's wrong?";

const CALLS: { tool: string; args?: string; result: string }[] = [
  { tool: "get_overview", result: "2 requests · 2 events FAILED" },
  { tool: "list_connections", result: "razorpay-prod → orders-service · active" },
  { tool: "list_events", args: 'status: "FAILED"', result: "2 events" },
  { tool: "get_event", args: '"evt_Rn5Y…"', result: "2 attempts · HTTP 401" },
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

export function AgentChat({ compact = false }: { compact?: boolean }) {
  const [tick, setTick] = useState(() => (reducedMotion() ? T_END : 0));

  useEffect(() => {
    if (reducedMotion()) return;
    const id = setInterval(() => setTick((t) => (t >= T_END ? 0 : t + 1)), 700);
    return () => clearInterval(id);
  }, []);

  const shownCalls = Math.max(0, Math.min(CALLS.length, tick - T_CALLS + 1));

  return (
    <div className={`agent-chat ${compact ? "compact" : ""}`} aria-label="Example: an AI agent debugging failed webhooks with the EaseWebhook MCP server">
      <div className="ac-bar">
        <i /><i /><i />
        <span>Claude · easewebhook MCP</span>
      </div>
      <div className="ac-body">
        <div className="ac-msg user">{QUESTION}</div>

        {tick >= T_CALLS && (
          <div className="ac-calls">
            {CALLS.slice(0, shownCalls).map((c, i) => {
              const done = i < shownCalls - 1 || tick >= T_CALLS + CALLS.length;
              return (
                <div key={c.tool} className={`ac-call ${done ? "done" : "running"}`}>
                  <span className="ac-state">{done ? <Check size={11} strokeWidth={3} /> : <span className="ac-spin" />}</span>
                  <code>{c.tool}</code>
                  {c.args && <span className="ac-args">{c.args}</span>}
                  {done && <span className="ac-result">{c.result}</span>}
                </div>
              );
            })}
          </div>
        )}

        {tick >= T_ANSWER && (
          <div className="ac-msg agent">
            <Sparkles size={14} />
            <span>{ANSWER}</span>
          </div>
        )}

        {tick >= T_ASK && (
          <div className="ac-approve">
            <ShieldQuestion size={15} />
            <span>
              Retry the 2 failed events? <code>retry_event</code> re-sends webhooks to your server.
            </span>
            <b>Allow</b>
          </div>
        )}
      </div>
    </div>
  );
}
