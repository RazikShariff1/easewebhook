import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useQuery } from "../lib/hooks";
import { GoogleButton, GoogleG } from "../components/GoogleButton";
import { LogoMark } from "../components/Logo";

type Mode = "login" | "signup";

export function AuthPage({ mode }: { mode: Mode }) {
  const { user, ready, login, signup, google } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "/connections";

  const cfg = useQuery(() => api.get<{ google_client_id: string }>("/auth/config"), []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to={from} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      navigate(from, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (isLogin ? login(email, password) : signup(name, email, password)));
  };

  const isLogin = mode === "login";
  const clientId = cfg.data?.google_client_id;
  const verb = isLogin ? "Sign in" : "Sign up";
  const googleLabel = (
    <>
      <GoogleG /> <span>{verb} with <strong>Google</strong></span>
    </>
  );

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="auth-brand" aria-label="EaseWebhook home">
          <LogoMark size={30} />
          EaseWebhook
        </Link>
        <h1>{isLogin ? "Sign in to EaseWebhook" : "Create your EaseWebhook account"}</h1>
        <p className="auth-sub">{isLogin ? "Welcome back! Sign in to continue." : "Start receiving and routing webhooks in minutes."}</p>

        <div className="auth-providers">
          {clientId ? (
            <GoogleButton clientId={clientId} text={isLogin ? "signin_with" : "signup_with"} onCredential={(c) => run(() => google(c))} onError={setError}>
              <button type="button" className="auth-provider" tabIndex={-1}>{googleLabel}</button>
            </GoogleButton>
          ) : (
            <button type="button" className="auth-provider" disabled title={cfg.loading ? "Loading…" : "Google sign-in is not configured"}>
              {googleLabel}
            </button>
          )}
        </div>

        <hr className="auth-divider" />

        <form onSubmit={submit} className="auth-form">
          {!isLogin && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="pw-wrap">
              <input
                id="password"
                className="input"
                type={showPw ? "text" : "password"}
                required
                minLength={isLogin ? undefined : 8}
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}>
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {!isLogin && <span className="hint">At least 8 characters.</span>}
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? (
            <>Don't have an account? <Link to="/signup" state={loc.state}>Sign up</Link></>
          ) : (
            <>Already have an account? <Link to="/login" state={loc.state}>Sign in</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
