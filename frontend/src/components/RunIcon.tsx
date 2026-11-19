/** Run button icon: a plain rounded play glyph; while running it becomes a simple spinning ring. */
export function RunIcon({ running }: { running?: boolean }) {
  return (
    <span className={`run-ico ${running ? "running" : ""}`} aria-hidden>
      {running ? (
        <svg viewBox="0 0 20 20"><circle className="ring" cx="10" cy="10" r="6.5" /></svg>
      ) : (
        <svg viewBox="0 0 20 20"><path d="M6.8 4.9v10.2a.8.8 0 0 0 1.2.7l8.2-5.1a.8.8 0 0 0 0-1.4L8 4.2a.8.8 0 0 0-1.2.7z" /></svg>
      )}
    </span>
  );
}
