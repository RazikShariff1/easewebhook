# EaseWebhook MCP server

Lets AI agents (Claude, Cursor, VS Code Copilot, ChatGPT, any MCP client) inspect and manage your
EaseWebhook workspace by chatting: *"Why are my Razorpay webhooks failing?"*, *"Retry everything that
failed for orders-service since 9am"*, *"Connect a new Stripe source to my API with 5 retries"*.

## Connect (hosted, nothing to install)

1. In EaseWebhook, open **AI agents** and create an **API key** (`ewak_…`). It works only in that
   workspace, can't manage members or other keys, and can be revoked any time.
2. Add the server to your AI app:

| | |
|---|---|
| URL | `https://easewebhook.onrender.com/mcp` |
| Transport | MCP Streamable HTTP |
| Auth | `Authorization: Bearer <API key>` |

```bash
claude mcp add --transport http easewebhook https://easewebhook.onrender.com/mcp --header "Authorization: Bearer ewak_..."
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "easewebhook": { "url": "https://easewebhook.onrender.com/mcp", "headers": { "Authorization": "Bearer ewak_..." } } } }
```

VS Code (`.vscode/mcp.json`):

```json
{ "servers": { "easewebhook": { "type": "http", "url": "https://easewebhook.onrender.com/mcp", "headers": { "Authorization": "Bearer ewak_..." } } } }
```

Claude Desktop only starts local programs from its config, so bridge with `mcp-remote` (needs Node.js):

```json
{ "mcpServers": { "easewebhook": { "command": "npx", "args": ["-y", "mcp-remote", "https://easewebhook.onrender.com/mcp", "--header", "Authorization: Bearer ewak_..."] } } }
```

The repo's `.mcp.json` registers it for Claude Code sessions in this repo; set `EASEWEBHOOK_API_KEY`
in your shell (and `EASEWEBHOOK_MCP_URL` to point at a local backend).

## How it works

- The backend serves `/mcp` itself (`http.go`), statelessly: every request is authenticated by its
  own bearer token (an API key, or a dashboard session token).
- Each tool is one or two calls to the REST management API over loopback **with the caller's own
  token**, so an agent can never do more than the key's owner could in the dashboard.
- API keys (`internal/auth/apikeys.go`) are stored as SHA-256 hashes, are bound to one workspace,
  and are rejected for `/api-keys` and workspace-membership changes.
- Tools carry MCP annotations (read-only / write / destructive) so AI apps can ask before risky
  calls. Bulk retry and cancel refuse an empty filter. Results are capped at 60 KB per call.

## Local (stdio)

For offline work against a local backend, the same tools run over stdio:

```bash
cd backend && go build -o bin/easewebhook-mcp ./cmd/easewebhook-mcp
```

```bash
EASEWEBHOOK_API_URL=http://localhost:8000 EASEWEBHOOK_API_KEY=ewak_... ./bin/easewebhook-mcp
```

The stdio server also has `use_workspace` (switch workspace for the session), which the stateless
hosted endpoint doesn't need.

## Code

- `server.go`: server setup and the instructions sent to agents
- `http.go`: the hosted Streamable HTTP endpoint and its bearer-token check
- `client.go`: the REST API client used by tools
- `tools.go`: every tool: name, description, input schema, risk annotation and API call
- `../../cmd/easewebhook-mcp`: the stdio command
