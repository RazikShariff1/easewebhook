// EaseWebhook MCP server: lets AI agents (Claude, Cursor, ChatGPT...) inspect and manage
// an EaseWebhook workspace: sources, destinations, connections, transformations,
// requests, events and retries.
//
// Configuration (environment variables):
//
//	EASEWEBHOOK_API_URL       API base URL (default https://easewebhook.onrender.com)
//	EASEWEBHOOK_TOKEN         login token (required): see README.md for how to get one
//	EASEWEBHOOK_WORKSPACE_ID  workspace to act on (optional: defaults to your first workspace)
package main

import (
	"context"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const instructions = `EaseWebhook is a webhook gateway. Senders (Stripe, GitHub, Razorpay, any app) post to a SOURCE URL.
Each incoming HTTP call is stored as a REQUEST. CONNECTIONS route a source to a DESTINATION (the user's server),
optionally through rules (filter, transform, retry, delay). Each request creates one EVENT per connection,
and every delivery try of an event is an ATTEMPT.
To debug "my webhooks are failing": get_overview, then list_events with status FAILED, then get_event for the
attempts' status codes and response bodies. If nothing arrived at all, check list_requests for REJECTED requests.
IDs have prefixes: src_ source, des_ destination, web_ connection, trs_ transformation, req_ request,
evt_ event, atm_ attempt, ws_ workspace.
Retrying re-sends webhooks to the user's real servers, and deleting can't be undone: confirm those with the user.`

func main() {
	log.SetFlags(0)
	log.SetPrefix("[easewebhook-mcp] ") // logs go to stderr; stdout is only for MCP messages

	apiURL := envOr("EASEWEBHOOK_API_URL", "https://easewebhook.onrender.com")
	token := os.Getenv("EASEWEBHOOK_TOKEN")

	if token == "" {
		log.Fatal("EASEWEBHOOK_TOKEN is not set. Log in and copy your token (see mcp/README.md).")
	}

	client := NewClient(apiURL, token, os.Getenv("EASEWEBHOOK_WORKSPACE_ID"))

	if client.workspaceID == "" {
		if err := client.pickWorkspace(context.Background()); err != nil {
			log.Fatalf("could not load your workspaces from %s: %v", apiURL, err)
		}
	}

	log.Printf("connected to %s, workspace %s", apiURL, client.workspaceID)

	server := mcp.NewServer(
		&mcp.Implementation{Name: "easewebhook", Title: "EaseWebhook", Version: "0.2.0"},
		&mcp.ServerOptions{Instructions: instructions},
	)

	registerTools(server, client)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}

	return fallback
}
