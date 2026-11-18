import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, ApiError, setAuthToken, setWorkspaceId, onUnauthorized } from "./api";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
}

interface Session {
  token: string;
  expires_at: string;
  user: User;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  google: (credential: string) => Promise<void>;
  logout: () => void;
}

const TOKEN_KEY = "ew_token";
const Ctx = createContext<AuthState | null>(null);

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts for this tab only */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    writeToken(null);
    setAuthToken(null);
    setWorkspaceId(null);
    setUser(null);
  }, []);

  const start = useCallback((s: Session) => {
    writeToken(s.token);
    setAuthToken(s.token);
    setUser(s.user);
  }, []);

  // Restore a saved session on load. Only a 401 ends it; if the server is unreachable (restart, deploy,
  // network blip) keep the token and retry, so users aren't signed out by an outage.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const t = readToken();
    if (!t) {
      setReady(true);
      return;
    }
    setAuthToken(t);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () =>
      api
        .get<User>("/auth/me")
        .then((u) => {
          if (cancelled) return;
          setUser(u);
          setOffline(false);
          setReady(true);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 401) {
            logout();
            setReady(true);
            return;
          }
          setOffline(true);
          timer = setTimeout(attempt, 2000);
        });
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [logout]);

  // Any 401 from the API ends the session.
  useEffect(() => onUnauthorized(logout), [logout]);

  if (!ready && offline) {
    return <div className="spinner">Can't reach the EaseWebhook server. Retrying…</div>;
  }

  const value: AuthState = {
    user,
    ready,
    logout,
    login: async (email, password) => start(await api.post<Session>("/auth/login", { email, password })),
    signup: async (name, email, password) => start(await api.post<Session>("/auth/signup", { name, email, password })),
    google: async (credential) => start(await api.post<Session>("/auth/google", { credential })),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="spinner">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}
