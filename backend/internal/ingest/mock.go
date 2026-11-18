package ingest

import (
	"io"
	"net/http"
	"strings"
	"time"
)

// MockPath serves the built-in "Mock API" destination: it accepts any request and answers 200,
// so users can watch deliveries end to end before they have an endpoint of their own.
const MockPath = "/mock"

// MockMiddleware answers /mock and /mock/* before GoFr's router.
func MockMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != MockPath && !strings.HasPrefix(r.URL.Path, MockPath+"/") {
			next.ServeHTTP(w, r)
			return
		}

		n, _ := io.Copy(io.Discard, io.LimitReader(r.Body, maxBodySize))

		writeJSON(w, http.StatusOK, map[string]any{
			"easewebhook_mock_endpoint_status": "200 OK",
			"method":                           r.Method,
			"path":                             strings.TrimPrefix(r.URL.Path, MockPath),
			"bytes_received":                   n,
			"event_id":                         r.Header.Get("X-Ease-Event-Id"),
			"received_at":                      time.Now().UTC(),
		})
	})
}
