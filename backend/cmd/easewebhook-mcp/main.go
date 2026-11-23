// Command easewebhook-mcp runs the EaseWebhook MCP server locally over stdio, for AI apps that
// can only start local servers, or for working against a local backend. Most people should use
// the hosted endpoint instead (https://easewebhook.onrender.com/mcp with an API key).
//
// Configuration (environment variables):
//
//	EASEWEBHOOK_API_URL       API base URL (default https://easewebhook.onrender.com)
//	EASEWEBHOOK_API_KEY       API key from the AI agents page (or EASEWEBHOOK_TOKEN, a session token)
//	EASEWEBHOOK_WORKSPACE_ID  workspace to act on (optional: the key's workspace, else your first one)
package main

import (
	"context"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/zopping/easewebhook/backend/internal/mcpserver"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("[easewebhook-mcp] ") // logs go to stderr; stdout is only for MCP messages

	apiURL := envOr("EASEWEBHOOK_API_URL", "https://easewebhook.onrender.com")
	token := envOr("EASEWEBHOOK_API_KEY", os.Getenv("EASEWEBHOOK_TOKEN"))

	if token == "" {
		log.Fatal("EASEWEBHOOK_API_KEY is not set: create a key in EaseWebhook under AI agents.")
	}

	client := mcpserver.NewClient(apiURL, token, os.Getenv("EASEWEBHOOK_WORKSPACE_ID"))

	if client.WorkspaceID() == "" {
		if err := client.PickWorkspace(context.Background()); err != nil {
			log.Fatalf("could not load your workspaces from %s: %v", apiURL, err)
		}
	}

	log.Printf("connected to %s, workspace %s", apiURL, client.WorkspaceID())

	server := mcpserver.NewServer(client, mcpserver.Options{AllowWorkspaceSwitch: true})
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
