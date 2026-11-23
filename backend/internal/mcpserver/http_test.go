package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testHandler() http.Handler {
	h := &HTTP{
		APIBase: "http://127.0.0.1:0", // tools/list never calls the API
		Authenticate: func(_ context.Context, token string) (*Caller, error) {
			if token != "ewak_good" {
				return nil, errors.New("invalid")
			}

			return &Caller{UserID: "usr_1", WorkspaceID: "ws_1"}, nil
		},
	}

	return h.Middleware(http.NotFoundHandler())
}

func listTools(token string, behindLocalProxy bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "https://easewebhook.onrender.com/mcp",
		strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Mcp-Protocol-Version", "2025-06-18")

	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	if behindLocalProxy {
		// Hosting platforms (Render) hand requests to the app from a proxy on localhost while the
		// Host header is the public domain; the SDK's DNS-rebinding guard used to reject that.
		req = req.WithContext(context.WithValue(req.Context(), http.LocalAddrContextKey,
			&net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 10000}))
	}

	rec := httptest.NewRecorder()
	testHandler().ServeHTTP(rec, req)

	return rec
}

func TestToolsListBehindLocalProxy(t *testing.T) {
	rec := listTools("ewak_good", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}

	var resp struct {
		Result struct {
			Tools []struct{ Name string } `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding %q: %v", rec.Body, err)
	}

	if len(resp.Result.Tools) != 37 {
		t.Fatalf("got %d tools, want 37", len(resp.Result.Tools))
	}
}

func TestRejectsMissingAndBadKeys(t *testing.T) {
	for _, token := range []string{"", "ewak_bad"} {
		rec := listTools(token, false)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("token %q: status %d, want 401", token, rec.Code)
		}

		if !strings.HasPrefix(rec.Header().Get("WWW-Authenticate"), "Bearer") {
			t.Errorf("token %q: missing WWW-Authenticate header", token)
		}
	}
}
