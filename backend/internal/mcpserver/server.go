// Package mcpserver is the EaseWebhook MCP server: tools that let AI agents (Claude, Cursor,
// ChatGPT...) inspect and manage a workspace through the management API. It is served two ways:
// hosted over Streamable HTTP at /mcp by the backend (see HTTP), and locally over stdio by
// cmd/easewebhook-mcp.
package mcpserver

import "github.com/modelcontextprotocol/go-sdk/mcp"

const Version = "0.3.0"

// Instructions are sent to the agent when it connects: a short map of EaseWebhook.
const Instructions = `EaseWebhook is a webhook gateway. Senders (Stripe, GitHub, Razorpay, any app) post to a SOURCE URL.
Each incoming HTTP call is stored as a REQUEST. CONNECTIONS route a source to a DESTINATION (the user's server),
optionally through rules (filter, transform, retry, delay). Each request creates one EVENT per connection,
and every delivery try of an event is an ATTEMPT.
To debug "my webhooks are failing": get_overview, then list_events with status FAILED, then get_event for the
attempts' status codes and response bodies. If nothing arrived at all, check list_requests for REJECTED requests.
IDs have prefixes: src_ source, des_ destination, web_ connection, trs_ transformation, req_ request,
evt_ event, atm_ attempt, ws_ workspace.
Retrying re-sends webhooks to the user's real servers, and deleting can't be undone: confirm those with the user.`

type Options struct {
	// AllowWorkspaceSwitch adds the use_workspace tool (stdio only: one server per session).
	AllowWorkspaceSwitch bool
}

// NewServer builds an MCP server whose tools act through c.
func NewServer(c *Client, o Options) *mcp.Server {
	s := mcp.NewServer(
		&mcp.Implementation{Name: "easewebhook", Title: "EaseWebhook", Version: Version},
		&mcp.ServerOptions{Instructions: Instructions},
	)

	registerTools(s, c, o)

	return s
}
