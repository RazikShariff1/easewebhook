package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"gofr.dev/pkg/gofr"

	"github.com/zopping/easewebhook/backend/internal/apierr"
)

type (
	ctxKey   struct{}
	wsCtxKey struct{}
)

// WorkspaceHeader selects the workspace for management API calls.
const WorkspaceHeader = "X-Workspace-Id"

// needsWorkspace: /auth/* and /workspaces* identify their scope themselves.
func needsWorkspace(path string) bool {
	return !strings.HasPrefix(path, "/auth/") && path != "/workspaces" && !strings.HasPrefix(path, "/workspaces/")
}

// publicPaths don't need a session.
var publicPaths = map[string]bool{
	"/auth/signup": true,
	"/auth/login":  true,
	"/auth/google": true,
	"/auth/config": true,
}

func isPublic(path string) bool {
	return publicPaths[path] || strings.HasPrefix(path, "/e/") || path == "/mock" || strings.HasPrefix(path, "/mock/") ||
		strings.HasPrefix(path, "/.well-known/")
}

// Middleware rejects management API calls without a valid "Authorization: Bearer <token>".
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || isPublic(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || tok == "" {
			unauthorized(w, "missing session — log in")
			return
		}

		uid, err := s.Verify(strings.TrimSpace(tok))
		if err != nil {
			unauthorized(w, "session expired — log in again")
			return
		}

		ctx := context.WithValue(r.Context(), ctxKey{}, uid)

		if needsWorkspace(r.URL.Path) {
			ws := r.Header.Get(WorkspaceHeader)
			if ws == "" {
				writeErr(w, http.StatusBadRequest, "missing "+WorkspaceHeader+" header")
				return
			}

			if _, err := s.MemberRole(r.Context(), ws, uid); err != nil {
				writeErr(w, http.StatusForbidden, "you are not a member of this workspace")
				return
			}

			ctx = context.WithValue(ctx, wsCtxKey{}, ws)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func unauthorized(w http.ResponseWriter, msg string) { writeErr(w, http.StatusUnauthorized, msg) }

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": msg}})
}

// WorkspaceID returns the workspace selected for this request ("" on /auth and /workspaces routes).
func WorkspaceID(ctx context.Context) string {
	v, _ := ctx.Value(wsCtxKey{}).(string)
	return v
}

// UserID returns the signed-in user's ID from a request context.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxKey{}).(string)
	return v
}

type credentials struct {
	Name       string `json:"name"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	Credential string `json:"credential"` // Google ID token
}

func bind(c *gofr.Context) (*credentials, error) {
	var in credentials
	if err := c.Bind(&in); err != nil {
		return nil, apierr.BadRequest("invalid JSON body")
	}

	return &in, nil
}

// Register adds the /auth routes.
func (s *Service) Register(app *gofr.App) {
	app.GET("/auth/config", func(*gofr.Context) (any, error) {
		return map[string]any{"google_client_id": s.GoogleClientID, "mock_destination_url": s.MockURL}, nil
	})

	app.POST("/auth/signup", func(c *gofr.Context) (any, error) {
		in, err := bind(c)
		if err != nil {
			return nil, err
		}

		return s.Signup(c, c.SQL, in.Name, in.Email, in.Password)
	})

	app.POST("/auth/login", func(c *gofr.Context) (any, error) {
		in, err := bind(c)
		if err != nil {
			return nil, err
		}

		return s.Login(c, c.SQL, in.Email, in.Password)
	})

	app.POST("/auth/google", func(c *gofr.Context) (any, error) {
		in, err := bind(c)
		if err != nil {
			return nil, err
		}

		return s.Google(c, c.SQL, in.Credential)
	})

	app.GET("/auth/me", func(c *gofr.Context) (any, error) {
		return s.Me(c, c.SQL, UserID(c))
	})
}
