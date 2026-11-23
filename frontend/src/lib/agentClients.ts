import { Code2, Plug, SquareTerminal, type LucideIcon } from "lucide-react";
import { siClaude, siCline, siCursor, siGithubcopilot, siGooglegemini, siWindsurf, type SimpleIcon } from "simple-icons";

/** An AI app that can use the EaseWebhook MCP server, and how to point it at the server. */
export interface AgentClient {
  id: string;
  name: string;
  icon: SimpleIcon | LucideIcon;
  /** where the snippet goes: a config file path, or "Terminal" */
  file: string;
  /** one line on what to do with the snippet */
  hint: string;
  snippet: (url: string, key: string) => string;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const bridge = (url: string, key: string) => ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${key}`];

// Claude clients first, then the rest roughly by how widely each is used. The first is the default.
export const AGENT_CLIENTS: AgentClient[] = [
  {
    id: "claude-code", name: "Claude Code", icon: Code2, file: "Terminal",
    hint: "Run in a terminal.",
    snippet: (url, key) => `claude mcp add --transport http easewebhook ${url} \\\n  --header "Authorization: Bearer ${key}"`,
  },
  {
    id: "claude-desktop", name: "Claude Desktop", icon: siClaude, file: "claude_desktop_config.json",
    hint: "Settings → Developer → Edit config. Uses the mcp-remote bridge (needs Node.js); restart Claude Desktop after saving.",
    snippet: (url, key) => json({ mcpServers: { easewebhook: { command: "npx", args: bridge(url, key) } } }),
  },
  {
    id: "cursor", name: "Cursor", icon: siCursor, file: "~/.cursor/mcp.json",
    hint: "Add to ~/.cursor/mcp.json.",
    snippet: (url, key) => json({ mcpServers: { easewebhook: { url, headers: { Authorization: `Bearer ${key}` } } } }),
  },
  {
    id: "vscode", name: "VS Code", icon: siGithubcopilot, file: ".vscode/mcp.json",
    hint: "Add to .vscode/mcp.json, then use it from Copilot Chat in agent mode.",
    snippet: (url, key) => json({ servers: { easewebhook: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } }),
  },
  {
    id: "codex", name: "Codex CLI", icon: SquareTerminal, file: "~/.codex/config.toml",
    hint: "Add to ~/.codex/config.toml. Uses the mcp-remote bridge (needs Node.js).",
    snippet: (url, key) => `[mcp_servers.easewebhook]\ncommand = "npx"\nargs = ${JSON.stringify(bridge(url, key)).replace(/","/g, '", "')}`,
  },
  {
    id: "windsurf", name: "Windsurf", icon: siWindsurf, file: "~/.codeium/windsurf/mcp_config.json",
    hint: "Add to ~/.codeium/windsurf/mcp_config.json, then refresh Cascade's MCP servers.",
    snippet: (url, key) => json({ mcpServers: { easewebhook: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } }),
  },
  {
    id: "gemini", name: "Gemini CLI", icon: siGooglegemini, file: "~/.gemini/settings.json",
    hint: "Add to ~/.gemini/settings.json.",
    snippet: (url, key) => json({ mcpServers: { easewebhook: { httpUrl: url, headers: { Authorization: `Bearer ${key}` } } } }),
  },
  {
    id: "cline", name: "Cline", icon: siCline, file: "cline_mcp_settings.json",
    hint: "Cline → MCP Servers → Configure → add to cline_mcp_settings.json.",
    snippet: (url, key) => json({ mcpServers: { easewebhook: { type: "streamableHttp", url, headers: { Authorization: `Bearer ${key}` } } } }),
  },
  {
    id: "other", name: "Any MCP client", icon: Plug, file: "Streamable HTTP",
    hint: "Any client that supports MCP over Streamable HTTP.",
    snippet: (url, key) =>
      `URL     ${url}\nHeader  Authorization: Bearer ${key}\n\n# Clients without remote MCP support can bridge with:\nnpx -y mcp-remote ${url} \\\n  --header "Authorization: Bearer ${key}"`,
  },
];

export const clientById = (id: string) => AGENT_CLIENTS.find((c) => c.id === id) ?? AGENT_CLIENTS[0];
