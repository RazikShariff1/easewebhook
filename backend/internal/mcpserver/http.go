package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Path is where the hosted MCP endpoint is served.
const Path = "/mcp"

// Caller is who an MCP request acts as, resolved from its bearer token.
type Caller struct {
	UserID      string
	WorkspaceID string // set for API keys; "" for session tokens
}

// HTTP serves MCP over Streamable HTTP. It is stateless: every request carries its own bearer
// token (an API key or a dashboard session token), gets its own server, and its tools call the
// REST API at APIBase with that same token, so an agent can never do more than the token's owner
// could in the dashboard.
type HTTP struct {
	// APIBase is the management API, normally this backend over loopback (http://127.0.0.1:PORT).
	APIBase string
	// Authenticate validates a bearer token.
	Authenticate func(ctx context.Context, token string) (*Caller, error)
	// ResourceMetadataURL, when set, is advertised on 401s so OAuth-capable clients can sign in.
	ResourceMetadataURL string

	handler http.Handler
}

type clientKey struct{}

func (h *HTTP) init() {
	if h.handler != nil {
		return
	}

	h.handler = mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		c, _ := r.Context().Value(clientKey{}).(*Client)
		return NewServer(c, Options{})
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
}

// Middleware answers requests to /mcp and passes everything else on.
func (h *HTTP) Middleware(next http.Handler) http.Handler {
	h.init()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != Path && r.URL.Path != Path+"/" {
			next.ServeHTTP(w, r)
			return
		}

		cors(w)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		token = strings.TrimSpace(token)

		if !ok || token == "" {
			h.unauthorized(w, "missing API key: send Authorization: Bearer <key>; create one in EaseWebhook under AI agents")
			return
		}

		caller, err := h.Authenticate(r.Context(), token)
		if err != nil {
			h.unauthorized(w, "invalid or revoked API key")
			return
		}

		ws := caller.WorkspaceID
		if ws == "" {
			ws = r.Header.Get("X-Workspace-Id")
		}

		client := NewClient(h.APIBase, token, ws)
		if client.WorkspaceID() == "" {
			if err := client.PickWorkspace(r.Context()); err != nil {
				writeJSONError(w, http.StatusBadGateway, err.Error())
				return
			}
		}

		h.handler.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientKey{}, client)))
	})
}

func (h *HTTP) unauthorized(w http.ResponseWriter, msg string) {
	v := `Bearer realm="easewebhook"`
	if h.ResourceMetadataURL != "" {
		v += `, resource_metadata="` + h.ResourceMetadataURL + `"`
	}

	w.Header().Set("WWW-Authenticate", v)
	writeJSONError(w, http.StatusUnauthorized, msg)
}

func cors(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, X-Workspace-Id")
	h.Set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate")
}

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": msg}})
}
