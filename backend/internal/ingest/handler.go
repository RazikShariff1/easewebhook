package ingest

import (
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // some providers still sign with HMAC-SHA1
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
	"github.com/zopping/easewebhook/backend/internal/sourcetypes"
	"github.com/zopping/easewebhook/backend/internal/store"
)

const (
	PathPrefix  = "/e/"
	maxBodySize = 5 << 20 // 5 MiB
)

// Handler serves POST/GET/... /e/{source_key}[/extra/path].
type Handler struct {
	Store  func() *store.Store // resolved lazily: the DB is only ready after GoFr starts
	Log    Logger
	OnSent func() // wakes the delivery worker
}

// Middleware intercepts ingestion paths before GoFr's router, so we get raw headers and body.
func (h *Handler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, PathPrefix) {
			h.ServeHTTP(w, r)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	st := h.Store()

	if st == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "not ready"})
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, PathPrefix)
	key, subPath, _ := strings.Cut(rest, "/")

	if subPath != "" {
		subPath = "/" + subPath
	}

	src, err := st.GetSourceByKey(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "source not found"})
		return
	}

	if err != nil {
		h.Log.Errorf("ingest: loading source %s: %v", key, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "internal error"})

		return
	}

	if src.DisabledAt != nil {
		writeJSON(w, http.StatusGone, map[string]string{"message": "source is disabled"})
		return
	}

	stype, _ := sourcetypes.Get(src.Type)
	if stype == nil {
		stype, _ = sourcetypes.Get(sourcetypes.Webhook)
	}

	// HTTP sources are called from browsers: answer CORS preflights and allow cross-origin reads.
	if stype.ID == sourcetypes.HTTP {
		setCORS(w, r)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	if !slices.Contains(src.AllowedMethods, r.Method) {
		// Logged as a rejected request so it shows up (and can be retried) in the dashboard.
		body, _ := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
		cause := "UNSUPPORTED_METHOD"
		rej := &store.NewRequest{
			ID: ids.New(ids.Request), WorkspaceID: src.WorkspaceID, SourceID: src.ID, Method: r.Method, Path: subPath,
			Query: r.URL.RawQuery, Headers: flattenHeaders(r.Header), Body: string(body), ContentType: r.Header.Get("Content-Type"),
			Status: "REJECTED", RejectionCause: &cause, OriginalIP: clientIP(r),
		}

		if err := st.InsertRequest(ctx, rej); err != nil {
			h.Log.Errorf("ingest: storing rejected request: %v", err)
		}

		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed for this source", "request_id": rej.ID})

		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "could not read body"})
		return
	}

	if len(body) > maxBodySize {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"message": "payload too large (max 5MB)"})
		return
	}

	headers := flattenHeaders(r.Header)

	req := &store.NewRequest{
		ID: ids.New(ids.Request), WorkspaceID: src.WorkspaceID, SourceID: src.ID, Method: r.Method, Path: subPath, Query: r.URL.RawQuery,
		Headers: headers, Body: string(body), ContentType: r.Header.Get("Content-Type"),
		Status: "ACCEPTED", OriginalIP: clientIP(r),
	}

	var verr error

	switch {
	case stype.CustomAuth && src.Verification != nil:
		if !verify(src.Verification, r, body) {
			verr = sourcetypes.ErrBadSignature
		}

		ok := verr == nil
		req.Verified = &ok
	case stype.Ready(src.Config):
		verr = stype.Verify(src.Config, r, body)
		ok := verr == nil
		req.Verified = &ok
	}

	if verr != nil {
		cause := "VERIFICATION_FAILED: " + verr.Error()
		req.Status, req.RejectionCause = "REJECTED", &cause

		if err := st.InsertRequest(ctx, req); err != nil {
			h.Log.Errorf("ingest: storing rejected request: %v", err)
		}

		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "verification failed", "request_id": req.ID})

		return
	}

	// Provider URL-verification handshakes (Meta hub.challenge, Slack, Discord PING, Twitch) are answered
	// directly and not routed as events.
	if stype.Handshake != nil {
		if resp := stype.Handshake(src.Config, r, body); resp != nil {
			w.Header().Set("Content-Type", resp.ContentType)
			w.WriteHeader(resp.Status)
			_, _ = w.Write([]byte(resp.Body))

			return
		}
	}

	if err := st.InsertRequest(ctx, req); err != nil {
		h.Log.Errorf("ingest: storing request: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "internal error"})

		return
	}

	created, ignored, err := FanOut(ctx, st, h.Log, req)
	if err != nil {
		h.Log.Errorf("ingest: fan-out for %s: %v", req.ID, err)
	}

	if created > 0 && h.OnSent != nil {
		h.OnSent()
	}

	if src.CustomResponse != nil {
		ct := src.CustomResponse.ContentType
		if ct == "" {
			ct = "text/plain"
		}

		w.Header().Set("Content-Type", ct)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(src.CustomResponse.Body))

		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "SUCCESS",
		"message":    "Request handled by EaseWebhook",
		"request_id": req.ID,
		"events":     created,
		"ignored":    ignored,
		"received":   time.Now().UTC(),
	})
}

func setCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}

	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Vary", "Origin")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	h.Set("Access-Control-Allow-Credentials", "true")

	if req := r.Header.Get("Access-Control-Request-Headers"); req != "" {
		h.Set("Access-Control-Allow-Headers", req)
	} else {
		h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key")
	}

	h.Set("Access-Control-Max-Age", "600")
}

func flattenHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, v := range h {
		out[strings.ToLower(k)] = strings.Join(v, ", ")
	}

	return out
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip, _, _ := strings.Cut(xff, ",")
		return strings.TrimSpace(ip)
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}

	return host
}

func verify(v *models.SourceVerification, r *http.Request, body []byte) bool {
	switch strings.ToLower(v.Type) {
	case "hmac":
		return verifyHMAC(v, r.Header.Get(v.Header), body)
	case "api_key":
		got := r.Header.Get(v.Header)
		return got != "" && subtle.ConstantTimeCompare([]byte(got), []byte(v.APIKey)) == 1
	case "basic_auth":
		u, p, ok := r.BasicAuth()
		return ok && subtle.ConstantTimeCompare([]byte(u), []byte(v.Username)) == 1 &&
			subtle.ConstantTimeCompare([]byte(p), []byte(v.Password)) == 1
	}

	return false
}

func verifyHMAC(v *models.SourceVerification, got string, body []byte) bool {
	if got == "" {
		return false
	}

	var fn func() hash.Hash

	switch strings.ToLower(v.Algorithm) {
	case "", "sha256":
		fn = sha256.New
	case "sha1":
		fn = sha1.New
	case "sha512":
		fn = sha512.New
	default:
		return false
	}

	mac := hmac.New(fn, []byte(v.Secret))
	mac.Write(body)
	sum := mac.Sum(nil)

	got = strings.TrimSpace(strings.TrimPrefix(got, v.Prefix))

	if strings.ToLower(v.Encoding) == "base64" {
		return hmac.Equal([]byte(got), []byte(base64.StdEncoding.EncodeToString(sum)))
	}

	return hmac.Equal([]byte(strings.ToLower(got)), []byte(hex.EncodeToString(sum)))
}
