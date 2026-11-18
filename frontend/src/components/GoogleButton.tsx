import { useEffect, useRef, type ReactNode } from "react";

// Google Identity Services, same approach as oc-a-fe/admine-fe: Google renders the real button and hands back an
// ID token, which the backend verifies against GOOGLE_CLIENT_ID (served by /auth/config).
//
// To match our own button styling, Google's button is laid over `children` and made almost transparent:
// the click still lands on Google's iframe (custom-drawn buttons can't open the sign-in popup reliably).

interface GsiId {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

let gsiLoading: Promise<void> | undefined;
function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gsiLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiLoading = undefined;
      reject(new Error("Google script failed to load"));
    };
    document.head.appendChild(script);
  });
  return gsiLoading;
}

export function GoogleButton({
  clientId,
  text = "continue_with",
  onCredential,
  onError,
  children,
}: {
  clientId: string;
  text?: "continue_with" | "signup_with" | "signin_with";
  onCredential: (idToken: string) => void;
  onError?: (msg: string) => void;
  children: ReactNode; // the visible button
}) {
  const holder = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onCredential, onError });
  useEffect(() => {
    handlers.current = { onCredential, onError };
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        const id = window.google?.accounts?.id;
        if (cancelled || !holder.current || !id) return;
        id.initialize({ client_id: clientId, callback: (r) => handlers.current.onCredential(r.credential) });
        id.renderButton(holder.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          width: Math.min(400, Math.round(holder.current.clientWidth)),
        });
      })
      .catch(() => handlers.current.onError?.("Couldn't load Google sign-in. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  return (
    <div className="gsi-wrap">
      {children}
      <div ref={holder} className="gsi-overlay" />
    </div>
  );
}

export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
