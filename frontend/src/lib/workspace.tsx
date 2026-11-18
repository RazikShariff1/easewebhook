import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, setWorkspaceId } from "./api";
import { useAuth } from "./auth";

export interface Workspace {
  id: string;
  name: string;
  role: "owner" | "member";
  member_count: number;
  created_at: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  current: Workspace;
  switchTo: (id: string) => void;
  reload: () => Promise<Workspace[]>;
  create: (name: string) => Promise<Workspace>;
}

const KEY = "ew_workspace";
const Ctx = createContext<WorkspaceState | null>(null);

function saved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function save(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable */
  }
}

// WorkspaceProvider loads the user's workspaces and picks the current one (last used, else the first).
// Children only render once a workspace is selected, so every API call carries X-Workspace-Id.
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  // Tracks the selection outside React state so reload() can read it synchronously.
  const currentRef = useRef<string | null>(null);

  const select = useCallback((id: string | null) => {
    currentRef.current = id;
    setWorkspaceId(id);
    if (id) save(id);
    setCurrentId(id);
  }, []);

  const reload = useCallback(async () => {
    const list = await api.get<Workspace[]>("/workspaces");
    setWorkspaces(list);
    const want = currentRef.current ?? saved();
    select((list.find((w) => w.id === want) ?? list[0])?.id ?? null);
    return list;
  }, [select]);

  useEffect(() => {
    if (!user) return;
    currentRef.current = null;
    setCurrentId(null);
    reload().catch((e: Error) => setError(e.message));
  }, [user, reload]);

  const create = useCallback(
    async (name: string) => {
      const w = await api.post<Workspace>("/workspaces", { name });
      await reload();
      select(w.id);
      return w;
    },
    [reload, select],
  );

  const current = workspaces.find((w) => w.id === currentId);
  if (error) return <div className="error-box">{error}</div>;
  if (!current) return <div className="spinner">Loading workspace…</div>;

  return <Ctx.Provider value={{ workspaces, current, switchTo: select, reload, create }}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside WorkspaceProvider");
  return v;
}
