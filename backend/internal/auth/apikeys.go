package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"gofr.dev/pkg/gofr"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
)

// APIKeyPrefix starts every API key, so keys are easy to spot in configs and secret scanners.
const APIKeyPrefix = "ewak_"

// APIKey is a key as listed in the dashboard. The secret is only returned once, on creation.
type APIKey struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Prefix      string     `json:"prefix"` // first characters, to recognise a key
	WorkspaceID string     `json:"workspace_id"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	Key         string     `json:"key,omitempty"`
}

type keyOwner struct {
	userID, workspaceID string
	expires             time.Time
}

// keyCacheTTL bounds how long a revoked key keeps working on other instances (revoking on this
// instance takes effect immediately).
const keyCacheTTL = 30 * time.Second

var keyCache = struct {
	sync.Mutex
	m map[string]keyOwner // key hash -> owner
}{m: map[string]keyOwner{}}

func hashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// IsAPIKey reports whether a bearer token is an API key rather than a session token.
func IsAPIKey(token string) bool { return strings.HasPrefix(token, APIKeyPrefix) }

// ResolveAPIKey returns the user and workspace an API key acts as.
func (s *Service) ResolveAPIKey(ctx context.Context, key string) (userID, workspaceID string, err error) {
	h := hashKey(key)

	keyCache.Lock()
	o, ok := keyCache.m[h]
	keyCache.Unlock()

	if ok && time.Now().Before(o.expires) {
		return o.userID, o.workspaceID, nil
	}

	db := s.db(nil)
	if db == nil {
		return "", "", errors.New("not ready")
	}

	if err := db.QueryRowContext(ctx, `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 RETURNING user_id, workspace_id`, h).
		Scan(&userID, &workspaceID); err != nil {
		return "", "", errors.New("invalid API key")
	}

	keyCache.Lock()
	if len(keyCache.m) > 10_000 {
		keyCache.m = map[string]keyOwner{}
	}
	keyCache.m[h] = keyOwner{userID: userID, workspaceID: workspaceID, expires: time.Now().Add(keyCacheTTL)}
	keyCache.Unlock()

	return userID, workspaceID, nil
}

// CallerFromToken resolves any bearer token (API key or session token) to a user and, for API
// keys, the key's workspace.
func (s *Service) CallerFromToken(ctx context.Context, token string) (userID, workspaceID string, err error) {
	if IsAPIKey(token) {
		return s.ResolveAPIKey(ctx, token)
	}

	uid, err := s.Verify(token)

	return uid, "", err
}

// apiKeyForbidden: API keys can manage webhooks, but not keys themselves or workspace membership.
func apiKeyForbidden(r *http.Request) bool {
	p := r.URL.Path
	if strings.HasPrefix(p, "/api-keys") {
		return true
	}

	return strings.HasPrefix(p, "/workspaces") && r.Method != http.MethodGet
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func (s *Service) registerAPIKeys(app *gofr.App) {
	app.GET("/api-keys", func(c *gofr.Context) (any, error) {
		q, ok := s.db(c.SQL).(querier)
		if !ok {
			return nil, errors.New("database does not support listing")
		}

		rows, err := q.QueryContext(c, `SELECT id, name, prefix, workspace_id, created_at, last_used_at FROM api_keys
			WHERE user_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`, UserID(c), WorkspaceID(c))
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		keys := []APIKey{}

		for rows.Next() {
			var k APIKey
			if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.WorkspaceID, &k.CreatedAt, &k.LastUsedAt); err != nil {
				return nil, err
			}

			keys = append(keys, k)
		}

		return keys, rows.Err()
	})

	app.POST("/api-keys", func(c *gofr.Context) (any, error) {
		var in struct {
			Name string `json:"name"`
		}
		if err := c.Bind(&in); err != nil {
			return nil, apierr.BadRequest("invalid JSON body")
		}

		name := strings.TrimSpace(in.Name)
		if name == "" {
			name = "API key"
		}

		if len(name) > 80 {
			return nil, apierr.BadRequest("name must be at most 80 characters")
		}

		secret := APIKeyPrefix + ids.Random(32)
		k := APIKey{ID: ids.New("key"), Name: name, Prefix: secret[:len(APIKeyPrefix)+6], WorkspaceID: WorkspaceID(c), Key: secret}

		if err := s.db(c.SQL).QueryRowContext(c, `INSERT INTO api_keys (id, user_id, workspace_id, name, prefix, key_hash)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`, k.ID, UserID(c), k.WorkspaceID, k.Name, k.Prefix, hashKey(secret)).
			Scan(&k.CreatedAt); err != nil {
			return nil, err
		}

		return k, nil
	})

	app.DELETE("/api-keys/{id}", func(c *gofr.Context) (any, error) {
		id := c.PathParam("id")

		var h string
		if err := s.db(c.SQL).QueryRowContext(c, `DELETE FROM api_keys WHERE id = $1 AND user_id = $2 AND workspace_id = $3 RETURNING key_hash`,
			id, UserID(c), WorkspaceID(c)).Scan(&h); err != nil {
			return nil, apierr.NotFound("API key", id)
		}

		keyCache.Lock()
		delete(keyCache.m, h)
		keyCache.Unlock()

		return nil, nil
	})
}
