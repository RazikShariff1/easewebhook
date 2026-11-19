import { Link } from "react-router-dom";
import { CopyText } from "./ui";
import { RequestsIllustration } from "./EmptyIllustrations";

/** Requests page with nothing to show yet: a live request log, plus how to send the first request. */
export function RequestsEmpty({ sourceUrl }: { sourceUrl?: string }) {
  return (
    <div className="hero-empty">
      <div style={{ alignSelf: "center" }}>
        <h3>Waiting for your first request</h3>
        <p>
          Every HTTP request sent to a source URL is captured here, then routed through your connections to its destinations,
          with retries if a delivery fails.
        </p>
        {sourceUrl ? (
          <>
            <div className="rq-send mono"><span className="rq-method">POST</span><CopyText text={sourceUrl}><span className="truncate">{sourceUrl}</span></CopyText></div>
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Point your sender at this URL, or send a test request with curl.</p>
          </>
        ) : (
          <Link to="/sources" className="btn primary">Create a source</Link>
        )}
      </div>
      <RequestsIllustration />
    </div>
  );
}
