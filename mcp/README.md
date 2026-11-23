# EaseWebhook MCP server

Lets AI agents (Claude, Cursor, ChatGPT, any MCP client) inspect and manage your EaseWebhook
workspace by chatting: *"Why are my Razorpay webhooks failing?"*, *"Retry everything that failed
for orders-service since 9am"*, *"Connect a new Stripe source to my API with 5 retries"*.

It is a thin layer over the EaseWebhook REST API: every tool is one or two API calls, made with your
login token, in your workspace.

## How it runs

This is a **local (stdio)** MCP server. You don't start it yourself: your AI app starts it when a
session begins, talks to it over stdin/stdout, and stops it when the session ends.

## 1. Get your token

Log in at https://easewebhook.vercel.app, open the browser console and run:

```js
localStorage.getItem("ew_token")
```

Or from a terminal:

```bash
curl -s -X POST https://easewebhook.onrender.com/auth/login -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"..."}' | jq -r .data.token
```

Tokens last 7 days. Keep the token out of git: put it in your shell profile, not in a config file
that's committed.

```bash
export EASEWEBHOOK_TOKEN="<your token>"
```

## 2. Connect your AI app

| Setting | Default | |
|---|---|---|
| `EASEWEBHOOK_TOKEN` | (required) | your login token |
| `EASEWEBHOOK_API_URL` | `https://easewebhook.onrender.com` | use `http://localhost:8000` for a local backend |
| `EASEWEBHOOK_WORKSPACE_ID` | your first workspace | `ws_...`; agents can also switch with `use_workspace` |

**Claude Code, in this repo:** nothing to do. The repo's `.mcp.json` registers the server and reads
the variables above from your shell. Start a session in the repo and approve `easewebhook` once.

**Claude Code, anywhere else:** build the binary, then add it:

```bash
cd mcp && go build -o bin/easewebhook-mcp .
```

```bash
claude mcp add easewebhook -e EASEWEBHOOK_TOKEN=$EASEWEBHOOK_TOKEN -- /absolute/path/to/mcp/bin/easewebhook-mcp
```

**Claude Desktop / Cursor:** add this to their MCP config file:

```json
{
  "mcpServers": {
    "easewebhook": {
      "command": "/absolute/path/to/mcp/bin/easewebhook-mcp",
      "env": { "EASEWEBHOOK_TOKEN": "<your token>" }
    }
  }
}
```

## Tools (38)

Each tool is marked read-only, write or destructive (MCP tool annotations), so AI apps can ask
before risky calls.

| Area | Read-only | Write | Destructive |
|---|---|---|---|
| Workspace | `list_workspaces`, `get_overview` | `use_workspace` | |
| Sources | `list_sources`, `get_source`, `list_source_types` | `create_source`, `update_source`, `set_source_enabled` | `delete_source` |
| Destinations | `list_destinations`, `get_destination` | `create_destination`, `update_destination`, `set_destination_enabled` | `delete_destination` |
| Connections | `list_connections`, `get_connection` | `create_connection`, `update_connection`, `set_connection_state` | `delete_connection` |
| Transformations | `list_transformations`, `get_transformation`, `test_transformation` | `create_transformation`, `update_transformation` | `delete_transformation` |
| Requests | `list_requests`, `get_request` | `retry_request` | |
| Events | `list_events`, `get_event`, `get_attempt` | `retry_event`, `bulk_retry_events` | `cancel_event`, `bulk_cancel_events` |

Safety: bulk tools refuse an empty filter, so an agent can't retry or cancel every event by accident.
Results are capped at 60 KB per call.

Not exposed on purpose: workspace members and deletion, source key rotation, and account settings.

## Code

- `main.go`: configuration, server instructions for the agent, stdio transport
- `client.go`: the EaseWebhook API client (token, workspace header, error messages)
- `tools.go`: every tool: its name, description, input schema and the API call it makes
