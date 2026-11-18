import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { useWorkspace } from "../lib/workspace";
import { Dropdown, useToast } from "./ui";

export function WorkspaceSwitcher() {
  const { workspaces, current, switchTo, create } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  return (
    <Dropdown
      trigger={(_, toggle) => (
        <button className="workspace" onClick={toggle} aria-label="Switch workspace">
          <span className="logo">{current.name.slice(0, 1).toUpperCase()}</span>
          <span className="ws-name">{current.name}</span>
          <ChevronsUpDown size={15} className="faint" />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="menu-pad faint" style={{ fontSize: 12, paddingBottom: 4 }}>Workspaces</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              className="menu-item"
              onClick={() => {
                close();
                if (w.id !== current.id) {
                  switchTo(w.id);
                  navigate("/connections");
                }
              }}
            >
              <span className="check">{w.id === current.id && <Check size={14} />}</span>
              <span className="truncate" style={{ maxWidth: 150 }}>{w.name}</span>
              <span className="faint" style={{ marginLeft: "auto", fontSize: 11 }}>{w.role}</span>
            </button>
          ))}
          <div className="menu-sep" />
          {creating ? (
            <form
              className="menu-pad"
              style={{ display: "flex", gap: 6 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                try {
                  await create(name.trim());
                  toast(`Workspace "${name.trim()}" created`);
                  setName("");
                  setCreating(false);
                  close();
                  navigate("/connections");
                } catch (err) {
                  toast((err as Error).message, "error");
                }
              }}
            >
              <input className="input" style={{ flex: 1 }} placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button className="btn primary sm" type="submit" disabled={!name.trim()}>Create</button>
            </form>
          ) : (
            <button className="menu-item" onClick={() => setCreating(true)}>
              <Plus size={14} /> New workspace
            </button>
          )}
          <button className="menu-item" onClick={() => (close(), navigate("/settings"))}>
            <Settings size={14} /> Workspace settings
          </button>
        </div>
      )}
    </Dropdown>
  );
}
